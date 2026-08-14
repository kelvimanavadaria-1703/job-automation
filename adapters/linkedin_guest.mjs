// LinkedIn's public "guest" job-search endpoint — the server-rendered HTML
// that powers infinite-scroll on linkedin.com/jobs for logged-out visitors.
// No login, no cookies, no browser needed: a plain fetch. This avoids both
// problems with the Puppeteer approach — it doesn't depend on an
// authenticated session (ToS risk on an unattended/scheduled script) and it
// works from anywhere, including a cloud sandbox with no display.
//
// Coverage is real but not total: LinkedIn caps guest pagination around a
// few hundred results per query and some postings are logged-in-only. Treat
// this as a strong supplement to the direct-ATS adapters, not a replacement.
const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function decodeEntities (s) {
  if (!s) return s
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
}

function parsePage (html) {
  const items = html.split('<li>').slice(1)
  const jobs = []
  for (const item of items) {
    const title = decodeEntities(item.match(/base-search-card__title">\s*([\s\S]*?)\s*<\/h3>/)?.[1])
    const company = decodeEntities(item.match(/base-search-card__subtitle">[\s\S]*?>\s*([\s\S]*?)\s*<\/a>/)?.[1])
    const location = decodeEntities(item.match(/job-search-card__location">\s*([\s\S]*?)\s*<\/span>/)?.[1])
    const url = item.match(/href="(https:\/\/[^"?]+)/)?.[1]
    const posted = item.match(/datetime="([^"]+)"/)?.[1]
    if (!title || !url) continue
    jobs.push({ title, company: company || '', location: location || '', url, posted: posted || null, postedRaw: posted || null })
  }
  return jobs
}

/**
 * @param {{keywords: string, location?: string, maxAgeHours?: number, maxPages?: number}} opts
 */
export default async function searchLinkedInGuest ({ keywords, location = 'India', maxAgeHours = 24, maxPages = 5 }) {
  const tprSeconds = Math.max(3600, Math.min(Math.round(maxAgeHours * 3600), 604800)) // LinkedIn only offers up to ~7 days
  const out = []
  const seen = new Set()
  const PAGE_SIZE = 10

  for (let page = 0; page < maxPages; page++) {
    const start = page * PAGE_SIZE
    const url = `${BASE}?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&f_TPR=r${tprSeconds}&start=${start}`
    let res
    try {
      res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) })
    } catch {
      break
    }
    if (!res.ok) break
    const html = await res.text()
    const jobs = parsePage(html)
    if (jobs.length === 0) break
    for (const j of jobs) {
      if (seen.has(j.url)) continue
      seen.add(j.url)
      out.push(j)
    }
    if (jobs.length < PAGE_SIZE) break
    await new Promise(r => setTimeout(r, 400)) // polite pacing between pages
  }
  return out
}
