# DevOps/SRE/Platform BFSI Job-Hunt Routine — 3x/day, full daily coverage

This file is the human-readable record of what the scheduled cloud agent does.
The routine itself is configured via Claude Code's `/schedule` (RemoteTrigger
API), not stored as code here — this doc is for Kelvi to audit and for future
edits to the prompt.

**Note:** there's an older, unrelated 4x/day routine kept around, disabled,
as `DevOps-SRE-BFSI-JobHunt` — superseded, no action needed unless you want
it deleted via https://claude.ai/code/routines. The active routine is
`BFSI DevOps/SRE Job Hunt (3x/day, full daily coverage)`.

## Schedule

Runs **3x/day**, on the :30 minute mark, at UTC hours 3/7/13
(`30 3,7,13 * * *`) — 9:00am / 1:00pm / 7:00pm IST.

History: hourly → 4x/day + full-101-company scan (briefly, never actually
fired) → 2x/day + rotating-slice scan (~15/run, full registry every ~3.5
days) → 2x/day + full-101-company coverage split across the day's 2 runs
(all 2026-08-17, same day) → **3x/day + full-101-company coverage split
across the day's 3 runs** (current, 2026-08-28), after Kelvi asked for a
3rd daily run and better-spread times. The 3 times were chosen to stay
within Kelvi's waking/working hours (rather than spread evenly across a
full 24h, which would push a run into the middle of the night) with roughly
even gaps between them (9am→1pm = 4h, 1pm→7pm = 6h). See step 3 below for
exactly how the Tier-B/C split works across 3 runs.

## What each run does

1. **Fetch source files fresh from GitHub** (`kelvimanavadaria-1703/job-automation`,
   public repo) — the cloud sandbox has no persistent checkout, so `profile.json`,
   `data/companies.json`, `scripts/scan.mjs`, the adapters, and (since
   2026-08-30) `resume/variants/manifest.json` are pulled via `curl` at the
   start of every run. (`resume/resume-content.json` and
   `scripts/render_resume_pdf.mjs` are NOT fetched, and `npm install pdfkit`
   is NOT run — those were dropped from the fetch list on 2026-08-18 along
   with resume tailoring/generation itself, see step 5 below. The manifest is
   a different, much smaller thing — see "Suggested resume" below.) Editing
   these files in the repo (and pushing to `main`) is how you change the
   routine's behavior without touching the routine prompt itself.
2. **Scan Tier-A boards** (`node scripts/scan.mjs --maxAgeHours 24 --linkedinMaxAgeHours 24 --verify`) —
   ~40 companies with real ATS APIs (Greenhouse, Lever, Workday, Oracle ORC),
   filtered to postings ≤24h old (a wide safety margin over the ~4-6h gap
   between runs at this cadence — kept at 24h rather than tightened, since
   Drive dedup, not a narrow window, is what prevents re-reporting). Same
   call also runs a login-free LinkedIn guest
   search, with its own 24h lookback — LinkedIn's freshness labels are
   coarse relative buckets ("1 day ago") rather than precise timestamps, so
   its window doesn't need to track the tier-A one. The `--verify` live-fetch
   pass (filters expired/removed postings) skips LinkedIn URLs specifically —
   a generic-UA fetch against linkedin.com is likely to get bot-blocked and
   wrongly mark live postings as stale.

   **Role match (2026-08-28):** `scripts/scan.mjs`'s `ROLE` regex and the
   LinkedIn query keywords now also match "Forward Deployed" titles (Forward
   Deployed Engineer, Forward Deployed SRE), alongside DevOps/SRE/Platform/
   Cloud/Infrastructure. Title matching stays deliberately broad — the actual
   infra/SRE-vs-generic-app-dev judgment for FDE postings happens downstream,
   using `profile.json`'s `forwardDeployedNote`, since "Forward Deployed
   Engineer" spans everything from infra/reliability-heavy roles to pure
   customer-facing app dev with no infra scope at all.
3. **Check ~a third of Tier-B/C companies per run** (~33-34/run via WebFetch)
   — no public ATS, so their careers pages get checked directly. The
   (priority-sorted) B/C registry is interleaved by list-index mod 3: index
   i goes to slot 0 (UTC-03 run), 1 (UTC-07 run), or 2 (UTC-13 run) based on
   `i mod 3`. This keeps a representative mix of high/medium/low priority
   companies across *all three* runs (not all the best ones in one run and
   all the worst in another), and means **the full ~101-company registry is
   covered exactly once every calendar day** — nothing rotates or waits for
   a future day. Splitting across 3 runs (rather than one 101-company run)
   keeps any single run's WebFetch volume, and therefore cost, roughly a
   third of what a single-run full scan would be. Tier-B/C role matching
   also now includes Forward Deployed Engineer/SRE titles, in sync with the
   `scan.mjs` ROLE regex (see the Role match note above).
4. **Merge, then dedup against Google Drive** — searches for
   `job-hunt-seen-urls.json` in Drive (not a Google Sheet — Sheets access
   turned out to be scope-restricted; Drive is the durable state this routine
   actually has) and drops anything already reported. This is what prevents
   LinkedIn's wider 24h window from re-reporting the same posting every hour.
5. **Send an email listing the new matches, each with a suggested resume —
   still no resume generation/attachment.** Full resume tailoring (write a
   `tailor.json` overlay, render via `render_resume_pdf.mjs`, attach a PDF)
   was disabled on 2026-08-18 to cut token usage per run and stays disabled;
   the plan is to re-enable it once cost is under control. Step 0's fetch
   list still doesn't pull `resume/resume-content.json` or
   `scripts/render_resume_pdf.mjs`, and still doesn't run `npm install
   pdfkit`.

   Separately, since 2026-08-30, each match line also names which **existing,
   pre-built** resume variant fits best — a much lighter addition than full
   tailoring, since it only reads the small `resume/variants/manifest.json`
   (fetched in step 0) rather than generating anything. 12 variants live at
   `resume/variants/<id>.tex` (AWS/Azure/GCP × SRE/DevOps, Generic DevOps/SRE,
   Platform/Infrastructure/Cloud Engineer, and Forward Deployed Engineer — see
   `.claude/skills/resume-variant/SKILL.md` at the repo root's parent for how
   to add more). The routine matches each posting's title/JD against the
   manifest's `matching.instructions` and appends a line like `Suggested
   resume: AWS SRE (resume/variants/aws-sre.tex)` — a recommendation only,
   naming a file Kelvi already has locally; the routine does not render,
   tailor, or attach anything.

   Send ONE email via Gmail to kelvimanavadaria@gmail.com **only if this run
   found ≥1 new match** (no heartbeat — a per-run "0 new matches" email would
   be constant noise), plain prose, listing every new match: company, title,
   location, freshness, JD link, one-line fit rationale, suggested resume. No
   attachment.
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
  only checked in whichever of the day's 3 runs its `list-index mod 3`
  lands in — a posting that appears and gets filled within roughly the same
  day could still be missed, though this is a smaller gap than the earlier
  2-run split and a much smaller gap than the original rotating-slice
  design's ~3.5 days. Tier-A (the ~40 companies with real ATS APIs) has no
  such gap, since it's cheap enough to scan in full every run.
- **No heartbeat means silence is the normal case.**
- **Nothing is auto-applied.** This pipeline searches, matches, and reports
  only. Every application is still a manual, deliberate choice.
- **Resume generation/attachment is paused (since 2026-08-18).** Runs list
  new openings by email with a suggested-resume line per match (added
  2026-08-30, see step 5 above) — but no PDF or `.tex` is generated or
  attached; the suggestion only names an existing file. Full tailoring was a
  deliberate token-cost cut, not a bug; re-enable by restoring the
  generate-and-attach steps (see "Why PDF generation moved off LaTeX" above)
  in the routine prompt via `/schedule`.

## Maintenance

- If a Tier-A board starts erroring in the run log (`stale[]` in
  `data/jobs.raw.json`), the ATS slug/tenant likely moved — re-verify the
  endpoint and update `data/companies.json`.
- The routine prompt lives in the RemoteTrigger routine config, not in this
  repo — use `/schedule` (or the RemoteTrigger API directly) to view/edit it.
  This doc should be kept in sync whenever that prompt changes materially.
- The two independent levers are cadence (`cron_expression`, currently
  3x/day) and how the Tier-B/C registry is split per run (currently a
  `list-index mod 3` interleave across exactly 3 daily runs so coverage
  completes every day). If budget pressure returns, splitting into more,
  smaller slots (like the earlier ~15/run rotating design) trades per-run
  cost for a longer full-coverage cycle — either lever can move without
  touching the other, no repo file needs to change for either.
- To add a new resume variant (a new cloud/role combo for the "Suggested
  resume" line in step 5), use the `resume-variant` skill
  (`.claude/skills/resume-variant/SKILL.md` at the JobSearch project root) —
  it covers writing a `resume/tailors/<id>.json` overlay, rendering it with
  `scripts/render_resume_tex.mjs`, and adding the entry to
  `resume/variants/manifest.json`. Pushing the change to `origin/main` is
  what makes it reachable by the routine, since the routine fetches the
  manifest fresh from GitHub every run rather than using a local checkout.
