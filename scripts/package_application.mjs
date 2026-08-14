#!/usr/bin/env node
import { readFile, writeFile, readdir, mkdir, copyFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')

function sanitize (s) {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase()
}

async function fileExists (p) {
  try { await stat(p); return true } catch { return false }
}

async function main () {
  const args = process.argv.slice(2)
  const count = args.includes('--count') ? Number(args[args.indexOf('--count') + 1]) : 5

  const jobsRaw = JSON.parse(await readFile(join(ROOT, 'data', 'jobs.raw.json'), 'utf8'))
  const matches = jobsRaw.matches || []
  const toProcess = matches.slice(0, count)

  const TEMPLATE = await readFile(join(ROOT, 'templates', 'cover_letter.tpl.md'), 'utf8')
  await mkdir(join(ROOT, 'applications'), { recursive: true })

  for (const job of toProcess) {
    const safe = `${sanitize(job.company)}-${sanitize(job.title)}`
    const appDir = join(ROOT, 'applications', safe)
    await mkdir(appDir, { recursive: true })

    // find generated resume PDF if available
    const pdfPath = join(ROOT, 'resume', 'generated', `${safe}.pdf`)
    const texPath = join(ROOT, 'resume', 'generated', `${safe}.tex`)
    if (await fileExists(pdfPath)) {
      await copyFile(pdfPath, join(appDir, `${safe}.pdf`))
      console.log(`Copied PDF resume for ${job.company} -> applications/${safe}/`)
    } else if (await fileExists(texPath)) {
      await copyFile(texPath, join(appDir, `${safe}.tex`))
      console.log(`Copied TeX resume for ${job.company} -> applications/${safe}/`)
    } else {
      // fallback to master-resume.tex
      const master = join(ROOT, 'resume', 'master-resume.tex')
      if (await fileExists(master)) {
        await copyFile(master, join(appDir, `master-resume.tex`))
        console.log(`Copied master resume for ${job.company} -> applications/${safe}/`)        
      } else {
        console.log(`No resume found for ${job.company} (${safe}); skipping resume copy.`)
      }
    }

    // render cover letter
    const letter = TEMPLATE.replace(/{{COMPANY}}/g, job.company).replace(/{{TITLE}}/g, job.title)
    await writeFile(join(appDir, 'cover_letter.md'), letter, 'utf8')

    // write job metadata for record
    await writeFile(join(appDir, 'metadata.json'), JSON.stringify({ company: job.company, title: job.title, url: job.url, scannedAt: jobsRaw.scannedAt }, null, 2), 'utf8')

    console.log(`Packaged application for ${job.company} into applications/${safe}/`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
