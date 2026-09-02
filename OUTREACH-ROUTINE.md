# Outreach-Contact Harvest Routine — daily, email addresses to cold-mail

This is the human-readable record of the **second** scheduled cloud agent in the
job hunt. Where the main routine (`ROUTINE.md`) finds *job postings*, this one
finds *people to email* — recruiter/staffing-firm contacts, company HR / Talent
Acquisition addresses, "mail your CV to X" addresses posted on LinkedIn, and
contacts at any firm/company that just put up a new opening.

The routine itself is configured via Claude Code's `/schedule` (RemoteTrigger
API), not stored as code — this doc is for Kelvi to audit and for future prompt
edits. Routine name: **`Outreach contacts — recruiters / HR / LinkedIn mail-to (daily)`**.
Trigger id: `trig_015PeNTjDuDSDiyhKQTNCBvP`
(https://claude.ai/code/routines/trig_015PeNTjDuDSDiyhKQTNCBvP). Created
2026-09-03; first run 2026-09-03 10:00 IST.

## What it is / isn't

- **Is:** a discovery + collation tool. Every run it emails Kelvi a de-duplicated
  list of real, published email addresses he *could* choose to write to, grouped
  by channel, each with the source URL it was found on.
- **Isn't:** an outreach tool. It **sends nothing to any recruiter, firm or
  company** — the only email it sends is the digest to Kelvi. Writing to any of
  these contacts stays a manual, deliberate action (use the `recruiter-outreach`
  skill to draft those). No applications, no connection requests, no mass mail.

## Hard rules (baked into the prompt — do not relax)

1. **Never fabricate, guess or pattern-construct an address.** Only an address
   that literally appears on a page the run fetched, in a LinkedIn post body, or
   in a job description — or one already present (and marked verified) in
   `data/recruiters.json` — may be reported. No `careers@<domain>`,
   `firstname.lastname@<domain>`, or "typical format" guesses. If it can't be
   seen on a real source, it doesn't go in the email.
2. **Kelvi-only recipient.** The digest goes to `kelvimanavadaria@gmail.com` and
   nowhere else.
3. **No login-gated scraping.** LinkedIn is reached via public/guest fetch and
   web search only, same as the main routine's LinkedIn guest step.
4. **Light touch.** A few fetches per entity, no crawling, a hard per-run cap on
   web calls (see below). Respect robots/ToS.
5. Any statement about Kelvi that ever appears in output must match
   `profile.json` — but this routine mostly just collects addresses, it does not
   draft messages.

## Schedule

Runs **once a day** at **10:00 IST** (`30 4 * * *` UTC). Chosen to fall *after*
the main routine's 09:00 IST run so the same morning's newly-found postings are
already in the Drive state this routine reads for its "new openings" channel, and
so the two cloud sessions don't hit Gmail/Drive at the same minute. Move to
`30 3 * * *` if you want it at exactly 09:00 IST.

## Source files (fetched fresh each run)

Same public repo as the main routine
(`github.com/kelvimanavadaria-1703/job-automation`), pulled with `curl` at run
start — the cloud sandbox has no checkout:

- `profile.json` — target roles / locations / sector, so "relevant opening" and
  "relevant recruiter" mean the same thing here as everywhere else.
- `data/recruiters.json` — the ~113-firm third-party registry. Fields used:
  `name`, `website`, `registerUrl`, `contactEmail` (only 18 are non-null today —
  those are the verified seed addresses), `priority` (P1/P2/P3), `status`.
- `data/companies.json` — the ~177-company registry. Fields used: `name`,
  `tier`, `priority`, `locations`, plus any careers URL derivable from the ATS
  fields.

## Durable state (Google Drive)

One file, `job-hunt-outreach-contacts.json`, created on first run:

```jsonc
{
  "generated": "ISO date",
  "contacts": [
    {
      "email": "lowercased@domain",      // dedup key
      "name": "person name or null",
      "title": "role/title or null",
      "entity": "firm or company name",
      "entityType": "recruiter | company | linkedin-post | other",
      "channel": "recruiter-firm | company-hr-ta | linkedin-mailto | new-opening",
      "priority": "P1/P2/P3 or high/medium/low or null",
      "source": "URL the address was found on",
      "context": "short quote / where on the page it appeared",
      "firstSeen": "ISO date"
    }
  ],
  "noContactFound": [ { "entity": "...", "lastChecked": "ISO date" } ],
  "processedJobUrls": [ "..." ],   // job-hunt-seen-urls.json entries already mined
  "cursorNote": "slice = dayOfYear % 10"
}
```

It also **reads** (never writes) the main routine's `job-hunt-seen-urls.json` to
work out which entities have new openings.

## What each run does

0. **Fetch** `profile.json`, `data/recruiters.json`, `data/companies.json` from
   GitHub. Sanity-check sizes.
1. **Load Drive state** — `job-hunt-outreach-contacts.json` (init if absent) and
   read-only `job-hunt-seen-urls.json`.
2. **New-opening entities (every run).** `newJobUrls = job-hunt-seen-urls.urls −
   processedJobUrls`. Derive the hiring entity for each (ATS slug / host / the
   employer named in the JD). De-dup to an entity list; cap at the 40 newest to
   bound cost. These are the highest-intent targets — someone is hiring *right
   now*.
3. **Rotating registry slice (every run).** `slice = dayOfYear % 10`. Take
   `recruiters[i]` and `companies[i]` where `i % 10 == slice` (~30 entities/run),
   so the whole registry is swept once every 10 days. P1 / high-priority entities
   within the slice are always processed first; if the per-run web-call cap is
   hit, the rest of the slice is deferred and named in the digest footer.
4. **LinkedIn "mail-to" scan (every run).** 6–10 web searches for *recent* public
   LinkedIn posts / job posts in the DevOps / SRE / Platform / Cloud + India
   niche that carry an apply-by-email instruction — "share your CV at", "send
   resume to", "interested candidates can mail", an inline address, etc. Pull the
   address, the poster's name, their firm, and the post URL. Guest/public only.
5. **Contact discovery** for the entities from (2) + (3), under a hard cap of
   **~60 web calls total for the run**:
   - **Recruiter firm:** if `contactEmail` is set in `recruiters.json`, take it.
     Otherwise ≤1 fetch of `website` / `registerUrl` and ≤1 search for a
     *published* recruiter / talent-acquisition address. Real addresses only.
   - **Company:** ≤2 search/fetch for a *published* recruiting / HR / TA address
     or a named recruiter's contact (careers page, press page, JD body). Most
     yield nothing — that's expected; record the entity in `noContactFound` with
     the date so later slices don't re-chase it every cycle.
   - **New-opening entity:** as above, plus check the specific posting body for an
     "apply by email" address or named recruiter.
6. **Merge & dedup** into `contacts[]` by lowercased email. A contact is *new*
   only if its address isn't already there. Stamp `firstSeen`.
7. **Email Kelvi** (only if ≥1 genuinely new contact this run — otherwise
   silence, same no-heartbeat rule as the main routine). One HTML email,
   `kelvimanavadaria@gmail.com`, four colour-headed sections **in this order**,
   every header always rendered (`— none this run` under an empty one):
   1. **Recruiting / staffing firm contacts** — blue `#1a73e8`
   2. **Company HR / Talent Acquisition contacts** — green `#188038`
   3. **LinkedIn "mail-to" posts** — amber `#b06000`
   4. **Contacts at firms/companies with a NEW opening** — purple `#8430ce`
   Sections are mutually exclusive by entity: if an entity is both in today's
   slice and has a new opening, it goes in section 4 only. Per row: the address
   as a `mailto:` link, name/title if known, entity + its priority, the source
   link, a one-line context note, `firstSeen`. Subject e.g.
   `6 new outreach contacts (2 firm · 3 HR/TA · 1 linkedin · 0 new-opening) — <date>`.
   Footer: one coverage line — `slice X/10 · checked N recruiters + M companies ·
   K yielded an address · P new-opening entities mined · Q slice entities deferred`.
   Plain-text fallback: same four sections under `======` divider lines.
8. **Write back** `job-hunt-outreach-contacts.json` — append new contacts,
   `noContactFound` markers, and the job URLs processed this run; trim
   `contacts` / `processedJobUrls` if they exceed ~3000 / ~3000 entries (oldest
   first).

## Known limitations (by design)

- **Most companies have no publicly published recruiter address** — BFSI in
  particular routes everything through the ATS. Empty runs for the company
  section are normal; the value concentrates in the recruiter-firm and
  LinkedIn-mail-to sections.
- **Full registry coverage is once per 10 days**, not per run (rotating slice).
  New-opening entities are the exception — they're chased the same day.
- **LinkedIn "mail-to" recall is partial.** Guest search sees a fraction of
  posts and freshness is coarse. It catches the loud, public "DM/mail me your
  CV" posts, not everything.
- **No verification that an address still works** — it's reported as *seen on
  this URL on this date*, nothing more. Bounce risk is Kelvi's to absorb when he
  writes.
- **No outreach.** Same rule as the main routine: this pipeline discovers and
  reports; every message sent is a manual choice.

## Tuning levers

- **Cadence** — `cron_expression` (currently daily). Independent of everything
  else.
- **Sweep speed** — the `% 10` modulus in step 3. Larger = cheaper per run,
  longer full-sweep cycle; smaller = the reverse. Nothing else needs to change.
- **Per-run cost ceiling** — the "~60 web calls" cap in step 5 and the "40
  newest" cap in step 2.
- All three move without touching the repo — they live in the routine prompt,
  edited via `/schedule`.

## Relationship to the other pieces

| Thing | Role |
|---|---|
| `ROUTINE.md` / main routine | Finds job *postings*, 3×/day. Writes `job-hunt-seen-urls.json`. |
| **This routine / `OUTREACH-ROUTINE.md`** | Finds *people to email*, 1×/day. Reads that file; writes `job-hunt-outreach-contacts.json`. |
| `recruiter-outreach` skill | Manual/assisted drafting + sending of the actual outreach, using the addresses this routine collects. |
| `data/recruiters.json` | Shared registry. This routine reads it and treats its 18 non-null `contactEmail`s as seed contacts; it does not write back to it. |

## Maintenance

- The prompt lives in the RemoteTrigger routine config, not this repo — view/edit
  with `/schedule`. Keep this doc in sync on any material change.
- If a run's digest starts showing obviously-guessed addresses, the "never
  fabricate" rule in the prompt has slipped — re-tighten it and re-check the run
  log via `/schedule` → `get_run_log`.
- New verified recruiter addresses should be promoted into
  `data/recruiters.json` (`contactEmail`, `status: "Verified"`) via the
  `recruiter-outreach` skill so they seed instantly instead of being re-found.
