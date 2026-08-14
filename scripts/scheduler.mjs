#!/usr/bin/env node
/*
  Scheduler: runs scan.mjs then linkedin_scrape.mjs periodically, merges results,
  and writes a combined `data/jobs.raw.json` that downstream scripts use.

  Usage:
    node scripts/scheduler.mjs --intervalMinutes 15 --linkedinQuery "site reliability" --linkedinLocation "Bengaluru"

  Notes:
  - Requires `node` on PATH. For LinkedIn scraping, install Puppeteer: `npm install puppeteer`.
  - Set `SLACK_WEBHOOK_URL` to enable Slack notifications when `--notify` passed to scan.
  - Run in background (Windows): use Task Scheduler or run in a persistent terminal.
*/

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const execP = promisify(exec)
const ROOT = join(new URL('..', import.meta.url).pathname)

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

async function fileExists (p) { try { await stat(p); return true } catch { return false } }

async function runCommand (cmd, opts = {}) {
  try {
    const { stdout, stderr } = await execP(cmd, { ...opts, timeout: 120_000 })
    return { ok: true, stdout, stderr }
  } catch (err) {
    return { ok: false, error: err.message, stdout: err.stdout, stderr: err.stderr }
  }
}

function normalizeLinkedInJob (j) {
  return {
    company: j.company || '',
    sector: 'linkedin',
    priority: 'medium',
    source: `linkedin`,
    title: j.title || '',
    location: j.location || '',
    isManagementTitle: false,
    ageHours: null,
    postedRaw: null,
    description: '',
    url: j.url || '',
    salaryNote: null,
  }
}

function dedupeByUrl (arr) {
  const seen = new Set()
  const out = []
  for (const a of arr) {
    if (!a.url) continue
    if (seen.has(a.url)) continue
    seen.add(a.url)
    out.push(a)
  }
  return out
}

async function mergeJobs (scanPath, linkedinPath) {
  const scanExists = await fileExists(scanPath)
  const linkExists = await fileExists(linkedinPath)
  let scan = { matches: [], stale: [], scannedAt: new Date().toISOString() }
  if (scanExists) scan = JSON.parse(await readFile(scanPath, 'utf8'))
  let linkedin = { jobs: [] }
  if (linkExists) linkedin = JSON.parse(await readFile(linkedinPath, 'utf8'))

  const linkedinMatches = (linkedin.jobs || []).map(normalizeLinkedInJob)
  const combined = [...(scan.matches || []), ...linkedinMatches]
  const deduped = dedupeByUrl(combined)
  const out = { scannedAt: new Date().toISOString(), matches: deduped, stale: scan.stale || [] }
  await writeFile(scanPath, JSON.stringify(out, null, 2), 'utf8')
  return out
}

async function main () {
  const args = process.argv.slice(2)
  const intervalMinutes = args.includes('--intervalMinutes') ? Number(args[args.indexOf('--intervalMinutes') + 1]) : 15
  const linkedinQuery = args.includes('--linkedinQuery') ? args[args.indexOf('--linkedinQuery') + 1] : 'site reliability engineer'
  const linkedinLocation = args.includes('--linkedinLocation') ? args[args.indexOf('--linkedinLocation') + 1] : 'India'
  const notifyFlag = args.includes('--notify') ? '--notify' : ''

  const scanPath = join(ROOT, 'data', 'jobs.raw.json')
  const linkedinPath = join(ROOT, 'data', 'linkedin.json')

  console.log(`Scheduler starting: interval ${intervalMinutes}m, LinkedIn query="${linkedinQuery}" location="${linkedinLocation}"`)
  while (true) {
    console.log(`\n[${new Date().toISOString()}] Running scan...`)
    const scanCmd = `node scripts/scan.mjs --maxAgeHours 48 --verify ${notifyFlag}`.trim()
    const scanRes = await runCommand(scanCmd, { cwd: ROOT })
    if (!scanRes.ok) console.error('scan.mjs failed:', scanRes.error)
    else console.log('scan completed')

    // small delay to avoid immediate back-to-back polling
    await sleep(2000)

    console.log(`[${new Date().toISOString()}] Running LinkedIn scraper...`)
    const liCmd = `node scripts/linkedin_scrape.mjs --query "${linkedinQuery}" --location "${linkedinLocation}" --count 50`
    const liRes = await runCommand(liCmd, { cwd: ROOT })
    if (!liRes.ok) console.error('linkedin_scrape.mjs failed (is puppeteer installed?):', liRes.error)
    else console.log('LinkedIn scrape completed')

    // merge results and dedupe
    try {
      const merged = await mergeJobs(scanPath, linkedinPath)
      console.log(`Merged ${merged.matches.length} total matches written to ${scanPath}`)
    } catch (err) {
      console.error('Merge failed:', err.message)
    }

    console.log(`Sleeping ${intervalMinutes} minutes before next run...`)
    await sleep(intervalMinutes * 60 * 1000)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
