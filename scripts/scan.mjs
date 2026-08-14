#!/usr/bin/env node
// Scans every tier-A (verified public ATS) company in data/companies.json for
// DevOps/SRE/Platform/Cloud roles matching profile.json, and writes
// data/jobs.raw.json for the routine to read.
//
//   node scripts/scan.mjs                    # all verified tier-A boards
//   node scripts/scan.mjs --maxAgeHours 24   # only postings <= N hours old
//   node scripts/scan.mjs --loc pune         # location substring filter
//
// Deliberately dumb: no model calls. Fetch, normalize, filter, emit. The
// routine's agent reasons over the output — that's what keeps this stage
// near-zero cost and makes it safe to run in full every single day.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')

const ROLE = /\b(devops|site reliability|\bsre\b|platform engineer|cloud engineer|cloud infrastructure|infrastructure engineer|systems reliability)\b/i
const INDIA = /(india|bengaluru|bangalore|pune|hyderabad|gurgaon|gurugram|noida|mumbai|chennai|delhi|powai)/i
const REMOTE = /remote|anywhere|distributed|work from home|worldwide/i

// BFSI titles like "AVP"/"VP" often mean mid-level IC, not literal seniority —
// unlike tech-company titles. Do NOT reject on title alone; only flag titles
// that are unambiguously management/leadership regardless of sector.
const MGMT_TITLE = /\b(director|head of|chief|distinguished|principal architect)\b/i

// Modular adapters per provider
import greenhouse from '../adapters/greenhouse.mjs'
import lever from '../adapters/lever.mjs'
import workday from '../adapters/workday.mjs'
import oracle_orc from '../adapters/oracle_orc.mjs'
import webfetch from '../adapters/webfetch.mjs'
import linkedinGuest from '../adapters/linkedin_guest.mjs'

const ADAPTERS = { greenhouse, lever, workday, oracle_orc, webfetch }

async function fetchBoard (company) {
  const adapter = ADAPTERS[company.provider] ?? webfetch
  try {
    const jobs = await adapter(company)
    return { company, jobs }
  } catch (err) {
    return { company, error: err.message }
  }
}

const args = process.argv.slice(2)
const maxAgeHours = args.includes('--maxAgeHours') ? Number(args[args.indexOf('--maxAgeHours') + 1]) : null
const locFilter = args.includes('--loc') ? args[args.indexOf('--loc') + 1]?.toLowerCase() : null
const verify = args.includes('--verify') // optional URL verification to filter expired/removed postings
const notify = args.includes('--notify') // send Slack notification when matches found
const noLinkedin = args.includes('--noLinkedin') // skip the LinkedIn guest-search pass

const registry = JSON.parse(await readFile(join(ROOT, 'data/companies.json'), 'utf8'))
const verified = registry.companies.filter(c => c.tier.includes('A'))

// Lowercased-name -> company record, for tagging LinkedIn hits with the same
// priority/sector metadata already researched for that employer.
const registryByName = new Map(registry.companies.map(c => [c.name.toLowerCase(), c]))
function lookupCompany (name) {
  const key = (name || '').toLowerCase()
  if (registryByName.has(key)) return registryByName.get(key)
  for (const [regName, c] of registryByName) {
    if (key.includes(regName) || regName.includes(key)) return c
  }
  return null
}

console.error(`Scanning ${verified.length} verified tier-A boards…\n`)

const results = await Promise.all(verified.map(fetchBoard))
const stale = []
let matches = []
const now = Date.now()
const HOUR = 3_600_000

for (const { company, jobs, error } of results) {
  if (error) {
    stale.push({ name: company.name, provider: company.provider, error })
    continue
  }
  for (const job of jobs ?? []) {
    const where = job.location || ''
    if (!ROLE.test(job.title)) continue
    if (!INDIA.test(where) && !REMOTE.test(where)) continue
    if (locFilter && !where.toLowerCase().includes(locFilter)) continue

    const ageHours = job.posted ? (now - new Date(job.posted).getTime()) / HOUR : null
    if (maxAgeHours !== null && (ageHours === null || ageHours > maxAgeHours)) continue

    matches.push({
      company: company.name,
      sector: company.sector,
      priority: company.priority,
      source: `${company.provider}/${company.slug ?? company.tenant}`,
      title: job.title,
      location: where,
      isManagementTitle: MGMT_TITLE.test(job.title),
      ageHours: ageHours === null ? null : Math.round(ageHours),
      postedRaw: job.postedRaw ?? job.posted,
      description: job.description,
      url: job.url,
      salaryNote: `estimated — see companies.json notes for ${company.name}`,
    })
  }
}

// LinkedIn guest job search — casts a much wider net than the ~40 direct-ATS
// boards above, catching companies not yet in the registry at all (this is
// the fix for "LinkedIn has openings we're not finding"). No login needed.
const discoveredCompanies = new Set()
if (!noLinkedin) {
  console.error('Searching LinkedIn (guest, no login)…')
  const linkedinAgeHours = maxAgeHours ?? 24
  const queries = [
    { keywords: 'devops engineer OR site reliability engineer OR platform engineer OR cloud engineer OR infrastructure engineer', location: 'India' },
    { keywords: 'devops engineer OR site reliability engineer OR platform engineer', location: 'Remote' },
  ]
  for (const q of queries) {
    try {
      const jobs = await linkedinGuest({ ...q, maxAgeHours: linkedinAgeHours, maxPages: 5 })
      for (const job of jobs) {
        const where = job.location || ''
        if (!ROLE.test(job.title)) continue
        if (!INDIA.test(where) && !REMOTE.test(where)) continue
        if (locFilter && !where.toLowerCase().includes(locFilter)) continue

        const ageHours = job.posted ? (now - new Date(job.posted).getTime()) / HOUR : null
        if (maxAgeHours !== null && (ageHours === null || ageHours > maxAgeHours)) continue

        const known = lookupCompany(job.company)
        if (!known) discoveredCompanies.add(job.company)

        matches.push({
          company: job.company,
          sector: known?.sector ?? 'linkedin-discovered',
          priority: known?.priority ?? 'medium',
          source: 'linkedin',
          title: job.title,
          location: where,
          isManagementTitle: MGMT_TITLE.test(job.title),
          ageHours: ageHours === null ? null : Math.round(ageHours),
          postedRaw: job.postedRaw ?? job.posted,
          description: job.description ?? '',
          url: job.url,
          salaryNote: known ? `estimated — see companies.json notes for ${known.name}` : 'not in company registry — unverified comp',
        })
      }
    } catch (err) {
      stale.push({ name: `LinkedIn (${q.location})`, provider: 'linkedin', error: err.message })
    }
  }
}

// Freshest first, then by priority.
const prioRank = p => (p === 'high' ? 0 : p === 'medium' ? 1 : 2)
matches.sort((a, b) => (a.ageHours ?? 999) - (b.ageHours ?? 999) || prioRank(a.priority) - prioRank(b.priority))

// Dedup by URL — some registry entries share one ATS tenant (e.g. Oracle /
// Oracle Financial Services Software both resolve to the same ORC host) and
// would otherwise double-count the identical requisition under two names.
{
  const seenUrls = new Set()
  matches = matches.filter(m => {
    if (seenUrls.has(m.url)) return false
    seenUrls.add(m.url)
    return true
  })
}

if (verify) {
  console.error('Verifying job URLs to filter expired/removed postings (this may slow the scan)...')
  const verified = []
  for (const m of matches) {
    try {
      const res = await fetch(m.url, { headers: { 'user-agent': 'devops-sre-job-hunt/1.0' }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        stale.push({ name: m.company, provider: m.source, error: `HTTP ${res.status} on ${m.url}` })
        continue
      }
      const text = await res.text()
      const lower = text.toLowerCase()
      if (/no longer available|position has been filled|this job is closed|expired|404 not found|we no longer accept applications|position closed/.test(lower)) {
        stale.push({ name: m.company, provider: m.source, error: `Marked expired by page content` })
        continue
      }
      verified.push(m)
    } catch (err) {
      stale.push({ name: m.company, provider: m.source, error: err.message })
    }
  }
  matches = verified
}

await writeFile(join(ROOT, 'data/jobs.raw.json'),
  JSON.stringify({ scannedAt: new Date().toISOString(), matches, stale, discoveredCompanies: [...discoveredCompanies] }, null, 2))

if (notify) {
  const webhook = process.env.SLACK_WEBHOOK_URL
  if (!webhook) console.error('Notification requested but SLACK_WEBHOOK_URL not set in environment')
  else {
    try {
      const top = matches.slice(0, 5).map(m => `• ${m.company} — ${m.title} (${m.location}) <${m.url}|link>`).join('\n') || 'No fresh matches'
      const payload = { text: `Job scan: ${matches.length} matches found\n${top}` }
      await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) })
      console.error('Sent Slack notification')
    } catch (err) { console.error('Failed to send Slack notification:', err.message) }
  }
}

console.log(`${matches.length} DevOps/SRE/Platform/Cloud roles matched across tier-A boards\n`)
for (const m of matches) {
  const age = m.ageHours === null ? 'age unknown' : `${m.ageHours}h old`
  console.log(`  [${m.priority.padEnd(6)}] ${m.company} — ${m.title}`)
  console.log(`             ${m.location}  ·  ${age}  ·  ${m.postedRaw ?? ''}`)
  console.log(`             ${m.url}`)
}

if (stale.length) {
  console.log(`\n⚠  ${stale.length} board(s) failed — endpoint may have moved, do NOT read as "no openings":`)
  for (const s of stale) console.log(`     ${s.name} (${s.provider}) — ${s.error}`)
}

if (discoveredCompanies.size) {
  console.log(`\n📋 ${discoveredCompanies.size} company/companies hiring via LinkedIn but NOT in companies.json (worth adding):`)
  for (const c of discoveredCompanies) console.log(`     ${c}`)
}
