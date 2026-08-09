# Daily DevOps/SRE/Platform BFSI Job-Hunt Routine

This file is the human-readable record of what the scheduled cloud agent does
every day. The routine itself is configured via Claude Code's `/schedule`
(RemoteTrigger API), not stored as code here — this doc is for Kelvi to audit
and for future edits to the prompt.

## What it does, once per day at 8:00 AM IST

1. **Scan Tier-A boards** (`node scripts/scan.mjs`) — Greenhouse, Lever, and
   Workday CXS APIs for Visa, Mastercard, Deutsche Bank, PhonePe, slice, CRED,
   Paytm, Groww. Free, fast, zero model calls, runs in full every day.
2. **Rotate through Tier-B/C companies** (~12/day via WebSearch/WebFetch) —
   full coverage of the ~47 non-Tier-A companies cycles every 3-4 days.
3. **Match against `profile.json`** — role keywords, India/remote location,
   experience band from the JD text (not the title — BFSI titles like AVP/VP
   are not reliable seniority signals), posted within 48h.
4. **Dedup against the Google Sheet** — skip anything whose JD link is already
   a row (persists across daily runs since the cloud sandbox itself is wiped
   between runs).
5. **Tailor the resume** (`resume/master-resume.tex` as the base) per JD —
   reweight/reorder Skills and bullet emphasis to mirror the JD's language.
   Never invents experience, employers, dates, or metrics.
6. **Append a row per new match** to the Google Sheet with the full tailored
   `.tex` source in the last column.
7. **Send one digest email** via Gmail to kelvimanavadaria@gmail.com — always,
   even with 0 matches (heartbeat, so silence never means "did it break?").

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
- **Tier-B/C coverage is rotated, not exhaustive daily.** ~12 of ~47 companies
  per run keeps the routine fast and cheap; full coverage cycles every 3-4
  days rather than same-day.
- **The 48h freshness window is a floor, not "always <24h".** A strict 24h
  cutoff at a fixed daily run time has gaps (weekends, timezone edges) that
  would silently drop real same-day postings.
- **Nothing is auto-applied.** This pipeline searches, matches, tailors, and
  reports only. Every application is still a manual, deliberate choice.

## Maintenance

- If a Tier-A board starts erroring in the run log (`stale[]` in
  `data/jobs.raw.json`), the ATS slug/tenant likely moved — re-verify the
  endpoint and update `data/companies.json`.
- Re-run the background research periodically (quarterly is reasonable) to
  refresh comp estimates and catch new BFSI employers worth adding.
