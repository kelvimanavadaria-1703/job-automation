#!/usr/bin/env node
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { join, basename, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')
const RESUME_DIR = join(ROOT, 'resume')
const TAILORED_DIR = join(RESUME_DIR, 'tailored')
const GENERATED_DIR = join(RESUME_DIR, 'generated')

function sanitize (s) {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase()
}

async function findTailoredTemplate (companies, companyName) {
  const files = await readdir(TAILORED_DIR)
  const key = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '')
  for (const f of files) {
    const name = f.toLowerCase()
    if (name.includes(key) || key.includes(name.replace(/[^a-z0-9]+/g, '')) ) return join(TAILORED_DIR, f)
  }
  // also try partial word matches
  for (const f of files) {
    const name = f.toLowerCase()
    const words = companyName.toLowerCase().split(/\s+/)
    for (const w of words) if (w.length > 3 && name.includes(w)) return join(TAILORED_DIR, f)
  }
  return null
}

function replaceOnceAfterSummary (tex, insertTex) {
  const marker = "\\section{Summary}"
  const i = tex.indexOf(marker)
  if (i === -1) return tex
  const after = tex.indexOf('\n', i + marker.length)
  if (after === -1) return tex
  return tex.slice(0, after + 1) + insertTex + '\n' + tex.slice(after + 1)
}

async function runPdflatex (texPath, outDir) {
  return new Promise((resolve) => {
    const cmd = `pdflatex -interaction=nonstopmode -halt-on-error -output-directory="${outDir}" "${texPath}"`
    exec(cmd, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: err.message, stdout, stderr })
      resolve({ ok: true, stdout, stderr })
    })
  })
}

async function main () {
  const args = process.argv.slice(2)
  const countArg = args.includes('--count') ? Number(args[args.indexOf('--count') + 1]) : 3

  await mkdir(GENERATED_DIR, { recursive: true })

  const jobsRaw = JSON.parse(await readFile(join(ROOT, 'data', 'jobs.raw.json'), 'utf8'))
  const matches = jobsRaw.matches || []

  const toProcess = matches.slice(0, countArg)
  const tailoredFiles = await readdir(TAILORED_DIR)

  for (const job of toProcess) {
    const safeName = `${sanitize(job.company)}-${sanitize(job.title)}`
    const outTex = join(GENERATED_DIR, `${safeName}.tex`)
    const outPdf = join(GENERATED_DIR, `${safeName}.pdf`)

    const tailored = await findTailoredTemplate(tailoredFiles, job.company)
    if (tailored) {
      // Copy tailored template and insert a small header line mentioning company/role
      let tex = await readFile(tailored, 'utf8')
      const insert = `\\textbf{Targeted: ${job.title} at ${job.company}}\\[4pt]`
      tex = replaceOnceAfterSummary(tex, insert)
      await writeFile(outTex, tex, 'utf8')
      console.log(`Wrote tailored tex ${outTex} (template ${basename(tailored)})`)
    } else {
      // Use master template
      const master = join(RESUME_DIR, 'master-resume.tex')
      let tex = await readFile(master, 'utf8')
      const insert = `\\textbf{Targeted: ${job.title} at ${job.company}}\\[4pt]`
      tex = replaceOnceAfterSummary(tex, insert)
      await writeFile(outTex, tex, 'utf8')
      console.log(`Wrote generated tex ${outTex} (from master template)`)
    }

    // Attempt to compile to PDF if pdflatex is available
    const res = await runPdflatex(outTex, GENERATED_DIR)
    if (!res.ok) {
      console.log(`pdflatex failed or not available for ${outTex}: ${res.error}. Tex left in ${outTex}`)
    } else {
      console.log(`Generated PDF ${outPdf}`)
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
