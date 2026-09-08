# NYS Statewide Accessibility Dashboard (Phase 1 / MVP)

A single-screen internal dashboard that presents automated accessibility scan
results across New York State's public-facing sites, rolled up by agency, and
translated into a 🔴🟡🟢 status framework.

Point-in-time **snapshot with manual refresh** — see the [PRD](./accessibility-dashboard-prd.md).

- **Stack:** Vite + TypeScript (no framework), NYSDS web components + design
  tokens via npm, Apache ECharts for charts.
- **Deploy target:** static site on GitHub Pages.
- **Data:** a single, no-secrets `public/dashboard-data.json`, produced at build
  time by `scripts/generate.mjs` from the axe Monitor + SiteImprove APIs and the
  hand-maintained `data/manual-data.json`.

---

## Quick start

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build → dist/
npm run preview    # serve the production build locally
```

The app renders from `public/dashboard-data.json`. A realistic **synthetic**
dataset is committed so the dashboard is fully functional before live data is
wired. Regenerate real data with `npm run generate` (see below).

---

## Data pipeline

```
[axe Monitor API]  [SiteImprove API]           data/manual-data.json
        \               /                       (auditor scores, links, blocked)
         \             /                                  |
      scripts/generate.mjs  ── reads .env keys ───────────┘
         · normalize agency (axe Monitor taxonomy)
         · detect URL conflicts → flag
         · merge manual layer (blocked_note NEVER shipped)
                     |
              public/dashboard-data.json  ──►  committed → GitHub Pages
```

- **Keys never reach the client.** `.env` is read only by `generate.mjs`. Only
  the derived, secret-free JSON is published. `.env` is gitignored.
- **Monthly by automation.** The `Monthly data snapshot` workflow
  (`.github/workflows/monthly-snapshot.yml`) runs on the first of each month,
  pulls both sources, writes that month's snapshot to `data/history/`, and opens
  a pull request. Merging it publishes the refresh. You can also run it by hand
  from the Actions tab, or run `npm run generate` locally with keys in `.env`.

### DCT portfolios

Every agency is served by a Deputy Commissioner for Technology (DCT). The
generator reads the public list at https://its.ny.gov/dcts on each run (cached
to `data/dcts.json`), maps each portfolio's agency tokens to the dashboard's
agency names through `data/dct-aliases.json`, and stamps every site with its
`dct`. Agencies the page doesn't list are filled in from the hand-maintained
`data/dct-portfolio-additions.json`; the page always wins on any overlap. The
rollup chart groups by DCT portfolio by default, labeling each bar with the
portfolio's agencies rather than the DCT's name. Agencies outside every
portfolio show as **No DCT assigned**. Refresh the list alone with
`npm run generate:dcts`.

### Monthly history and the trend chart

Each successful generator run writes `data/history/<YYYY-MM>.json`, the
snapshot of record for that month (every site's automated, auditor, and team
scores). Those committed files are the only input to the **Monthly trend**
chart: the generator compiles them into a `history` block inside
`dashboard-data.json`, so the page never calls an API. Months before the first
snapshot are backfilled from axe Monitor's per-run history (automated scores
only). A dashboard snapshot always wins over a backfilled month, and the
generator refuses to write a snapshot when either source returned nothing, so
an outage can't become a month's record. See `data/DATA.md`.

### Live data (wired)

`scripts/generate.mjs` is wired to the real APIs (verified against live data,
2026-07):

- **axe Monitor** (authoritative for agency + score). Auth `X-API-Key`. Traversal
  `/scans` (→ Scan Groups = agency) → `/scans/{id}/runs` (→ latest completed
  run's `score`) → `/scans/{id}/runs/{run}/pages` (→ `domainUrl`). The `score`
  is a **0–1 ratio** and is scaled ×100.
- **SiteImprove** (second coverage source). HTTP Basic (email : API key).
  `/sites` → per-site `/sites/{id}/dci/overview`, reading the accessibility DCI
  (`a11y.total`, 0–100).

**Environment (`.env`, gitignored):**

| Value | Variable(s) accepted |
|---|---|
| axe Monitor base URL (incl. `/monitor-public-api/v1`) | `AXE_MONITOR_API_BASE` or `AXE_MONITOR_API_URL` |
| axe Monitor API key | `AXE_MONITOR_API_KEY` |
| SiteImprove base URL (defaults to US `api.siteimprove.com/v2`) | `SITEIMPROVE_API_BASE` or `SITEIMPROVE_API_URL` |
| SiteImprove account email | `SITEIMPROVE_API_USER` |
| SiteImprove API key | `SITEIMPROVE_API_KEY` |

Check what's set (booleans only, never values): `npm run generate:check-env`.

**Run it:**

```bash
npm run generate            # pull live data → public/dashboard-data.json + data/history/<month>.json
npm run generate:refresh    # ignore cache, force a fresh pull
npm run generate:offline    # rebuild from cache only, no network (never writes a snapshot)
npm run generate:dcts       # refresh only the DCT list from its.ny.gov
```

If a source's credentials are missing the script warns, skips that source, and
will **not** clobber existing good data with an empty file. The axe Reports /
Axe Developer Hub API is **not** used (it's Git-commit-keyed CI data with no
domain, agency, or score — wrong shape for this dashboard).

### Response cache (avoids hammering the rate-limited APIs)

Every successful GET is cached under `scripts/.cache/` (gitignored), keyed by URL
+ pagination — **never** by auth headers, which are never stored. This makes a
pull **resumable**: axe Monitor rate-limits aggressively (HTTP 429), and the
script retries with backoff, but anything already fetched is served from cache on
the next run so you only re-fetch the gaps. Cache TTL defaults to 24h
(`CACHE_TTL_HOURS` env to change); `--refresh` bypasses reads, `--offline` uses
cache only.

### Known data-quality caveats (from the first live pull)

- **Agency attribution:** axe Monitor Scan Groups mix real agency names (`ITS`)
  with functional tags (`👐 Non-auth Domains`). The script prefers an
  alphanumeric group name over a symbol-prefixed tag, but a **team-confirmed
  group→agency map** will be needed to get attribution fully right (many scans
  are multi-group). Until then, expect a sizable **Unattributed** bucket.
- **SiteImprove scope:** the sites list includes dev/staging domains
  (`*.acquia-sites.com`, `*.acsitefactory.com`). Filtering to production
  public-facing sites is a follow-up.
- **Score scales:** axe `score` is 0–1 (scaled ×100); SiteImprove DCI is already
  0–100. Both confirmed against live payloads.

### `data/manual-data.json`

Hand-edited by the team, keyed by bare domain. Fields per entry:
`team_score`, `override_justification`, `auditor_score`, `auditor_date`,
`auditor_report_url`, `auditor_deck_url`, `blocked`, `blocked_note`.
**`blocked_note` is internal-only and is never surfaced in the UI** (stored for
team rationale, stripped at generation time). `auditor_date` (`YYYY-MM` or a
full date) places the audit on the trend chart in the month it was done.

---

## Scoring & status logic

Single source of truth: [`src/status.ts`](./src/status.ts).

| Status | Automated score |
|--------|-----------------|
| 🔴 Red | 0–40% |
| 🟡 Yellow | 41–79% |
| 🟢 Green | 80–100% |

- **Three signals shown side by side** (axe Monitor, SiteImprove, Axe Auditor) —
  never blended into one number.
- **`blocked = true` forces Red** regardless of score. The original automated
  number still displays, so "scored 85% but blocked" is visible.
- **Conflict badge:** if the same URL appears in both scanning tools, it's
  flagged rather than averaged.

> **Status source:** a site's status color is driven by the **authoritative axe
> Monitor score** when present — including when both tools scanned the site (a
> conflict). SiteImprove is used only when axe Monitor has no score. Applied
> uniformly across the agency chart, statewide summary, and site-table chip. See
> `siteAutomatedScore()` in `src/status.ts` to change the rule.

## The 30% caveat

Automated testing catches ~30% of accessibility issues. This is reinforced in
four places so it can't be screenshotted away: the persistent header banner, the
summary hero card, the chart subtitle, and the table caption + column labels. A
green score means "no automated blockers detected," never "accessible." Full
explanation lives in the in-app **methodology** dialog.

---

## Deployment (GitHub Pages)

`/.github/workflows/deploy.yml` builds and publishes `dist/` on every push to
`main` (and via manual dispatch). Enable Pages → "GitHub Actions" in repo
settings. `vite.config.ts` uses a relative `base` so it works from any
`https://<org>.github.io/<repo>/` path.

Or deploy manually: `npm run deploy` (uses `gh-pages` to push `dist/`).

---

## Fonts licensing

`assets/fonts/` contains the official NYSDS web fonts (Proxima Nova, D Sari),
which are licensed for New York State use. They are served here the same way
every ny.gov site serves them. Don't reuse them outside a New York State
project.

---

## Project structure

```
scripts/generate.mjs          build-time data generator (touches secrets)
data/manual-data.json         hand-maintained manual layer (source)
public/dashboard-data.json    generated, no-secrets dataset the client reads
src/
  types.ts                    canonical data model
  status.ts                   pure status/rollup logic (rubric, blocked, conflict)
  tokens.ts                   status → NYSDS color token mapping (locks ECharts to rubric)
  data.ts / format.ts         data loading + formatting helpers
  methodology.ts              the "how to read this" dialog (30% caveat)
  components/
    header.ts                 title + persistent banner + last-refreshed
    summary.ts                statewide hero + donut
    agencyRollup.ts           sortable horizontal stacked-bar league table
    siteTable.ts              filterable site-level table
  app.css                     token-only styling (no ad-hoc values)
```

## Out of scope (Phase 1)

Page-level drill-down, historical trend, remediation cost estimation, live API
polling, auth, and PDF accessibility data — see PRD §2 and §10 (fast-follow).
