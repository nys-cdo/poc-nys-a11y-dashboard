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

The agency string must match an existing agency name **exactly**, or the site
forms its own rollup bucket instead of joining the intended one. The generator
logs any override whose agency name it doesn't recognize, any whose domain
matches no site, and any that replaced an already-named agency — so nothing is
silent. Add or edit entries, then re-run `npm run generate` (or
`npm run generate:offline`).

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
