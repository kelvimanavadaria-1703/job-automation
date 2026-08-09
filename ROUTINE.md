# DevOps/SRE/Platform BFSI Job-Hunt Routine — 4x/day

This file is the human-readable record of what the scheduled cloud agent does.
The routine itself is configured via Claude Code's `/schedule` (RemoteTrigger
API), not stored as code here — this doc is for Kelvi to audit and for future
edits to the prompt.

## Schedule

Runs **4 times a day**: 8:00 AM, 1:00 PM, 6:00 PM, 10:00 PM IST
(cron, UTC: `30 2,7,12,16 * * *`).

## What each run does

1. **Scan Tier-A boards** (`node scripts/scan.mjs --maxAgeHours 24`) —
   Greenhouse, Lever, and Workday CXS APIs for the 15 Tier-A companies (Visa,
   Mastercard, Deutsche Bank, PhonePe, slice, CRED, Paytm, Groww, BlackRock,
   Invesco, Vanguard, Franklin Templeton, Point72, S&P Global, LSEG). Free,
   fast, zero model calls — runs in full every single run.
2. **Rotate through Tier-B/C companies** (~12/run via WebSearch/WebFetch) —
   at 4 runs/day that's up to 48/day against ~78 Tier-B/C companies, so full
   coverage now cycles in under 2 days rather than the old 3-4.
3. **Match against `profile.json`** — role keywords, India/remote location,
   experience band read from the JD text (not the title — BFSI titles like
   AVP/VP are not reliable seniority signals), posted within 24h. The 24h
   window is safe at this cadence: the longest gap between runs is 10h
   (10pm→8am), well under 24h, so nothing falls through a scheduling gap.
4. **Dedup against the Google Sheet** — skip anything whose JD link is
   already a row (persists across runs since the cloud sandbox itself is
   wiped between runs; the Sheet is the only durable state).
5. **Tailor the resume** (`resume/master-resume.tex` as the base) per JD —
   reweight/reorder Skills and bullet emphasis to mirror the JD's language.
   Never invents experience, employers, dates, or metrics.
6. **Append a row per new match** to the Google Sheet with the full tailored
   `.tex` source in the last column.
7. **Send an email** via Gmail to kelvimanavadaria@gmail.com **only if this
   run found ≥1 new match.** No heartbeat — at 4 runs/day a per-run "0 new
   matches" email would mean up to 4 emails/day of pure noise. Silence on a
   given run is expected and normal, not a signal something broke.

## Google Sheet — required header row (create once, before first run)

```
Date Found | Company | Role Title | Location | Posted | Source Tier | JD Link | Est. Salary Band | Match Notes | Tailored Resume (LaTeX)
```

Once created, put its URL/ID into `data/config.json` → `googleSheet.id`/`url`.

## Known limitations (by design, not bugs)

- **Salary is always an estimate.** BFSI JDs almost never publish pay. The
  `Est. Salary Band` column is inferred from company reputation/tier notes in
  `data/companies.json`, always labeled "(estimated)". Treat it as a
  prioritization signal, not ground truth — verify before an interview.
- **Tier-B/C coverage is rotated, not exhaustive per-run.** ~12 of ~78
  companies per run keeps each run fast and cheap; full coverage cycles
  within ~2 days rather than same-run.
- **No heartbeat means silence is the normal case.** With 0-match emails
  turned off, most runs will send nothing — that's expected, not a signal
  the routine broke. If you want a periodic "still alive" check, that's a
  deliberate re-add, not a default.
- **Nothing is auto-applied.** This pipeline searches, matches, tailors, and
  reports only. Every application is still a manual, deliberate choice.

## Maintenance

- If a Tier-A board starts erroring in the run log (`stale[]` in
  `data/jobs.raw.json`), the ATS slug/tenant likely moved — re-verify the
  endpoint and update `data/companies.json`.
- Re-run the background research periodically (quarterly is reasonable) to
  refresh comp estimates and catch new BFSI employers worth adding.
- If 4 runs/day proves too noisy or too expensive, drop back to 1-2/day by
  editing the routine's `cron_expression` — no other file needs to change.
