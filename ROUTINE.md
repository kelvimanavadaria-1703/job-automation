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
   `data/companies.json`, `scripts/scan.mjs`, the adapters, and
   `resume/master-resume.tex` are pulled via `curl` at the start of every run.
   Editing these files in the repo (and pushing to `main`) is how you change
   the routine's behavior without touching the routine prompt itself.
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
5. **Tailor a resume per new match** — starts from the exact byte content of
   the downloaded `resume/master-resume.tex`, then makes only targeted edits
   (reorder Skills lines, swap which work-experience bullet-block leads,
   reword the Summary) rather than retyping the LaTeX from scratch. Self-checks
   brace/environment balance before finishing. Never invents employers, dates,
   or metrics.
6. **Send an email** via Gmail to kelvimanavadaria@gmail.com **only if this
   run found ≥1 new match.** No heartbeat — at hourly cadence a per-run
   "0 new matches" email would be constant noise. The tailored resume(s) go
   out as real `.tex` file attachments (mimeType `application/x-tex`) — the
   LaTeX source is never pasted into the email body. If `pdflatex` happens to
   be available and compiles cleanly, the PDF is attached too, but as of
   2026-08 the sandbox doesn't have a LaTeX install, so `.tex` + an "open in
   Overleaf" note is the normal path, not a fallback for rare failures.
7. **Update `job-hunt-seen-urls.json`** in Drive with the newly-reported URLs.

## Known limitations (by design, not bugs)

- **Salary is always an estimate.** BFSI JDs almost never publish pay.
- **Tier-B/C coverage is ~10/run, high-priority only.** Full-registry rotation
  (all 101 Tier-B/C companies) isn't attempted every run — only the
  high-priority subset, to keep each hourly run fast.
- **No heartbeat means silence is the normal case.**
- **Nothing is auto-applied.** This pipeline searches, matches, tailors, and
  reports only. Every application is still a manual, deliberate choice.
- **No local LaTeX compiler in the sandbox.** Tailored resumes go out as
  `.tex` attachments, not PDFs, unless a future sandbox image happens to ship
  `pdflatex`. Overleaf (paste-and-compile, no install) is the intended path.

## Maintenance

- If a Tier-A board starts erroring in the run log (`stale[]` in
  `data/jobs.raw.json`), the ATS slug/tenant likely moved — re-verify the
  endpoint and update `data/companies.json`.
- The routine prompt lives in the RemoteTrigger routine config, not in this
  repo — use `/schedule` (or the RemoteTrigger API directly) to view/edit it.
  This doc should be kept in sync whenever that prompt changes materially.
- If hourly proves too noisy or too expensive, drop back to a few times a day
  by editing the routine's `cron_expression` — no repo file needs to change.
