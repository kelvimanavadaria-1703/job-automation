export default async function searchLinkedIn(query, location, count = 20){
  // Try to use existing saved data first
  try {
    const fs = await import('fs/promises')
    const p = 'data/linkedin.json'
    const stat = await fs.stat(p).catch(()=>null)
    if (stat) {
      const d = JSON.parse(await fs.readFile(p, 'utf8'))
      return d.jobs || []
    }
  } catch (err) { /* ignore */ }

  // If Puppeteer available, launch interactive browser to perform search
  try {
    const puppeteer = await import('puppeteer')
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}`
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60_000 })
    await page.waitForSelector('.jobs-search-results__list-item', { timeout: 20_000 })
    const jobs = await page.evaluate((count) => {
      const rows = Array.from(document.querySelectorAll('.jobs-search-results__list-item'))
      return rows.slice(0, count).map(r => {
        const title = r.querySelector('a.job-card-list__title')?.innerText?.trim() || ''
        const company = r.querySelector('a.job-card-container__company-name')?.innerText?.trim() || ''
        const location = r.querySelector('.job-card-container__metadata-item')?.innerText?.trim() || ''
        const link = r.querySelector('a.job-card-list__title')?.href || ''
        return { title, company, location, url: link }
      })
    }, count)
    await browser.close()
    return jobs
  } catch (err) {
    throw new Error('LinkedIn adapter: puppeteer not available or search failed: ' + err.message)
  }
}
