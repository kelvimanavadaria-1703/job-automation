#!/usr/bin/env node
// All-sector scan: DevOps/SRE/Platform/Cloud roles in India + overseas countries.
// Reads each JD for visa/relocation wording and minimum years. No model calls.
//   node scripts/scan_global.mjs [--maxAgeDays 30] [--maxYears 5] [--noLinkedin] [--out data/global.raw.json] [--brief]
// --brief prints one compact line per visa YES/UNSTATED match (for the cloud routine).
// Japan: Japan Dev (japan-dev.com) tags each job with sponsors_visas / candidate_location; that tag decides visa.
// visa: YES = JD wording offers sponsorship/relocation, NO = JD rules it out,
// UNSTATED = silent (verify with the employer). evidence holds the JD wording.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import linkedin from '../adapters/linkedin_guest.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const MAX_DAYS = +arg('--maxAgeDays', 30)
const MAX_YEARS = +arg('--maxYears', 5)
const OUT = join(ROOT, arg('--out', 'data/global.raw.json'))
const ROLE = /\b(dev\s?ops|devsecops|site reliability|sre|platform engineer(ing)?|cloud (platform |infrastructure |operations |support )?engineer|cloud infrastructure|infrastructure (software |platform )?engineer|systems? reliability|reliability engineer|production engineer|kubernetes|forward[\s-]deployed (infra|sre|site|platform|reliab))/i
const DROP = /\b(director|head of|chief|vp|vice president|manager|principal|staff|distinguished|architect|lead|intern|internship|werkstudent|working student|apprentice|graduate|sales|account exec|marketing|recruit|counsel|data cent(er|re)|hardware|facilit|mechanical|electrical|manufactur|consultant|product owner|android|ios\b|frontend|brak|praktikum|customer reliability|integration reliability)/i
const C = {
  India: /india\b|bengaluru|bangalore|pune\b|hyderabad|gurgaon|gurugram|noida|mumbai|chennai|\bdelhi/i,
  Australia: /australia|sydney|melbourne|brisbane|perth|canberra|adelaide/i,
  Singapore: /singapore/i,
  Estonia: /estonia|tallinn|tartu/i,
  Ireland: /(?<!northern )\bireland|dublin|\bcork\b|galway|limerick/i,
  Czechia: /czech|prague|brno|ostrava/i,
  Poland: /poland|warsaw|krak[oó]w|wroc[lł]aw|gda[nń]sk|pozna[nń]|katowice/i,
  Finland: /finland|helsinki|espoo|tampere/i,
  Sweden: /sweden|stockholm|gothenburg|malm[oö]/i,
  Germany: /germany|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|d[uü]sseldorf|stuttgart|leipzig/i,
  Belgium: /belgium|brussels|antwerp|ghent|leuven/i,
  Netherlands: /netherlands|amsterdam|rotterdam|utrecht|eindhoven|the hague|\bdelft/i,
  'United Kingdom': /united kingdom|\buk\b|london|manchester|edinburgh/i,
  Japan: /japan|tokyo|osaka|fukuoka|kyoto|yokohama|nagoya|kawasaki/i,
  UAE: /\buae\b|united arab|dubai|abu dhabi/i,
  Spain: /spain|madrid|barcelona/i,
  Portugal: /portugal|lisbon|porto\b/i,
  Denmark: /denmark|copenhagen/i,
  Norway: /norway|oslo/i,
  Switzerland: /switzerland|zurich|zürich|geneva/i,
  Austria: /austria\b|vienna/i,
  Luxembourg: /luxembourg/i,
  'New Zealand': /new zealand|auckland|wellington/i,
  Canada: /canada|toronto|vancouver|montreal/i,
  Thailand: /thailand|bangkok/i,
  'Saudi Arabia': /saudi|riyadh/i,
  Cyprus: /cyprus|limassol/i,
  Hungary: /hungary|budapest/i
}
const NO = /(not (be )?(able|in a position) to (offer|provide|sponsor|support)[^.]{0,50}(visa|sponsor|relocat)|unable to (offer|provide|sponsor)[^.]{0,50}(visa|sponsor|permit)|cannot (offer|provide|sponsor|support)[^.]{0,40}(visa|sponsor|relocat)|(do|does|will|can) ?(not|n[’']t) (currently )?(offer|provide|sponsor|support)[^.]{0,40}(visa|sponsor|relocat)|\bno (visa|sponsorship|relocation)\b|sponsorship is (not|unavailable)|without (the need for |requiring )?(a )?(visa |employer |company )?sponsorship(?! for an export)|must (already )?(have|hold|possess|be)[^.]{0,50}(right to work|work(ing)? (authori[sz]ation|permit|rights)|citizen|authori[sz]ed to work)|(existing|valid|full|unrestricted|permanent|current)[^.]{0,20}(right to work|work(ing)? rights|work permit|work authori[sz]ation)|security clearance|(eu|australian) citizen|permanent residents? only)/i
const YES = /(visa (sponsorship|support|assistance)|sponsor(s|ing)? (your |a |work )?visas?|(offer|provide|support|cover|help)[^.]{0,50}(visa|work permit|relocation|relocate)|relocation (support|assistance|package|budget|bonus|allowance|benefit|help|cost|service)|\bwe (do )?sponsor)/i
const strip = h => String(h || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/&#39;|&rsquo;/g, '’').replace(/<\/(li|p|h\d|div)>|<br[^>]*>/gi, '. ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

function minYears (t) {
  const ys = [...t.matchAll(/(\d{1,2})\s*(?:\+|plus|or more)?\s*(?:[-–—]|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b([^.]{0,80})/gi)]
    .filter(m => /experience|engineer|working|hands|managing|building|operating|of (relevant|professional|industry)|in (a |an |the )?(devops|sre|site|software|cloud|infra|system|production|similar)/i.test(m[3]))
    .map(m => +m[1]).filter(n => n > 0 && n < 16)
  return ys.length ? Math.max(...ys) : null
}

const CUR = '(?:[€£$₹]|S\\$|A\\$|EUR|GBP|AUD|SGD|PLN|CZK|SEK|INR|AED|CHF)'
const PAY = new RegExp(`${CUR}\\s?\\d[\\d.,]{3,}[kK]?\\s*(?:[-–—]|to|and)\\s*${CUR}?\\s?\\d[\\d.,]{3,}[kK]?(?:\\s?(?:EUR|GBP|AUD|SGD|PLN|CZK|SEK|INR|AED|CHF|USD))?`)
const pay = t => t.match(PAY)?.[0] ?? null
// Japanese ask: JLPT N1/N2, business/native/fluent Japanese. 'Japanese is a plus' does not count.
const JP = /(jlpt\s?n[12]|\bn[12]\b[^.]{0,15}japanese|(business|native|fluent|professional)[- ]level (of )?japanese|(business|native|fluent)[^.]{0,12}japanese|japanese[^.]{0,20}(required|mandatory|must|fluen|business level|native))/i
const jpAsk = t => {
  const m = t.match(JP)
  if (!m) return null
  return /plus|bonus|nice to have|advantage|preferred|not required/i.test(t.slice(m.index, m.index + m[0].length + 40)) ? null : 'Japanese required'
}

const get = async u => {
  const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(40_000) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

const F = {
  greenhouse: async s => (await get(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`)).jobs.map(j => ({ title: j.title, offices: (j.offices || []).map(o => o.name).join(' / '), primary: j.location?.name ?? '', url: j.absolute_url, desc: j.content, posted: j.first_published ?? j.updated_at })),
  lever: async s => (await get(`https://api.lever.co/v0/postings/${s}?mode=json`)).map(j => ({ title: j.text, primary: [...new Set([j.categories?.location, ...(j.categories?.allLocations || [])])].join(' / '), url: j.hostedUrl, desc: [j.descriptionPlain, ...(j.lists || []).map(l => l.text + ' ' + l.content), j.additionalPlain].join('. '), posted: j.createdAt })),
  ashby: async s => (await get(`https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`)).jobs.filter(j => j.isListed !== false).map(j => ({ title: j.title, primary: [j.location, ...(j.secondaryLocations || []).map(l => l.location)].join(' / '), url: j.jobUrl, desc: j.descriptionPlain, pay: j.compensation?.compensationTierSummary, posted: j.publishedAt })),
  smartrecruiters: async s => {
    const all = new Map()
    for (const q of ['devops', 'site reliability', 'platform engineer', 'cloud engineer', 'infrastructure engineer']) {
      const d = await get(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100&q=${encodeURIComponent(q)}`)
      for (const j of d.content) if (ROLE.test(j.name) && !DROP.test(j.name) && Date.now() - new Date(j.releasedDate) < MAX_DAYS * 864e5) all.set(j.id, j)
    }
    const out = []
    for (const j of [...all.values()].slice(0, 60)) {
      let d = {}
      try { d = await get(`https://api.smartrecruiters.com/v1/companies/${s}/postings/${j.id}`) } catch {}
      out.push({ title: j.name, primary: j.location?.fullLocation || `${j.location?.city}, ${j.location?.country}`, url: `https://jobs.smartrecruiters.com/${s}/${j.id}`, desc: Object.values(d.jobAd?.sections || {}).map(x => x?.text || '').join('. '), posted: j.releasedDate })
    }
    return out
  }
}

const countries = w => Object.keys(C).filter(k => C[k].test(w || ''))
const boards = JSON.parse(await readFile(join(ROOT, 'data/global_boards.json'), 'utf8')).boards
const raw = []
const failed = []
let i = 0
await Promise.all(Array.from({ length: 10 }, async () => {
  while (i < boards.length) {
    const b = boards[i++]
    try { for (const j of await F[b.provider](b.slug)) raw.push({ ...j, company: b.slug, source: b.provider }) } catch (e) { failed.push(`${b.provider}/${b.slug}: ${e.message}`) }
  }
}))

// Arbeitnow's public feed: the JD text, not the board's tag, decides visa status.
for (let p = 1; p <= 8; p++) {
  try {
    for (const j of (await get(`https://www.arbeitnow.com/api/job-board-api?page=${p}`)).data) raw.push({ title: j.title, primary: j.location, url: j.url, desc: j.description, posted: j.created_at * 1000, company: j.company_name, source: 'arbeitnow' })
  } catch (e) { failed.push('arbeitnow: ' + e.message); break }
}

// Japan Dev: server-rendered Nuxt payload of the newest ~60 jobs, each tagged by the board.
const JDV = {}
try {
  const h = await (await fetch('https://japan-dev.com/jobs', { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(40_000) })).text()
  const a = JSON.parse(h.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1])
  const memo = new Map()
  const W = ['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'Set', 'Map', 'Date']
  const R = i => {
    if (typeof i !== 'number') return i
    if (memo.has(i)) return memo.get(i)
    const v = a[i]
    if (Array.isArray(v)) { if (W.includes(v[0])) { const r = R(v[1]); memo.set(i, r); return r } const o = []; memo.set(i, o); v.forEach(x => o.push(R(x))); return o }
    if (v && typeof v === 'object') { const o = {}; memo.set(i, o); for (const k in v) o[k] = R(v[k]); return o }
    return v
  }
  const jobs = new Map()
  const seenO = new Set()
  const walk = (o, d = 0) => { if (!o || typeof o !== 'object' || d > 14 || seenO.has(o)) return; seenO.add(o); if (o.sponsors_visas !== undefined && typeof o.title === 'string' && o.slug) jobs.set(o.id, o); for (const k in o) walk(o[k], d + 1) }
  walk(R(0))
  if (!jobs.size) throw new Error('no jobs in page')
  for (const j of jobs.values()) {
    const url = `https://japan-dev.com/jobs/${j.company?.slug || j.company_name}/${j.slug}`
    const yen = [j.salary_min, j.salary_max].filter(Boolean)
    JDV[url] = {
      visa: j.sponsors_visas === 'sponsors_visas_yes' ? 'YES' : 'NO',
      evidence: `Japan Dev tag: ${j.sponsors_visas === 'sponsors_visas_yes' ? 'sponsors visas' : 'no visa sponsorship'}, ${j.candidate_location === 'candidate_location_anywhere' ? 'applicants from anywhere' : 'applicants in Japan only'}`,
      lang: /business|fluent|native/.test(j.japanese_level_enum || '') ? 'Japanese required (' + j.japanese_level_enum.replace('japanese_level_', '').replace(/_/g, ' ') + ')' : null
    }
    raw.push({ title: j.title, primary: (j.location || 'Tokyo') + ', Japan', url, desc: [j.intro, j.details, j.requirements, j.skill_names].filter(x => typeof x === 'string').join('. '), posted: j.published_at || j.job_post_date, company: j.company_name || j.company?.name, source: 'japandev', pay: yen.length ? '¥' + yen.map(y => (y / 1e6).toFixed(1) + 'M').join('–') + '/yr' : null })
  }
} catch (e) { failed.push('japandev: ' + e.message) }

let liFail = 0
let liTried = 0
if (!process.argv.includes('--noLinkedin')) {
  for (const loc of ['Australia', 'Singapore', 'Estonia', 'Ireland', 'Czechia', 'Poland', 'Finland', 'Sweden', 'Germany', 'Belgium', 'Netherlands', 'Luxembourg', 'Japan', 'United Arab Emirates', 'New Zealand', 'Denmark', 'Portugal', 'Spain']) {
    const jobs = await linkedin({ keywords: '(devops OR "site reliability" OR "platform engineer" OR "cloud engineer") AND ("visa sponsorship" OR "relocation")', location: loc, maxAgeHours: 168, maxPages: 2 })
    if (!jobs.length) failed.push('linkedin ' + loc + ': 0 results')
    for (const j of jobs) {
      if (!ROLE.test(j.title) || DROP.test(j.title)) continue
      const id = j.url.match(/(\d{8,})/)?.[1]
      liTried++
      await new Promise(resolve => setTimeout(resolve, 1200))
      try {
        let r
        for (const wait of [0, 6000, 15000]) {
          await new Promise(resolve => setTimeout(resolve, wait))
          r = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) })
          if (r.status !== 429) break
        }
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const h = await r.text()
        raw.push({ ...j, primary: j.location + ', ' + loc, desc: h.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1] || '', source: 'linkedin' })
      } catch { liFail++ }
    }
  }
}

const seen = new Set()
const matches = []
for (const j of raw) {
  if (!ROLE.test(j.title) || DROP.test(j.title)) continue
  const age = Math.round((Date.now() - new Date(j.posted)) / 864e5)
  if (!(age <= MAX_DAYS)) continue
  let cs = countries(j.primary)
  if (!cs.length) cs = countries(j.offices)
  if (!cs.length) continue
  const key = j.url.replace(/[?#].*/, '') + (j.url.match(/gh_jid=\d+/)?.[0] || '')
  if (seen.has(key)) continue
  seen.add(key)
  const t = strip(j.desc)
  const yrs = minYears(t)
  if (yrs !== null && yrs > MAX_YEARS) continue
  const n = t.match(NO)
  const y = t.match(YES)
  const ctx = m => t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60)
  const jd = JDV[j.url]
  matches.push({ company: j.company, title: j.title, countries: cs, location: j.primary, ageDays: age, minYears: yrs, visa: jd ? jd.visa : n ? 'NO' : y ? 'YES' : 'UNSTATED', evidence: jd ? jd.evidence : n ? ctx(n) : y ? ctx(y) : null, lang: jd ? jd.lang : cs.includes('Japan') ? jpAsk(t) : null, pay: j.pay || pay(t), senior: /\b(senior|sr\.?|iii|iv)\b/i.test(j.title), source: j.source, url: j.url, jdRead: t.length > 300 })
}
await writeFile(OUT, JSON.stringify({ scannedAt: new Date().toISOString(), boards: boards.length, failed, linkedin: { tried: liTried, failed: liFail }, matches }, null, 1))
const n = v => matches.filter(m => m.visa === v).length
if (process.argv.includes('--brief')) {
  const rank = { YES: 0, UNSTATED: 1 }
  for (const m of matches.filter(m => m.visa !== 'NO').sort((a, b) => rank[a.visa] - rank[b.visa] || a.ageDays - b.ageDays)) {
    console.log([m.visa, m.countries.join('/'), m.company, m.title, m.location, m.ageDays + 'd', m.minYears ? m.minYears + 'y+' : '', m.pay || '', m.lang || '', m.source, m.url].join(' | '))
  }
}
console.log(`${matches.length} matches from ${raw.length} postings, ${boards.length} boards (${failed.length} failures). visa YES ${n('YES')}, UNSTATED ${n('UNSTATED')}, NO ${n('NO')}. LinkedIn JDs read ${liTried - liFail}/${liTried}`)
