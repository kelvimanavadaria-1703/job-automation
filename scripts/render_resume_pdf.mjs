#!/usr/bin/env node
// Renders resume/resume-content.json (+ an optional per-JD tailoring overlay)
// straight to a PDF using pdfkit — no LaTeX, no headless browser, no system
// packages beyond `npm install pdfkit` (pure JS, ~20 small deps, installs in
// seconds). Two reasons this replaced the LaTeX pipeline:
//   1. The cloud sandbox this runs in has no LaTeX distribution and gets a
//      fresh filesystem every run, so installing one every hour was never
//      going to be fast or reliable.
//   2. A plain single-column, real-text, no-tables/no-icons PDF is *more*
//      ATS-safe than the old LaTeX template's tabularx layout and icon font,
//      not less — most ATS parsers choke on multi-column tables and treat
//      icon glyphs as garbage characters.
//
// Usage:
//   node scripts/render_resume_pdf.mjs --content resume/resume-content.json \
//     [--tailor path/to/tailor.json] --out out/Company-Role.pdf
//
// tailor.json (all fields optional):
//   {
//     "summary": "override summary paragraph text",
//     "skillsOrder": ["SRE Practices", "Observability", ...],   // category
//        names from resume-content.json, JD-relevant ones first; any
//        categories omitted keep their original relative order, appended
//        after the ones listed
//     "leadBulletGroup": "sre"   // id of the bullet group (see
//        resume-content.json experience[0].bulletGroups[].id) that should
//        lead under the current role; the other group(s) follow, unchanged
//   }
//
// Content is never invented here — this script only reorders/relabels
// exactly what's in resume-content.json plus whatever override text the
// caller supplies for the Summary paragraph.

import PDFDocument from 'pdfkit'
import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const PAGE = { size: 'A4' }
const FONT = { regular: 'Helvetica', bold: 'Helvetica-Bold' }

// Candidate size configs, roomiest first — the first one whose measured
// content height fits one page wins. If none fit even at the tightest
// config, that tightest config is used anyway and the resume spills onto a
// second page rather than becoming illegibly small.
const CONFIGS = [
  { name: '10.5', margin: 32, name_: 17, title: 10.5, meta: 9, body: 10.5, bullet: 10, sectionGap: 7, itemGap: 3, bulletGap: 1.8, lineGapBody: 1, lineGapBullet: 0.6 },
  { name: '10', margin: 29, name_: 16.5, title: 10.5, meta: 9, body: 10, bullet: 9.5, sectionGap: 6, itemGap: 2.5, bulletGap: 1.5, lineGapBody: 0.8, lineGapBullet: 0.5 },
  { name: '9.5', margin: 26, name_: 16, title: 10, meta: 8.5, body: 9.5, bullet: 9, sectionGap: 5, itemGap: 2, bulletGap: 1.2, lineGapBody: 0.6, lineGapBullet: 0.4 },
  { name: '9', margin: 24, name_: 15.5, title: 9.5, meta: 8.5, body: 9, bullet: 8.5, sectionGap: 4, itemGap: 1.5, bulletGap: 1, lineGapBody: 0.5, lineGapBullet: 0.3 },
]

function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++ }
  }
  return out
}

function applyTailoring (content, tailor) {
  const c = structuredClone(content)
  if (tailor?.summary) c.summary = tailor.summary
  if (Array.isArray(tailor?.skillsOrder) && tailor.skillsOrder.length) {
    const byCat = new Map(c.skills.map(s => [s.category, s]))
    const ordered = []
    for (const cat of tailor.skillsOrder) {
      if (byCat.has(cat)) { ordered.push(byCat.get(cat)); byCat.delete(cat) }
    }
    for (const rest of byCat.values()) ordered.push(rest)
    c.skills = ordered
  }
  if (tailor?.leadBulletGroup && c.experience[0]?.bulletGroups) {
    const groups = c.experience[0].bulletGroups
    const idx = groups.findIndex(g => g.id === tailor.leadBulletGroup)
    if (idx > 0) {
      const [lead] = groups.splice(idx, 1)
      groups.unshift(lead)
    }
  }
  return c
}

// Shared layout pass, used twice: once purely to measure total content
// height (to pick a size config), once for real against the output doc. The
// two runs share this exact function so measurement can never drift from
// what's actually drawn.
function layout (doc, content, cfg, { draw }) {
  const pageWidth = doc.page.width
  const left = cfg.margin
  const right = pageWidth - cfg.margin
  const width = right - left
  let y = cfg.margin

  function newPageIfNeeded (h) {
    if (draw && y + h > doc.page.height - cfg.margin) {
      doc.addPage()
      y = cfg.margin
    }
  }

  function text (str, opts = {}) {
    const x = opts.x ?? left
    const w = opts.width ?? width
    const fontName = opts.bold ? FONT.bold : FONT.regular
    doc.font(fontName).fontSize(opts.size ?? cfg.body)
    const h = doc.heightOfString(str, { width: w, lineGap: opts.lineGap ?? 0, align: opts.align })
    newPageIfNeeded(h)
    if (draw) {
      doc.fillColor(opts.color ?? '#000000')
      doc.text(str, x, y, { width: w, lineGap: opts.lineGap ?? 0, align: opts.align, link: opts.link, underline: opts.underline })
    }
    y += h
    return h
  }

  function gap (h) {
    newPageIfNeeded(h)
    y += h
  }

  function rule () {
    newPageIfNeeded(4)
    if (draw) {
      doc.moveTo(left, y + 2).lineTo(right, y + 2).lineWidth(0.75).strokeColor('#333333').stroke()
    }
    y += 5
  }

  function sectionHeading (label) {
    gap(cfg.sectionGap)
    text(label.toUpperCase(), { bold: true, size: cfg.title, lineGap: 0 })
    rule()
  }

  function twoUp (leftStr, rightStr, { boldLeft = true, size = cfg.body } = {}) {
    doc.font(boldLeft ? FONT.bold : FONT.regular).fontSize(size)
    const rightW = doc.widthOfString(rightStr)
    const leftW = width - rightW - 6
    const h = Math.max(
      doc.heightOfString(leftStr, { width: leftW }),
      doc.heightOfString(rightStr, { width: rightW })
    )
    newPageIfNeeded(h)
    if (draw) {
      doc.font(boldLeft ? FONT.bold : FONT.regular).fontSize(size).fillColor('#000000')
      doc.text(leftStr, left, y, { width: leftW })
      doc.font(FONT.regular).fontSize(size)
      doc.text(rightStr, right - rightW, y, { width: rightW, align: 'right' })
    }
    y += h
  }

  function bullet (str, size = cfg.bullet, lineGap = cfg.lineGapBullet) {
    const bulletW = 12
    const textX = left + bulletW
    const textW = width - bulletW
    doc.font(FONT.regular).fontSize(size)
    const h = doc.heightOfString(str, { width: textW, lineGap })
    newPageIfNeeded(h)
    if (draw) {
      doc.fillColor('#000000')
      doc.text('•', left, y, { width: bulletW })
      doc.text(str, textX, y, { width: textW, lineGap })
    }
    y += h + cfg.bulletGap
  }

  // ---- Header ----
  text(content.header.name, { bold: true, size: cfg.name_, align: 'center' })
  gap(2)
  {
    const SEP = '   |   '
    const h = content.header
    const segments = [
      { str: h.email, url: `mailto:${h.email}` },
      { str: h.phone },
      h.github ? { str: h.github.label, url: h.github.url } : null,
      h.linkedin ? { str: h.linkedin.label, url: h.linkedin.url } : null,
    ].filter(Boolean)
    doc.font(FONT.regular).fontSize(cfg.meta)
    const fullStr = segments.map(s => s.str).join(SEP)
    const totalW = doc.widthOfString(fullStr)
    const lineH = doc.heightOfString(fullStr, { width })
    newPageIfNeeded(lineH)
    let x = left + (width - totalW) / 2
    if (draw) {
      doc.fillColor('#1a355e')
      segments.forEach((s, i) => {
        doc.text(s.str, x, y, { lineBreak: false })
        if (s.url) doc.link(x, y, doc.widthOfString(s.str), lineH, s.url)
        x += doc.widthOfString(s.str)
        if (i < segments.length - 1) { doc.text(SEP, x, y, { lineBreak: false }); x += doc.widthOfString(SEP) }
      })
    }
    y += lineH
  }
  gap(4)

  // ---- Summary ----
  sectionHeading('Summary')
  text(content.summary, { size: cfg.body, lineGap: cfg.lineGapBody })

  // ---- Skills ----
  sectionHeading('Skills')
  for (const s of content.skills) {
    bullet(`${s.category}: ${s.items}`, cfg.body, cfg.lineGapBody)
  }

  // ---- Work Experience ----
  sectionHeading('Work Experience')
  content.experience.forEach((job, i) => {
    twoUp(job.title, job.dates)
    text(job.company, { size: cfg.meta })
    gap(1)
    for (const g of job.bulletGroups) {
      if (g.heading) text(g.heading, { bold: true, size: cfg.body })
      for (const b of g.bullets) bullet(b)
    }
    if (i < content.experience.length - 1) gap(cfg.itemGap)
  })

  // ---- Projects ----
  if (content.projects?.length) {
    sectionHeading('Projects' + (content.blogs ? ' and Blogs' : ''))
    for (const p of content.projects) {
      text(p.heading + (p.link ? `  [${p.link.label}]` : ''), { bold: true, size: cfg.body })
      for (const b of p.bullets) bullet(b)
    }
    if (content.blogs) {
      bullet(`${content.blogs.label}: ${content.blogs.link.label}`)
    }
  }

  // ---- Education ----
  sectionHeading('Education')
  twoUp(content.education.degree, content.education.dates)
  twoUp(content.education.school, content.education.detail, { boldLeft: false })

  // ---- Certifications ----
  sectionHeading('Certifications')
  for (const c of content.certifications) bullet(c)

  return y
}

// Counts every keyword-bearing item so tailoring/rendering can never
// silently drop content to make it fit — reordering and rewording the
// Summary are the only edits allowed; nothing gets shorter or disappears.
function countItems (content) {
  const bulletCount = content.experience.reduce(
    (n, job) => n + job.bulletGroups.reduce((m, g) => m + g.bullets.length, 0), 0)
  const projectBullets = (content.projects || []).reduce((n, p) => n + p.bullets.length, 0)
  return {
    skills: content.skills.length,
    bullets: bulletCount,
    projectBullets,
    certifications: content.certifications.length,
  }
}

async function render ({ content, tailor, outPath }) {
  const tailored = applyTailoring(content, tailor)

  const before = countItems(content)
  const after = countItems(tailored)
  for (const key of Object.keys(before)) {
    if (before[key] !== after[key]) {
      throw new Error(
        `Tailoring dropped content: ${key} went from ${before[key]} to ${after[key]}. ` +
        `Tailoring may only reorder skills/bullet-groups and reword the Summary — ` +
        `it must never omit a skill, bullet, or certification to save space.`)
    }
  }

  // Pass 1: measure at each config (throwaway doc, never written to disk).
  const probe = new PDFDocument({ ...PAGE, margin: 0, bufferPages: true })
  let chosen = CONFIGS[CONFIGS.length - 1]
  const measurements = []
  for (const cfg of CONFIGS) {
    const totalHeight = layout(probe, tailored, cfg, { draw: false })
    const usable = probe.page.height - cfg.margin * 2
    measurements.push({ name: cfg.name, totalHeight, usable })
    if (totalHeight <= usable) { chosen = cfg; break }
  }
  if (process.env.RESUME_PDF_DEBUG) console.error(measurements)

  // Pass 2: real render at the chosen config. If the estimate was slightly
  // off, layout()'s own newPageIfNeeded() lets it spill to page 2 rather
  // than clip — matches "prioritize 1 page, 2 is fine if it must."
  await mkdir(dirname(outPath), { recursive: true })
  const doc = new PDFDocument({ ...PAGE, margin: chosen.margin, bufferPages: true })
  let pageCount = 1 // the initial page exists before this listener can be attached
  doc.on('pageAdded', () => { pageCount++ })
  const chunks = []
  doc.on('data', c => chunks.push(c))
  const done = new Promise(resolve => doc.on('end', resolve))
  layout(doc, tailored, chosen, { draw: true })
  doc.end()
  await done
  const buffer = Buffer.concat(chunks)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(outPath, buffer)

  return { outPath, pageCount, configUsed: chosen.name }
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  if (!args.content || !args.out) {
    console.error('Usage: node scripts/render_resume_pdf.mjs --content <resume-content.json> [--tailor <tailor.json>] --out <file.pdf>')
    process.exit(2)
  }
  const content = JSON.parse(await readFile(args.content, 'utf8'))
  const tailor = args.tailor ? JSON.parse(await readFile(args.tailor, 'utf8')) : null
  const result = await render({ content, tailor, outPath: args.out })
  console.log(`Wrote ${result.outPath} — ${result.pageCount} page(s), size config "${result.configUsed}"pt`)
  if (result.pageCount > 1) {
    console.log('Note: content did not fit on 1 page even at the smallest size config — spilled to page 2.')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
