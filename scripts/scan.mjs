#!/usr/bin/env node
// Scans every tier-A (verified public ATS) company in data/companies.json for
// DevOps/SRE/Platform/Cloud roles matching profile.json, and writes
// data/jobs.raw.json for the daily routine to read.
//
//   node scripts/scan.mjs              # all verified tier-A boards
//   node scripts/scan.mjs --fresh48    # only postings <= 48h old
//   node scripts/scan.mjs --loc pune   # location substring filter
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

const ENDPOINTS = {
  greenhouse: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`,
  lever: s => `https://api.lever.co/v0/postings/${s}?mode=json`,
}

const NORMALISE = {
  greenhouse: d => (d.jobs ?? []).map(j => ({
    title: j.title, location: j.location?.name ?? '', url: j.absolute_url,
    description: j.content ?? '', posted: j.first_published ?? j.updated_at,
  })),
  lever: d => (Array.isArray(d) ? d : []).map(j => ({
    title: j.text, location: j.categories?.location ?? '', url: j.hostedUrl,
    description: j.descriptionPlain ?? j.description ?? '', posted: j.createdAt,
  })),
}

// Workday CXS — POST-based search API, distinct shape from the GET boards above.
async function fetchWorkday (company) {
  const url = `https://${company.tenant}.${company.wdHost}.myworkdayjobs.com/wday/cxs/${company.tenant}/${company.site}/jobs`
  const out = []
  // Query per role keyword and de-dupe by externalPath — a single broad query
  // sometimes misses postings that a narrower one catches, and Workday search
  // is fielded text search, not a full listing.
  const keywords = ['site reliability', 'devops', 'platform engineer', 'cloud engineer']
  const seen = new Set()
  for (const kw of keywords) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'devops-sre-job-hunt/1.0' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: kw }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const j of data.jobPostings ?? []) {
        if (seen.has(j.externalPath)) continue
        seen.add(j.externalPath)
        out.push({
          title: j.title,
          location: j.locationsText ?? '',
          url: `${company.jobViewBase}${j.externalPath}`,
          description: '', // Workday CXS search response has no JD body; routine WebFetches the url if needed
          posted: workdayRelativeToISO(j.postedOn),
          postedRaw: j.postedOn,
        })
      }
    } catch { /* keyword miss, try the next one */ }
  }
  return out
}

// Workday returns relative strings like "Posted Today" / "Posted 3 Days Ago",
// not timestamps. Convert to an approximate ISO date so it sorts/filters the
// same way as Greenhouse/Lever's real timestamps. "Posted 30+ Days Ago" is
// left as a 30-day floor — precision beyond that doesn't matter for a <=48h filter.
function workdayRelativeToISO (postedOn) {
  if (!postedOn) return null
  const now = Date.now()
  const DAY = 86_400_000
  if (/today/i.test(postedOn)) return new Date(now).toISOString()
  const m = postedOn.match(/(\d+)\+?\s*Day/i)
  if (m) return new Date(now - Number(m[1]) * DAY).toISOString()
  return new Date(now - 30 * DAY).toISOString() // unresolvable strings (e.g. "30+ Days Ago") — treat as stale
}

async function fetchBoard (company) {
  if (company.provider === 'workday') {
    try {
      return { company, jobs: await fetchWorkday(company) }
    } catch (err) {
      return { company, error: err.message }
    }
  }
  const build = ENDPOINTS[company.provider]
  if (!build) return { company, error: `unsupported provider ${company.provider}` }
  try {
    const res = await fetch(build(company.slug), {
      headers: { 'user-agent': 'devops-sre-job-hunt/1.0' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return { company, error: `HTTP ${res.status}` }
    return { company, jobs: NORMALISE[company.provider](await res.json()) }
  } catch (err) {
    return { company, error: err.message }
  }
}

const args = process.argv.slice(2)
const fresh48Only = args.includes('--fresh48')
const locFilter = args.includes('--loc') ? args[args.indexOf('--loc') + 1]?.toLowerCase() : null

const registry = JSON.parse(await readFile(join(ROOT, 'data/companies.json'), 'utf8'))
const verified = registry.companies.filter(c => c.tier.includes('A'))

console.error(`Scanning ${verified.length} verified tier-A boards…\n`)

const results = await Promise.all(verified.map(fetchBoard))
const stale = []
const matches = []
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
    if (fresh48Only && (ageHours === null || ageHours > 48)) continue

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

// Freshest first, then by priority.
const prioRank = p => (p === 'high' ? 0 : p === 'medium' ? 1 : 2)
matches.sort((a, b) => (a.ageHours ?? 999) - (b.ageHours ?? 999) || prioRank(a.priority) - prioRank(b.priority))

await writeFile(join(ROOT, 'data/jobs.raw.json'),
  JSON.stringify({ scannedAt: new Date().toISOString(), matches, stale }, null, 2))

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
