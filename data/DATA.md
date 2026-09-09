# About this data

## manual-data.json

The data structure has been flattened to ease pipeline from
[Excel](https://nysemail.sharepoint.com/:x:/t/its.grp.UX-Design-Team/IQDp35wRYzFSTpm4rXZ-twIlAX6C9VzwI-i4Dcde6B_GnpE?e=6Foucx&nav=MTVfe0U0RDJEQUFELUYyRjQtNEMwNS1BODhCLUU0QTdBRDhENzJBRn0).

**Nota bene**: the `team_score` and `flag_rating` values shown here should override all other sources of information.
Justifications are provided and can be augmented when necessary.

## exclude_list.json

Sites listed here are dropped **entirely** from the dashboard — every count, chart,
and table — before `dashboard-data.json` is written. Use it for dev / QA / demo /
staging hosts (often pulled in from SiteImprove) that skew the statewide numbers.

Each entry is the host to exclude, as a bare string or an object with a `reason`.
Matching is host-based and **includes subdomains**, so a domain also covers
everything under it. A full URL is reduced to its host. A `*.` prefix is optional.

```json
{
  "exclude": [
    "dev.example.ny.gov",
    "*.acquia-sites.com",
    { "url": "https://qa.example.ny.gov", "reason": "QA copy" }
  ]
}
```

Add or remove entries, then re-run `npm run generate` (or `npm run generate:offline`)
to regenerate `public/dashboard-data.json`. The run logs how many sites were removed.

## agency-overrides.json

Hand-maintained agency attribution. axe Monitor's Scan Groups are the only
automated source of agency, and they mix real agencies with functional tags —
so many sites land in **Unattributed** (and a few under the wrong name). This
file corrects that.

Each entry maps a domain to an agency. An explicit entry **wins** over the
automated attribution: it fills an Unattributed site and can correct a
mis-attributed one. A full URL is reduced to its host, matching how sites are
keyed.

```json
{
  "overrides": [
    { "domain": "apps.labor.ny.gov", "agency": "Department of Labor" },
    { "domain": "https://budget.ny.gov/", "agency": "Division of the Budget" }
  ]
}
```

The agency string must match an existing agency name **exactly** (use the
abbreviation axe Monitor already uses, such as `DOL` rather than
`Department of Labor`), or the site forms its own rollup bucket instead of
joining the intended one. The generator
logs any override whose agency name it doesn't recognize, any whose domain
matches no site, and any that replaced an already-named agency — so nothing is
silent. Add or edit entries, then re-run `npm run generate` (or
`npm run generate:offline`).

## dcts.json and dct-aliases.json

`dcts.json` is the cached copy of the public DCT list at
https://its.ny.gov/dcts: each Deputy Commissioner for Technology and the agency
tokens in their portfolio, exactly as the page lists them. The generator
re-scrapes the page on every run and rewrites this file; if the page is
unreachable or its markup changes, the last cached copy is used with a warning.
Refresh it alone with `npm run generate:dcts`. Don't hand-edit it.

`dct-aliases.json` is hand-maintained. It maps a page token to the agency names
this dashboard uses when they differ (`"HCR": ["DHCR"]`, `"NYSP": ["DSP",
"Division of State Police"]`). A token already matches an agency of the same
name, case-insensitively, so an entry only lists the extra names. The generator
logs every token that matches no scanned site so a missing alias is visible.
Sites whose agency sits in no portfolio get `dct: null` and show as
**No DCT assigned**.

## dct-portfolio-additions.json

The public page doesn't list every agency a DCT serves. This hand-maintained
file fills the gaps, keyed by the DCT's name exactly as the page shows it, with
the agency names this dashboard uses:

```json
{
  "additions": {
    "Kathryn Shelton": ["Elections", "OSC", "NYSERDA", "NYSTA"]
  }
}
```

Resolution runs in two passes. The public page assigns first, then the
additions fill in agencies the page left out. **The page always wins:** an
agency the page lists under one DCT stays there even if this file names
another, and the run logs the conflict so the two lists can be reconciled. A
key that matches no DCT on the page is logged and ignored. Names that match no
scanned site are kept and attach when sites appear; the log lists them too.
Chart labels still come from the page's own tokens, so a portfolio filled in
here keeps its short label.

## auditor-runs.json and auditor-case-map.json

Axe Auditor has no API for its test runs, so `auditor-runs.json` is a captured
export of every run in https://nysits-axeauditor.dequecloud.com/test-run: the
run id, its test case and folder, status, the dates it was created and
completed, the accessibility score from the run overview, and the hosts its
test pages point at. Refresh it by hand when new runs complete (the run's
report URL is `https://nysits-axeauditor.dequecloud.com/test-run/<id>`).

Audits usually run against a dev, QA, or staging host, so `auditor-case-map.json`
says which **production** domain each test case stands for, following the
team's convention (an audit of `abledev.dot.ny.gov` is recorded as
`able.dot.ny.gov`). A test case with a `null` domain is kept in the runs file
but does not reach the dashboard until someone fills the domain in; the
generator lists those cases on every run. Most mappings were derived from the
audited host name (`arrsqa.health.ny.gov` → `arrs.health.ny.gov`) after
checking that the production host resolves; each entry's `note` says so, and
the agency should confirm any it hasn't. A production domain that no scanner
covers becomes a manual-only site, so give it an agency in
`agency-overrides.json` or it lands in Unattributed.

A run's `assetType` ("Desktop Web", "Mobile Web") travels through to the
dashboard: a site's auditor score comes from its latest **desktop** run, and
mobile-web runs plot as their own marker on the trend chart rather than as
extra audits of the site.

At generation time every completed, mapped run becomes an entry in the site's
`auditorRuns` (oldest first), and the trend chart plots one manual-audit point
per run. `manual-data.json` stays the team's curated layer: its
`auditor_score`, `auditor_report_url`, and `auditor_date` win when set, and the
latest run fills them when they are empty. A domain that exists only in the
run history still becomes a site so its audits show.

## history/

One file per month, `history/<YYYY-MM>.json`, is the snapshot of record for
that month: every site's automated (axe Monitor, SiteImprove), auditor, and team
scores as captured by a full generator run. These files are the only input to
the trend chart; the generator compiles them into the `history` block of
`public/dashboard-data.json`. Rules:

- A live run writes (or overwrites) the current month's file. An `--offline`
  run never writes one, and neither does a run in which either source returned
  no records, so an outage can't become the month's record. `--no-snapshot`
  pulls live data without writing one (for a mid-month refresh).
- Each site row also records `axeMonitorIssues` (open issues by severity from
  the site's latest axe Monitor run) and `axeMonitorPagesTested`, so the
  portfolio strip can show how the issue load moved month over month. The
  August 2026 file gained these on 2026-09-09 from the same runs it was built
  from; earlier files have none.
- `--snapshot-month=YYYY-MM` records the run as that month's file instead,
  dated noon UTC on the month's last day, with a `note` giving the real capture
  time. Use it when a capture taken early in a month holds the previous
  month's numbers.
- Months with no file are backfilled from axe Monitor's per-run history
  (`"source": "axe-monitor-run-history"`, automated scores only). A backfilled
  file is rewritten on every run and is replaced the first time a real snapshot
  exists for that month.
- Agency and DCT for the trend come from the current data when a site still
  exists, so grouping stays consistent across the series. Excluded sites are
  dropped from history too.
- A site with Axe Auditor run history plots one manual-audit point per
  completed run. Without run history, an auditor score plots in the first
  month a snapshot carried it, or in `auditor_date` from `manual-data.json`
  when the team records one.

The monthly workflow (`.github/workflows/monthly-snapshot.yml`) produces these
files on the first of each month and opens a pull request with the result.

## Page access password (gate)

The published page is behind a shared password (see `src/gate.ts`). It's a light
curtain for the public GitHub Pages URL, **not** strong security — the data JSON
is still fetchable by URL. Change the password by running
`node scripts/gate-hash.mjs 'new password'` and pasting the printed hash into
`DEFAULT_HASH` in `src/gate.ts` (or setting it as the `VITE_GATE_HASH` build env
var / GitHub Actions secret). The current default password is `nys-a11y-2026` —
change it before sharing the link.

Once entered, the unlock is remembered in a cookie for 30 days (across tabs and
browser restarts). The cookie stores the password hash, so rotating the password
automatically re-prompts everyone.
