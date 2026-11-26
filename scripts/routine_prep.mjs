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
//   node scripts/routine_prep.mjs check --seen /tmp/seen.json --urls /tmp/tierb.txt
//       -> prints only the URLs not already in the ledger
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

// ---- Experience filter: Kelvi wants only 1-5 yr openings (2026-11-27). ----
// Titles that are never a 1-5 yr IC role. AVP/VP alone is kept on purpose
// (BFSI mid-level IC, see profile.json seniorityNote).
const TOO_SENIOR = /\b(director|head of|chief|vp of|distinguished|princip(al|le)|staff|architect|lead|manager|intern|internship|trainee|fresher|apprentice)\b/i
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const plain = h => String(h || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/<\/(li|p|h\d|div)>|<br[^>]*>/gi, '. ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

// Years asked, from JD text. min = the highest stated minimum (conservative,
// same rule as scan_global.mjs). null when the JD states no years.
function expAsk (t) {
  const ms = [...t.matchAll(/(\d{1,2})\s*(?:\+|plus|or more)?\s*(?:[-–—]|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b([^.]{0,80})/gi)]
    .filter(m => /experience|engineer|working|hands|managing|building|operating|of (relevant|professional|industry)|in (a |an |the )?(devops|sre|site|software|cloud|infra|system|production|similar)/i.test(m[3]))
    .map(m => ({ lo: +m[1], hi: m[2] ? +m[2] : null, raw: m[0].slice(0, 20) })).filter(r => r.lo < 16 && (r.hi == null || r.hi < 21))
  if (!ms.length) return null
  const top = ms.reduce((a, b) => (b.lo > a.lo ? b : a))
  return { min: top.lo, max: top.hi, raw: top.raw, label: top.hi ? `${top.lo}-${top.hi}y` : `${top.lo}${/\+|plus|or more/i.test(top.raw) ? "+" : ""}y` }
}

async function getJson (u) {
  const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

// Returns { text, seniority } for one posting, or null if it can't be read.
async function fetchJd (m) {
  try {
    const url = m.url
    if (String(m.source).startsWith('linkedin')) {
      const id = url.match(/(\d{8,})/)?.[1]
      if (!id) return null
      let r
      for (const wait of [0, 5000, 12000]) {
        await sleep(wait)
        r = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) })
        if (r.status !== 429) break
      }
      if (!r.ok) return null
      const h = await r.text()
      const seniority = plain(h.match(/Seniority level\s*<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/)?.[1] || '')
      return { text: plain(h.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1] || ''), seniority }
    }
    const wd = url.match(/^https:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/job\/(.+)$/)
    if (wd) {
      const j = await getJson(`https://${wd[1]}.${wd[2]}.myworkdayjobs.com/wday/cxs/${wd[1]}/${wd[3]}/job/${wd[4]}`)
      return { text: plain(j.jobPostingInfo?.jobDescription) }
    }
    const orc = url.match(/^https:\/\/([^/]+)\/hcmUI\/CandidateExperience\/[a-z]+\/sites\/([^/]+)\/job\/(\d+)/)
    if (orc) {
      const j = await getJson(`https://${orc[1]}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${orc[3]}%22,siteNumber=${orc[2]}`)
      const it = j.items?.[0] || {}
      return { text: plain([it.ExternalDescriptionStr, it.ExternalQualificationsStr, it.ExternalResponsibilitiesStr].join(' ')) }
    }
    return null
  } catch { return null }
}

// Keep / drop one match on the 1-5 yr band. Returns { keep, exp, why }.
async function experienceCheck (m) {
  if (TOO_SENIOR.test(m.title) || m.isManagementTitle) return { keep: false, why: 'title' }
  let text = plain(m.description)
  let seniority = ''
  if (text.length < 300) {
    const jd = await fetchJd(m)
    if (jd) { text = jd.text || text; seniority = jd.seniority || '' }
  }
  if (/director|executive|internship/i.test(seniority)) return { keep: false, why: 'seniority' }
  const e = expAsk(m.title + '. ' + text)
  // 1-5 yr band: drop when the minimum asked is above 5, or is 5 with no
  // upper bound inside the band ("5+ years", "5-8 years"). "3-5", "5 years" stay.
  if (e && (e.min > 5 || (e.min === 5 && e.max !== null && e.max > 5) || (e.min === 5 && e.max === null && /\+|plus|or more/i.test(e.raw)))) return { keep: false, why: `asks ${e.label}` }
  if (e && e.max != null && e.max < 1) return { keep: false, why: `asks ${e.label}` }
  return { keep: true, exp: e ? e.label : (text.length < 300 ? 'JD not read' : 'not stated') }
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
  const fresh = raw.matches.filter(m => !seen.has(hash(m.url)))
  dupes = raw.matches.length - fresh.length
  // Serial-ish (2 at a time, small gap) so LinkedIn's guest endpoint doesn't 429.
  const checks = await pool(fresh, 2, async m => { const r = await experienceCheck(m); await sleep(700); return r })
  const dropped = []
  for (const [i, m] of fresh.entries()) {
    const chk = checks[i]
    if (!chk.keep) { dropped.push(`${m.company} — ${m.title} (${chk.why})`); continue }
    const isLinkedIn = String(m.source).startsWith('linkedin')
    const rec = isLinkedIn ? findRec(m.company) : null
    const comp = compKeys.get(norm(m.company))
    const ch = rec ? 'recruiter' : (!isLinkedIn || comp) ? 'portal' : 'platform'
    const prio = rec ? rec.priority : (comp?.priority || m.priority || 'medium')
    const age = m.ageHours == null ? 'age?' : m.ageHours < 48 ? `${m.ageHours}h` : `${Math.round(m.ageHours / 24)}d`
    rows[ch].push({ prio, line: `${prio} | ${m.company} | ${m.title} | ${m.location} | ${age} | exp:${chk.exp} | cloud:${clouds(m.title + ' ' + m.description)}${rec ? ` | via:${rec.name} (${rec.priority})` : ''} | ${m.url}` })
  }
  const order = p => ({ P1: 0, high: 0, P2: 1, medium: 1, P3: 2, low: 2 }[p] ?? 1)
  console.log(`# NEW MATCHES from scan (after ledger dedupe; ${dupes} already-reported dropped; ledger has ${seen.size}; ${dropped.length} dropped as outside the 1-5 yr band)`)
  console.log('# prio | employer | title | location | age | experience asked | cloud-hint | [via recruiter] | url')
  for (const ch of ['recruiter', 'portal', 'platform']) {
    rows[ch].sort((a, b) => order(a.prio) - order(b.prio))
    console.log(`\n## ${ch} (${rows[ch].length})`)
    for (const r of rows[ch]) console.log(r.line)
  }
  if (dropped.length) console.log(`\n## dropped, outside 1-5 yrs (${dropped.length}): ` + dropped.slice(0, 40).join('; '))
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
} else if (mode === 'check') {
  // Prints only the URLs (one per line in --urls file) NOT already in the ledger.
  const seen = new Set(await loadLedger())
  const urls = (await readFile(opt('--urls'), 'utf8')).split(/\s+/).filter(Boolean)
  for (const u of urls) if (!seen.has(hash(u))) console.log(u)
} else if (mode === 'ledger') {
  const prev = await loadLedger()
  const add = opt('--add') ? (await readFile(opt('--add'), 'utf8')).split(/\s+/).filter(Boolean).map(toHash) : []
  const all = [...new Set([...prev, ...add])].slice(-MAX_LEDGER)
  process.stdout.write(JSON.stringify({ generated: new Date().toISOString(), h: all }))
} else {
  console.error('usage: routine_prep.mjs prep|check|ledger --seen <file> [--add <file>]')
  process.exit(1)
}
