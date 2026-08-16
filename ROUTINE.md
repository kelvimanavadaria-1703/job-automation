# DevOps/SRE/Platform BFSI Job-Hunt Routine — hourly

This file is the human-readable record of what the scheduled cloud agent does.
The routine itself is configured via Claude Code's `/schedule` (RemoteTrigger
API), not stored as code here — this doc is for Kelvi to audit and for future
edits to the prompt.

**Note:** this replaces the original 4x/day routine (kept around, disabled,
as `DevOps-SRE-BFSI-JobHunt` — superseded, no action needed unless you want
it deleted via https://claude.ai/code/routines). The active routine is
`BFSI DevOps/SRE Job Hunt (hourly)`.

## Schedule

Runs **every hour**, on the :26 minute mark (`26 * * * *` UTC).

## What each run does

1. **Fetch source files fresh from GitHub** (`kelvimanavadaria-1703/job-automation`,
   public repo) — the cloud sandbox has no persistent checkout, so `profile.json`,
   `data/companies.json`, `scripts/scan.mjs`, the adapters,
   `resume/resume-content.json`, and `scripts/render_resume_pdf.mjs` are
   pulled via `curl` at the start of every run, plus `npm install pdfkit`
   (pure JS, ~20 small packages, installs in seconds — no Chromium/LaTeX
   binary to fetch). Editing these files in the repo (and pushing to `main`)
   is how you change the routine's behavior without touching the routine
   prompt itself.
2. **Scan Tier-A boards** (`node scripts/scan.mjs --maxAgeHours 2 --linkedinMaxAgeHours 24 --verify`) —
   ~40 companies with real ATS APIs (Greenhouse, Lever, Workday, Oracle ORC),
   filtered to postings ≤2h old (tight window is safe at hourly cadence).
   Same call also runs a login-free LinkedIn guest search, but with its own
   24h lookback — LinkedIn's freshness labels are coarse relative buckets
   ("1 day ago") and its index lags new postings, so tying it to the 2h
   tier-A window was silently returning ~0 LinkedIn matches almost every run.
   The `--verify` live-fetch pass (filters expired/removed postings) skips
   LinkedIn URLs specifically — a generic-UA fetch against linkedin.com is
   likely to get bot-blocked and wrongly mark live postings as stale.
3. **Check Tier-B/C high-priority companies** (~10/run via WebFetch) — no
   public ATS, so their careers pages get checked directly each run.
4. **Merge, then dedup against Google Drive** — searches for
   `job-hunt-seen-urls.json` in Drive (not a Google Sheet — Sheets access
   turned out to be scope-restricted; Drive is the durable state this routine
   actually has) and drops anything already reported. This is what prevents
   LinkedIn's wider 24h window from re-reporting the same posting every hour.
5. **Tailor a resume per new match** — no LaTeX involved at all. The agent
   writes a small `tailor.json` overlay (JD-mirrored Summary text, which
   Skills categories should lead, which work-experience bullet-block leads)
   and runs `node scripts/render_resume_pdf.mjs --content resume/resume-content.json
   --tailor tailor.json --out Company-Role.pdf`, which renders a real PDF
   directly — no compiler, no markup an LLM could get syntactically wrong.
   Every factual claim (dates, employers, metrics) lives only in
   `resume-content.json` and is never touched by tailoring. The renderer
   auto-picks the largest font/margin config (from 10.5pt down to 9pt) that
   still fits everything on one page; if even the tightest config doesn't
   fit, it lets the resume spill onto a second page rather than clip content
   or shrink past legibility — one page is preferred, not mandatory.
6. **Send an email** via Gmail to kelvimanavadaria@gmail.com **only if this
   run found ≥1 new match.** No heartbeat — at hourly cadence a per-run
   "0 new matches" email would be constant noise. The tailored resume(s) go
   out as real PDF attachments (mimeType `application/pdf`) — ready to
   upload to an application form as-is, no manual compile step for Kelvi.
7. **Update `job-hunt-seen-urls.json`** in Drive with the newly-reported URLs.

## Why PDF generation moved off LaTeX (2026-08-16)

The routine used to have the agent write a full LaTeX `.tex` document from
scratch each run and try `pdflatex`. In practice the cloud sandbox never had
a LaTeX install, so every run fell back to pasting raw LaTeX source into the
email body — exactly the "sometimes throws an error" / "why is there LaTeX
in my email" problem this was meant to solve, just at 100% frequency instead
of occasionally.

The replacement (`scripts/render_resume_pdf.mjs`, using `pdfkit`) sidesteps
both problems at once:
- **No compiler needed.** `pdfkit` is pure JavaScript — `npm install` is the
  only setup step, and it's small enough to be fast every single hourly run.
- **More ATS-safe, not less.** The old LaTeX template's icon font and
  tabularx-based layout are exactly the kind of thing ATS parsers mis-read.
  The renderer produces a plain single-column, real-text (not image), no-table,
  no-icon PDF with standard section headers — the format ATS guides actually
  recommend.
- **Tailoring can't introduce syntax errors.** The agent only ever produces a
  small JSON overlay (reorder these categories, lead with this bullet group,
  use this Summary wording) — it never retypes structural markup, so there's
  nothing to get wrong the way a hand-written `\begin{itemize}` could be.

## Known limitations (by design, not bugs)

- **Salary is always an estimate.** BFSI JDs almost never publish pay.
- **Tier-B/C coverage is ~10/run, high-priority only.** Full-registry rotation
  (all 101 Tier-B/C companies) isn't attempted every run — only the
  high-priority subset, to keep each hourly run fast.
- **No heartbeat means silence is the normal case.**
- **Nothing is auto-applied.** This pipeline searches, matches, tailors, and
  reports only. Every application is still a manual, deliberate choice.
- **One page is preferred, not guaranteed.** The renderer tries four size
  configs before giving up and spilling onto a second page — for the current
  resume content this hasn't been needed, but a much longer future JD-driven
  tailoring change could in principle push it past one page.

## Maintenance

- If a Tier-A board starts erroring in the run log (`stale[]` in
  `data/jobs.raw.json`), the ATS slug/tenant likely moved — re-verify the
  endpoint and update `data/companies.json`.
- The routine prompt lives in the RemoteTrigger routine config, not in this
  repo — use `/schedule` (or the RemoteTrigger API directly) to view/edit it.
  This doc should be kept in sync whenever that prompt changes materially.
- If hourly proves too noisy or too expensive, drop back to a few times a day
  by editing the routine's `cron_expression` — no repo file needs to change.
