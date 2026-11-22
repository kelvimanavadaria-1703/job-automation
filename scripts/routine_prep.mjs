#!/usr/bin/env node
// Token-saver for the daily cloud routine. Does in plain Node (zero model
// tokens) the work the routine agent used to do by reading 150KB+ of JSON
// into its context: dedupe against the Drive ledger, recruiter/company/platform
// channel routing, cloud hints for the resume pick, and a pre-check of every
// tier-B/C careers page so the agent only WebFetches pages that actually
// mention a DevOps/SRE/Platform/Cloud role.
//
//   node scripts/routine_prep.mjs prep  --seen /tmp/seen.json
//       -> prints compact new matches (already routed) + tier-B/C pre-check
//   node scripts/routine_prep.mjs ledger --seen /tmp/seen.json --add /tmp/reported.txt
//       -> prints the updated ledger JSON (short URL hashes) to save to Drive
//
// Ledger format: {"generated":ISO,"h":["<10-hex sha1 of url>",...]}. A legacy
// {"urls":[...full urls...]} ledger is still accepted and migrated on write.
// Hashes instead of full URLs cut the Drive read+write by ~85% in tokens.

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const mode = args[0]
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const MAX_LEDGER = 1500

const ROLE = /\b(devops|site reliability|sre|platform engineer|cloud engineer|cloud infrastructure|infrastructure engineer|systems reliability|forward[\s-]deployed)\b/i
const hash = u => createHash('sha1').update(String(u).trim().replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()).digest('hex').slice(0, 10)
const toHash = e => /^https?:/i.test(e) ? hash(e) : e

async function loadLedger () {
  const p = opt('--seen')
  if (!p) return []
  try {
    const j = JSON.parse(await readFile(p, 'utf8'))
    return [...(j.h || []), ...(j.urls || [])].map(toHash)
  } catch { return [] }
}

const readJson = async f => JSON.parse(await readFile(join(ROOT, f), 'utf8'))
const norm = s => String(s || '').toLowerCase()
  .replace(/\(.*?\)/g, ' ')
  .replace(/\b(india|group|services?|technologies|technology|solutions|consulting|pvt|private|ltd|limited|inc|llc|global|digital|it|staffing|the)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()

function clouds (text) {
  const t = norm(text)
  const out = []
  if (/\baws\b|amazon web services/.test(t)) out.push('AWS')
  if (/\bazure\b/.test(t)) out.push('Azure')
  if (/\bgcp\b|google cloud/.test(t)) out.push('GCP')
  return out.join('+') || '-'
}

const strip = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')

async function precheck (c) {
  try {
    const r = await fetch(c.careersUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', accept: 'text/html,application/json' }
    })
    if (!r.ok) return { c, status: `http${r.status}` }
    const body = strip(await r.text())
    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    // Role-titled links: give the agent deep links directly when the page has them.
    const links = []
    for (const m of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
      const t = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (ROLE.test(t)) { try { links.push(`${t.slice(0, 90)} <${new URL(m[1], r.url).href}>`) } catch {} }
    }
    const hits = (text.match(new RegExp(ROLE.source, 'gi')) || []).length
    if (hits || links.length) return { c, status: 'HIT', hits, links: [...new Set(links)].slice(0, 8) }
    return { c, status: text.length < 1500 ? 'js-only' : 'no-role' }
  } catch (e) { return { c, status: 'unreachable' } }
}

async function pool (items, n, fn) {
  const out = []; let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } }))
  return out
}

if (mode === 'prep') {
  const seen = new Set(await loadLedger())
  const raw = await readJson('data/jobs.raw.json')
  const comps = (await readJson('data/companies.json'))
  const companies = Array.isArray(comps) ? comps : comps.companies
  const recruiters = (await readJson('data/recruiters.json')).recruiters
  const compKeys = new Map(companies.map(c => [norm(c.name), c]))
  const recKeys = recruiters.map(r => [norm(r.name), r]).filter(([k]) => k.length >= 3)

  const findRec = name => {
    const n = norm(name); if (!n) return null
    for (const [k, r] of recKeys) {
      const first = k.split(' ')[0]
      if (n === k || n.includes(k) || k.includes(n) || (first.length >= 5 && n.split(' ').includes(first))) return r
    }
    return null
  }

  const rows = { recruiter: [], portal: [], platform: [] }
  let dupes = 0
  for (const m of raw.matches) {
    if (seen.has(hash(m.url))) { dupes++; continue }
    const isLinkedIn = String(m.source).startsWith('linkedin')
    const rec = isLinkedIn ? findRec(m.company) : null
    const comp = compKeys.get(norm(m.company))
    const ch = rec ? 'recruiter' : (!isLinkedIn || comp) ? 'portal' : 'platform'
    const prio = rec ? rec.priority : (comp?.priority || m.priority || 'medium')
    const age = m.ageHours == null ? 'age?' : m.ageHours < 48 ? `${m.ageHours}h` : `${Math.round(m.ageHours / 24)}d`
    rows[ch].push({ prio, line: `${prio} | ${m.company} | ${m.title} | ${m.location} | ${age} | cloud:${clouds(m.title + ' ' + m.description)}${m.isManagementTitle ? ' | MGMT-TITLE' : ''}${rec ? ` | via:${rec.name} (${rec.priority})` : ''} | ${m.url}` })
  }
  const order = p => ({ P1: 0, high: 0, P2: 1, medium: 1, P3: 2, low: 2 }[p] ?? 1)
  console.log(`# NEW MATCHES from scan (after ledger dedupe; ${dupes} already-reported dropped; ledger has ${seen.size})`)
  console.log('# prio | employer | title | location | age | cloud-hint | [via recruiter] | url')
  for (const ch of ['recruiter', 'portal', 'platform']) {
    rows[ch].sort((a, b) => order(a.prio) - order(b.prio))
    console.log(`\n## ${ch} (${rows[ch].length})`)
    for (const r of rows[ch]) console.log(r.line)
  }
  if (raw.stale?.length) console.log(`\n## broken boards (${raw.stale.length}): ` + raw.stale.map(s => `${s.name} (${s.provider}: ${String(s.error).slice(0, 60)})`).join('; '))
  if (raw.discoveredCompanies?.length) console.log(`\n## LinkedIn employers not in registry: ${raw.discoveredCompanies.join(', ')}`)

  // Tier-B/C careers-page pre-check
  const bc = companies.filter(c => c.careersUrl && [].concat(c.tier).some(t => t === 'B' || t === 'C'))
    .sort((a, b) => order(a.priority) - order(b.priority))
  const res = await pool(bc, 12, precheck)
  const by = s => res.filter(r => r.status === s || (s === 'blocked' && /^http/.test(r.status)))
  console.log(`\n# TIER-B/C PRE-CHECK (${bc.length} careers pages fetched by plain Node)`)
  console.log(`## HIT — page text names a DevOps/SRE/Platform/Cloud role; WebFetch these (${by('HIT').length})`)
  for (const r of by('HIT')) {
    console.log(`${r.c.priority} | ${r.c.name} | ${r.c.careersUrl} | ${r.hits} mention(s)`)
    for (const l of r.links) console.log(`    link: ${l}`)
  }
  const names = s => by(s).map(r => `${r.c.name} [${r.c.priority}] ${r.c.careersUrl}`)
  console.log(`\n## BLOCKED/UNREACHABLE by plain fetch — WebFetch only the high-priority ones (${by('blocked').length + by('unreachable').length})`)
  for (const n of [...names('blocked'), ...names('unreachable')]) console.log(n)
  console.log(`\n## JS-only (no server-rendered text; WebFetch cannot render JS either) — skip (${by('js-only').length}): ${by('js-only').map(r => r.c.name).join(', ')}`)
  console.log(`## no role mentioned on page — skip (${by('no-role').length}): ${by('no-role').map(r => r.c.name).join(', ')}`)
} else if (mode === 'ledger') {
  const prev = await loadLedger()
  const add = opt('--add') ? (await readFile(opt('--add'), 'utf8')).split(/\s+/).filter(Boolean).map(toHash) : []
  const all = [...new Set([...prev, ...add])].slice(-MAX_LEDGER)
  process.stdout.write(JSON.stringify({ generated: new Date().toISOString(), h: all }))
} else {
  console.error('usage: routine_prep.mjs prep|ledger --seen <file> [--add <file>]')
  process.exit(1)
}
