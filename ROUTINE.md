# DevOps/SRE/Platform BFSI Job-Hunt Routine — 2x/day, full daily coverage

This file is the human-readable record of what the scheduled cloud agent does.
The routine itself is configured via Claude Code's `/schedule` (RemoteTrigger
API), not stored as code here — this doc is for Kelvi to audit and for future
edits to the prompt.

**Note:** there's an older, unrelated 4x/day routine kept around, disabled,
as `DevOps-SRE-BFSI-JobHunt` — superseded, no action needed unless you want
it deleted via https://claude.ai/code/routines. The active routine is
`BFSI DevOps/SRE Job Hunt (2x/day, full daily coverage)`.

## Schedule

Runs **2x/day**, on the :26 minute mark, at UTC hours 2/14
(`26 2,14 * * *`) — roughly 7:56am / 7:56pm IST.

History (all 2026-08-17, same day): hourly → 4x/day + full-101-company scan
(briefly, never actually fired) → 2x/day + rotating-slice scan (~15/run,
full registry every ~3.5 days) → **2x/day + full-101-company coverage split
across the day's 2 runs** (current), after Kelvi clarified he wanted full
Tier-B/C coverage every single day, not spread across the week, while still
bounding cost via 2x/day frequency and splitting the 101 companies roughly
in half between the two daily runs rather than fetching all of them in one
run. See step 3 below for exactly how the split works.

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
2. **Scan Tier-A boards** (`node scripts/scan.mjs --maxAgeHours 24 --linkedinMaxAgeHours 24 --verify`) —
   ~40 companies with real ATS APIs (Greenhouse, Lever, Workday, Oracle ORC),
   filtered to postings ≤24h old (≈2x safety margin over the ~12h gap between
   runs at this cadence). Same call also runs a login-free LinkedIn guest
   search, with its own 24h lookback — LinkedIn's freshness labels are
   coarse relative buckets ("1 day ago") rather than precise timestamps, so
   its window doesn't need to track the tier-A one. The `--verify` live-fetch
   pass (filters expired/removed postings) skips LinkedIn URLs specifically —
   a generic-UA fetch against linkedin.com is likely to get bot-blocked and
   wrongly mark live postings as stale.
3. **Check ~half of Tier-B/C companies per run** (~50-51/run via WebFetch)
   — no public ATS, so their careers pages get checked directly. The
   (priority-sorted) B/C registry is interleaved by list-index parity: even
   indices go to the UTC-02 run, odd indices go to the UTC-14 run. This
   keeps a representative mix of high/medium/low priority companies in
   *both* runs (not all the best ones in one run and all the worst in the
   other), and means **the full ~101-company registry is covered exactly
   once every calendar day** — nothing rotates or waits for a future day.
   Splitting across 2 runs (rather than one 101-company run) keeps any
   single run's WebFetch volume, and therefore cost, roughly half of what
   a single-run full scan would be.
4. **Merge, then dedup against Google Drive** — searches for
   `job-hunt-seen-urls.json` in Drive (not a Google Sheet — Sheets access
   turned out to be scope-restricted; Drive is the durable state this routine
   actually has) and drops anything already reported. This is what prevents
   LinkedIn's wider 24h window from re-reporting the same posting every hour.
5. **Send an email listing the new matches — no resume tailoring right
   now.** Resume tailoring (steps 5-6 as they used to read here — write a
   `tailor.json` overlay, render via `render_resume_pdf.mjs`, attach a PDF)
   was disabled on 2026-08-18 to cut token usage per run; the plan is to
   re-enable it once cost is under control. Step 0's fetch list no longer
   pulls `resume/resume-content.json` or `scripts/render_resume_pdf.mjs`,
   and no longer runs `npm install pdfkit`, since nothing in the run
   consumes them while this is off. Send ONE email via Gmail to
   kelvimanavadaria@gmail.com **only if this run found ≥1 new match** (no
   heartbeat — a per-run "0 new matches" email would be constant noise),
   plain prose, listing every new match: company, title, location,
   freshness, JD link, one-line fit rationale. No attachment.
6. **Update `job-hunt-seen-urls.json`** in Drive with the newly-reported URLs.

## Why PDF generation moved off LaTeX (2026-08-16, tailoring itself paused 2026-08-18)

**Note:** the resume-tailoring step described below is currently disabled
(see step 5 above) — kept here as background for when it's re-enabled, not
as a description of what the routine does right now.

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
- **Tier-B/C coverage is once/day, not once/run.** Any single company is
  only checked in whichever of the day's 2 runs its list-index parity lands
  in — a posting that appears and gets filled within roughly the same day
  could still be missed, though this is a much smaller gap than the earlier
  rotating-slice design's ~3.5 days. Tier-A (the ~40 companies with real
  ATS APIs) has no such gap, since it's cheap enough to scan in full every run.
- **No heartbeat means silence is the normal case.**
- **Nothing is auto-applied.** This pipeline searches, matches, and reports
  only. Every application is still a manual, deliberate choice.
- **Resume tailoring is paused (since 2026-08-18).** Runs currently just
  list new openings by email — no per-match PDF is generated or attached.
  This was a deliberate token-cost cut, not a bug; re-enable by restoring
  step 5/6 (see "Why PDF generation moved off LaTeX" above) in the routine
  prompt via `/schedule`.

## Maintenance

- If a Tier-A board starts erroring in the run log (`stale[]` in
  `data/jobs.raw.json`), the ATS slug/tenant likely moved — re-verify the
  endpoint and update `data/companies.json`.
- The routine prompt lives in the RemoteTrigger routine config, not in this
  repo — use `/schedule` (or the RemoteTrigger API directly) to view/edit it.
  This doc should be kept in sync whenever that prompt changes materially.
- The two independent levers are cadence (`cron_expression`, currently
  2x/day) and how the Tier-B/C registry is split per run (currently an
  even/odd interleave across exactly 2 daily runs so coverage completes
  every day). If budget pressure returns, splitting into more, smaller
  slots (like the earlier ~15/run rotating design) trades per-run cost for
  a longer full-coverage cycle — either lever can move without touching
  the other, no repo file needs to change for either.
