#!/usr/bin/env node
/*
  LinkedIn scraping skeleton using Puppeteer.
  Notes:
  - This script does NOT include credentials. You must either provide a LinkedIn session cookie file at `~/.linkedin_cookies.json` or run the script interactively to log in.
  - Install puppeteer: `npm install puppeteer` (or `npm i puppeteer --save` in this repo)
  - LinkedIn scraping may violate LinkedIn's terms; use cautiously and only for personal, low-volume checks.

  Usage examples:
    node scripts/linkedin_scrape.mjs --query "site reliability engineer" --location "Bengaluru" --count 20
*/

import fs from 'fs'
import { join } from 'path'
import process from 'process'

async function main () {
  const args = process.argv.slice(2)
  const q = args.includes('--query') ? args[args.indexOf('--query') + 1] : 'site reliability engineer'
  const loc = args.includes('--location') ? args[args.indexOf('--location') + 1] : 'India'
  const count = args.includes('--count') ? Number(args[args.indexOf('--count') + 1]) : 20

  try {
    const puppeteer = await import('puppeteer')
    const browser = await puppeteer.launch({ headless: false })
    const page = await browser.newPage()

    // Load cookies if user saved them earlier
    const cookieFile = join(process.env.HOME || process.env.USERPROFILE || '.', '.linkedin_cookies.json')
    if (fs.existsSync(cookieFile)) {
      const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'))
      await page.setCookie(...cookies)
      console.log('Loaded cookies from', cookieFile)
    } else {
      console.log('No cookie file found at', cookieFile)
      console.log('The browser will open and you can log into LinkedIn manually. After login, you should save cookies for future runs.')
    }

    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}&location=${encodeURIComponent(loc)}&f_TP=1,2` // last 24/7 days
    console.log('Navigating to', searchUrl)
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60_000 })

    // Wait for job cards to appear
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

    console.log('Found', jobs.length, 'jobs; saving to data/linkedin.json')
    await fs.promises.mkdir('data', { recursive: true })
    await fs.promises.writeFile('data/linkedin.json', JSON.stringify({ scannedAt: new Date().toISOString(), query: q, location: loc, jobs }, null, 2))

    // Optionally save cookies for reuse
    const cookies = await page.cookies()
    fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2))
    console.log('Saved cookies to', cookieFile)

    await browser.close()
  } catch (err) {
    console.error('Error:', err.message)
    console.error('If puppeteer is not installed, run: npm install puppeteer')
    process.exit(1)
  }
}

main()
