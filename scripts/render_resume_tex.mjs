#!/usr/bin/env node
// Renders resume/resume-content.json (+ a tailor.json overlay) to a standalone,
// compilable .tex file using the same ATS-safe preamble/environments as
// resume/master-resume.tex (plain \hfill-aligned lines, no tabularx/fontawesome/
// biblatex — those were dropped from master-resume.tex for exactly this reason:
// ATS parsers frequently read table cells out of visual order).
//
// This is the .tex counterpart to render_resume_pdf.mjs — same tailor.json
// contract (summary / skillsOrder / leadBulletGroup), same content-loss
// integrity check, same rule that content is only ever reordered/reworded,
// never invented. It does NOT touch render_resume_pdf.mjs or generate a PDF —
// PDF generation stays disabled per .claude/skills/tailor-resume-pdf.
//
// Usage:
//   node scripts/render_resume_tex.mjs --content resume/resume-content.json \
//     --tailor resume/tailors/<name>.json --out resume/variants/<name>.tex
//
// tailor.json fields consumed here (extra metadata fields, e.g. for a
// manifest, are ignored and safe to leave in the same file):
//   summary          - override summary paragraph text
//   skillsOrder       - array of skills[].category names, JD-relevant first;
//                        omitted categories keep relative order, appended after
//   leadBulletGroup   - id of the experience[0].bulletGroups[] entry to
//                        promote to lead under the current role

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++ }
  }
  return out
}

// Same tailoring semantics as render_resume_pdf.mjs's applyTailoring — kept
// as an independent copy rather than a shared import so this script has no
// dependency on anything in the (disabled) PDF pipeline.
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

// Same integrity check as render_resume_pdf.mjs: tailoring may only reorder
// skills/bullet-groups and reword the Summary, never drop a skill, bullet,
// or certification to make room.
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

// Minimal LaTeX special-character escaping for plain-text fields pulled from
// resume-content.json (which carries no LaTeX markup of its own — e.g. a
// bullet's "99.95% uptime" must become "99.95\% uptime" or the % starts a
// LaTeX comment and eats the rest of the line). Backslash is swapped for a
// placeholder token first so the later \textbackslash{} substitution can't
// also clobber unrelated characters introduced by the other replacements.
const BACKSLASH_PLACEHOLDER = 'BSLASH'
function esc (s) {
  return String(s)
    .split('\\').join(BACKSLASH_PLACEHOLDER)
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .split(BACKSLASH_PLACEHOLDER).join('\\textbackslash{}')
}

const PREAMBLE = String.raw`    %-----------------------------------------------------------------------------------------------------------------------------------------------%
    % The MIT License (MIT)
    %
    % Copyright (c) 2021 Jitin Nair
    %
    % Permission is hereby granted, free of charge, to any person obtaining a copy
    % of this software and associated documentation files (the "Software"), to deal
    % in the Software without restriction, including without limitation the rights
    % to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    % copies of the Software, and to permit persons to whom the Software is
    % furnished to do so, subject to the following conditions:
    %
    % THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    % IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    % FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    % AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    % LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    % OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
    % THE SOFTWARE.
    %
    %-----------------------------------------------------------------------------------------------------------------------------------------------%

    %----------------------------------------------------------------------------------------
    % DOCUMENT DEFINITION
    %----------------------------------------------------------------------------------------

    \documentclass[a4paper,10.999999pt]{article}

    %----------------------------------------------------------------------------------------
    % PACKAGES
    %----------------------------------------------------------------------------------------
    \usepackage[utf8]{inputenc}
    \usepackage{url}
    \usepackage{parskip}

    % other packages for formatting
    \RequirePackage{color}
    \RequirePackage{graphicx}
    \usepackage[usenames,dvipsnames]{xcolor}
    \usepackage[scale=0.85, top=0.85cm, bottom=0.85cm, left=0.85cm, right=0.85cm]{geometry}

    % tabularx environment
    \usepackage{tabularx}

    % for lists within experience section
    \usepackage{enumitem}
    \usepackage{setspace}

    % centered version of 'X' col. type
    \newcolumntype{C}{>{\centering\arraybackslash}X}

    % to prevent spillover of tabular into next pages
    \usepackage{supertabular}
    \usepackage{tabularx}
    \newlength{\fullcollw}
    \setlength{\fullcollw}{0.47\textwidth}

    % custom \section
    \usepackage{titlesec}
    \usepackage{multicol}
    \usepackage{multirow}

    % section formatting - BALANCED SPACING
    \titleformat{\section}{\large\scshape\raggedright}{}{0em}{}[\titlerule]
    \titlespacing{\section}{0pt}{5pt}{3pt}

    % global spacing tweaks - BALANCED
    \setlength{\parskip}{1pt}
    \setlength{\parindent}{0pt}
    \setlist[itemize]{nosep, topsep=1pt, partopsep=0pt, leftmargin=1em, itemsep=1pt}
    \linespread{0.962}\selectfont

    \usepackage[unicode, draft=false]{hyperref}
    \definecolor{linkcolour}{rgb}{0,0.2,0.6}
    \hypersetup{colorlinks,breaklinks,urlcolor=linkcolour,linkcolor=linkcolour}

    % job listing environments - BALANCED VERTICAL SPACE
    % Plain \hfill-aligned lines instead of tabularx: ATS parsers frequently
    % read table cells out of visual order (e.g. pull the date before the
    % title). A single line with \hfill renders identically but extracts as
    % ordinary left-to-right text.
    \newenvironment{jobshort}[2]
        {
        \noindent\textbf{#1}\hfill{#2}\par
        }
        {}

    \newenvironment{joblong}[2]
        {
        \noindent\textbf{#1}\hfill{#2}\par
        \vspace{-3.2pt}
        \begin{minipage}[t]{\linewidth}
        \begin{itemize}[nosep, after=\strut, leftmargin=0.5em, itemsep=1pt, label=\raisebox{0.2ex}{\tiny$\circ$}]
        }
        {
        \end{itemize}
        \end{minipage}
        \vspace{-3.2pt}
        }

    % Custom nested itemize style
    \newcommand{\subbulletitem}[1]{
      \item[\raisebox{0.20ex}{\small$-$}] #1
    }

    %----------------------------------------------------------------------------------------
    % BEGIN DOCUMENT
    %----------------------------------------------------------------------------------------
    \begin{document}

    \pagestyle{empty}

    %----------------------------------------------------------------------------------------
    % TITLE
    %----------------------------------------------------------------------------------------

`

function buildTex (content) {
  const h = content.header
  const lines = [PREAMBLE]

  // ---- Header ----
  lines.push('    \\begin{center}')
  lines.push(`    \\LARGE{${esc(h.name)}} \\\\[4pt]`)
  const segs = [
    `\\href{mailto:${h.email}}{${esc(h.email)}}`,
    esc(h.phone),
    h.github ? `\\href{${h.github.url}}{${esc(h.github.label)}}` : null,
    h.linkedin ? `\\href{${h.linkedin.url}}{${esc(h.linkedin.label)}}` : null,
  ].filter(Boolean)
  lines.push('    ' + segs.join(' \\ $|$ \\\n    '))
  lines.push('    \\end{center}')
  lines.push('')
  lines.push('    %----------------------------------------------------------------------------------------')
  lines.push('')

  // ---- Summary ----
  lines.push('    \\section{Summary}')
  lines.push(esc(content.summary))
  lines.push('')

  // ---- Skills ----
  lines.push('    % SKILLS SECTION')
  lines.push('    %----------------------------------------------------------------------------------------')
  lines.push('')
  lines.push('    \\section{Skills}')
  lines.push('    \\begin{itemize}[leftmargin=1.5em, itemsep=2pt, label=\\raisebox{0.25ex}{\\tiny$\\circ$}]')
  for (const s of content.skills) {
    lines.push(`    \\item \\textbf{${esc(s.category)}:} ${esc(s.items)}`)
  }
  lines.push('    \\end{itemize}')
  lines.push('')

  // ---- Work Experience ----
  lines.push('    %----------------------------------------------------------------------------------------')
  lines.push('    % WORK EXPERIENCE')
  lines.push('    %----------------------------------------------------------------------------------------')
  lines.push('')
  lines.push('    \\section{Work Experience}')
  lines.push('')
  content.experience.forEach((job) => {
    lines.push(`    \\begin{joblong}{${esc(job.title)}}{${esc(job.dates)}}`)
    lines.push(`    ${esc(job.company)}`)
    job.bulletGroups.forEach((g, gi) => {
      lines.push(`    \\item \\textbf{${esc(g.heading)}}`)
      lines.push('    \\begin{itemize}')
      for (const b of g.bullets) lines.push(`    \\item ${esc(b)}`)
      lines.push('    \\end{itemize}')
      if (gi < job.bulletGroups.length - 1) { lines.push('    \\vspace{5pt}'); lines.push('') }
    })
    lines.push('    \\end{joblong}')
    lines.push('')
  })

  // ---- Projects ----
  if (content.projects?.length) {
    lines.push('    %----------------------------------------------------------------------------------------')
    lines.push('    % PROJECTS SECTION')
    lines.push('    %----------------------------------------------------------------------------------------')
    lines.push('')
    lines.push(`    \\section{Projects${content.blogs ? ' and Blogs' : ''}}`)
    lines.push('')
    lines.push('    \\begin{itemize}[leftmargin=1.5em, itemsep=2pt, label=\\raisebox{0.25ex}{\\tiny$\\circ$}]')
    for (const p of content.projects) {
      const link = p.link ? ` \\href{${p.link.url}}{[${esc(p.link.label)}]}` : ''
      lines.push(`    \\item \\textbf{${esc(p.heading)}}${link}`)
      lines.push('    \\begin{itemize}[nosep, leftmargin=1.5em, itemsep=1pt, label=\\raisebox{0.25ex}{\\small$-$}]')
      for (const b of p.bullets) lines.push(`    \\item ${esc(b)}`)
      lines.push('    \\end{itemize}')
    }
    if (content.blogs) {
      lines.push(`    \\item \\textbf{${esc(content.blogs.label)}} \\href{${content.blogs.link.url}}{[${esc(content.blogs.link.label)}]}`)
    }
    lines.push('    \\end{itemize}')
    lines.push('')
  }

  // ---- Education ----
  lines.push('    %----------------------------------------------------------------------------------------')
  lines.push('    % EDUCATION SECTION')
  lines.push('    %----------------------------------------------------------------------------------------')
  lines.push('')
  lines.push('    \\section{Education}')
  lines.push('')
  lines.push(`    \\noindent\\textbf{${esc(content.education.degree)}}\\hfill{${esc(content.education.dates)}}\\par`)
  lines.push(`    \\noindent ${esc(content.education.school)}\\hfill{\\textbf{${esc(content.education.detail)}}}\\par`)
  lines.push('')
  lines.push('    \\vspace{3pt}')
  lines.push('')

  // ---- Certifications ----
  lines.push('    %----------------------------------------------------------------------------------------')
  lines.push('    % CERTIFICATIONS SECTION')
  lines.push('    %----------------------------------------------------------------------------------------')
  lines.push('')
  lines.push('    \\section{Certifications}')
  lines.push('')
  lines.push('    \\begin{itemize}[leftmargin=1.5em, itemsep=2pt, label=\\raisebox{0.25ex}{\\tiny$\\circ$}]')
  for (const c of content.certifications) lines.push(`    \\item ${esc(c)}`)
  lines.push('    \\end{itemize}')
  lines.push('')
  lines.push('    \\vspace{1.5pt}')
  lines.push('')
  lines.push('    \\end{document}')
  lines.push('')

  return lines.join('\n')
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  if (!args.content || !args.out) {
    console.error('Usage: node scripts/render_resume_tex.mjs --content <resume-content.json> [--tailor <tailor.json>] --out <file.tex>')
    process.exit(2)
  }
  const content = JSON.parse(await readFile(args.content, 'utf8'))
  const tailor = args.tailor ? JSON.parse(await readFile(args.tailor, 'utf8')) : null
  const tailored = applyTailoring(content, tailor)

  const before = countItems(content)
  const after = countItems(tailored)
  for (const key of Object.keys(before)) {
    if (before[key] !== after[key]) {
      throw new Error(
        `Tailoring dropped content: ${key} went from ${before[key]} to ${after[key]}. ` +
        `Tailoring may only reorder skills/bullet-groups and reword the Summary — ` +
        `it must never omit a skill, bullet, or certification.`)
    }
  }

  const tex = buildTex(tailored)
  await mkdir(dirname(args.out), { recursive: true })
  await writeFile(args.out, tex, 'utf8')
  console.log(`Wrote ${args.out}`)
}

main().catch(err => { console.error(err); process.exit(1) })
