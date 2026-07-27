# Why axe Monitor and SiteImprove disagree

**Reconciling the two automated accessibility scores across the NYS site portfolio.**

Prepared for: ITS leadership / DCT Council · Topic: Statewide Accessibility Dashboard · Snapshot: 2026‑07‑15

This note explains why the same website earns a much higher accessibility score in
SiteImprove than in axe Monitor — across the sites we scan with both tools, about **37 points
higher on average** — and how the dashboard handles that gap when it reports and compares sites.

---

## Bottom line

The two tools are **not two readings of the same measurement.** They use different formulas
that count different things:

- **axe Monitor** scores **whole pages** by their single worst problem, then averages.
- **SiteImprove** scores **individual checks** — what share of everything it tested passed.

A large, repeatable gap between them is **expected**, not a sign that either tool is broken.

**Do not "add 37 points" to convert one score into the other.** The gap is not a fixed
constant. In our own data it ranges from roughly **−3 to +84 points**, and it *widens on our
worst sites and shrinks on our cleanest* — the opposite of what a fixed offset assumes. A "+37"
crosswalk would quietly forgive exactly the sites with the most serious blockers.

For the compliance question this dashboard exists to answer — *"what share of our pages are free
of serious blockers?"* — **axe Monitor is the defensible lens**, and it is what drives the status
color. SiteImprove is reported alongside it, not blended into it.

---

## 1. They don't measure the same thing

It is tempting to treat these as two thermometers that disagree, as if one is running hot. That
framing is the mistake. They are two different instruments measuring two different quantities.

- axe Monitor asks a strict, page‑by‑page question: **"What share of our pages are free of
  high‑severity problems?"**
- SiteImprove asks a volume question: **"Of all the individual checks we ran, what share
  passed?"**

Both are reasonable. They answer to different bosses, so their numbers will not line up — and the
one most people already have access to (SiteImprove) is the optimistic one.

## 2. How each tool actually scores

### axe Monitor — "worst problem wins"

axe Monitor finds the single most severe issue on each page and sorts the whole page into one
bucket based on that one issue, then averages across pages:

| Page's worst issue | Page counts as |
| --- | --- |
| Minor only, or none (**Good**) | 100% |
| Moderate (**Fair**) | 80% |
| Serious | 40% |
| **Any Critical issue** | **0%** — a hard zero, no partial credit |

Two consequences matter enormously:

1. **The number of problems on a page barely moves the score.** A page with one serious issue and
   a page with four hundred serious issues both score 40%.
2. **A single critical issue erases the page entirely.**

For our templated state sites this is decisive. The shared header, footer, and navigation appear
on every page. If any one shared component carries a serious issue — a low‑contrast link, an
unlabeled menu button — then **every page inherits it and caps at 40%.** That is why our axe
scores cluster in a low, narrow band: **40% of the sites we scan with both tools score between 40
and 55.** The formula is punishing by design.

### SiteImprove — "credit for everything that passes"

SiteImprove works at the level of individual checks. A single page runs through thousands of
automated checks, and the overwhelming majority pass. Three features push the number high:

- **The base is enormous.** Every element that passes is counted, so a handful of failures is
  diluted across thousands of passes.
- **No page‑level collapse.** One bad element costs one check; the rest of the page keeps its
  credit.
- **Unconfirmed items wait offstage.** Findings that need human confirmation are held as "potential
  issues" and don't drag the automated score down until reviewed.

### Side by side

| | axe Monitor | SiteImprove |
| --- | --- | --- |
| What it counts | Whole pages | Individual checks (occurrences) |
| How a page is judged | By its single worst issue | Every passing check earns credit |
| Effect of one serious issue | Caps the whole page at 40% | Loses credit for that one check |
| Effect of a critical issue | Forces the page to 0% | One more failed check among thousands |
| Denominator | Number of pages (small) | Number of checks run (very large) |
| Typical result | Clusters low | Runs high |

## 3. What our data shows (snapshot 2026‑07‑15)

Of **292 sites**, **94** are scanned by both tools. On those 94:

| | axe Monitor | SiteImprove (Accessibility) |
| --- | --- | --- |
| Average score | **53.7** | **90.3** |
| Higher score | 1 of 94 sites | **93 of 94 sites** |

- **Average gap: +36.6 points** in SiteImprove's favor.
- SiteImprove places **89 of the 94** shared sites in the green band (80–100) where axe Monitor
  does **not** — and **15 of those are axe‑red** (0–40).

Representative sites:

| Site | axe Monitor | SiteImprove |
| --- | --- | --- |
| agriculture.ny.gov | 53 | 90 |
| arts.ny.gov | 39 | 88 |
| apa.ny.gov | 43 | 73 |

## 4. Why the gap is steady — and why "+37" is a trap

A gap that hovers near 37 points across many sites is the fingerprint of a **structural formula
difference**, not random noise. Most of our sites share the same header and footer, so they land
in the same axe Monitor bucket (Serious) across the board — pinning those scores in a tight low
band while SiteImprove's share‑of‑checks floats high.

The temptation is to "normalize" by adding a fixed number to the axe scores. **Do not.** A site
with a genuine critical blocker craters in axe Monitor (a hard zero for that page) while barely
moving in SiteImprove (one more failed check among thousands). So the gap **widens precisely on
our worst sites and narrows on our cleanest** — and our data bears this out:

| | Average gap (SiteImprove − axe) |
| --- | --- |
| Our 10 **worst** axe sites | **+65.1 points** |
| Our 10 **best** axe sites | **+13.2 points** |

A "+37" crosswalk would apply the smallest correction where it is needed most, quietly forgiving
the sites with the most serious blockers.

## 5. Before comparing the two columns

Two checks keep this an apples‑to‑apples comparison. **The dashboard already handles both:**

- **Compare the right SiteImprove number.** SiteImprove's headline DCI blends three
  equally‑weighted modules — Accessibility, Quality Assurance, and SEO — and QA/SEO run high.
  Comparing that headline against axe Monitor's accessibility percentage would inflate the gap
  further. The pipeline reads SiteImprove's **Accessibility sub‑score** (`a11y.total`)
  specifically, never the blended DCI headline — so the gap above is a like‑for‑like,
  accessibility‑only comparison.
- **Confirm the crawl scope.** Because axe Monitor scores *pages*, its number swings with which
  pages and how many were scanned; a shallow crawl versus a deep one can manufacture a gap on its
  own. The dashboard now surfaces both tools' page counts side by side — **"Pages tested"** (axe
  Monitor) and **"Pages indexed"** (SiteImprove) — so a scope mismatch is visible per site rather
  than hidden. Notably, axe's lower score is **not** an artifact of a thin sample: on many sites it
  crawls *more* pages than SiteImprove indexes (e.g. apa.ny.gov — 953 tested vs. 153 indexed) and
  still scores lower.

## 6. What this means for the dashboard

- **We report both numbers, labeled.** SiteImprove answers *"how many defects do we have, and are
  we reducing them?"* — the better day‑to‑day remediation metric. axe Monitor answers *"what share
  of pages are free of serious blockers?"* — the stricter compliance lens. Used together they are
  complementary; collapsed into one number they mislead.
- **Status color follows axe Monitor.** Because the dashboard's job is a compliance early‑warning,
  the single status chip uses the authoritative axe Monitor score when present (SiteImprove only
  where axe has none). A `blocked` flag forces Red regardless of score.
- **Automated ≠ compliant.** Automated tools catch roughly **30%** of accessibility barriers. Even
  the stricter axe Monitor number is a *floor* — the real compliance picture is at best what axe
  shows and likely worse. Manual auditing remains essential; that is what the Auditor column is for.
- **Known coverage gap.** **27 sites** are currently scored by SiteImprove only. Their status rests
  on the softer number until they are added to axe Monitor scanning (tracked as a separate
  operational follow‑up).

## 7. DCT Council talking points

- **Two tools, two formulas — not two readings of one thing.** SiteImprove counts individual checks
  (a huge denominator, so scores run high); axe Monitor scores whole pages by their single worst
  issue (one serious problem in a shared header caps the page at 40%).
- **The rosy number is the one most people see.** Across our 94 dual‑scanned sites SiteImprove
  averages ~37 points higher and rates 89 of 94 "green" where axe Monitor does not.
- **You cannot adjust the gap away.** It is ~65 points on our worst sites and ~13 on our cleanest;
  a fixed offset would hide the worst offenders.
- **For the compliance question, axe Monitor is the defensible metric** — and it drives the
  dashboard's status.
- **Even axe is a floor.** Automation catches ~30% of barriers; the true picture requires manual
  review.

---

## Appendix: the formulas

*Included for the record. Not required to follow the argument above.*

### axe Monitor

Each page is bucketed by its single worst issue, then:

```
Score = (0.4·p₂ + 0.8·p₁ + 1.0·p₀) / TP
```

where `p₂` = number of Serious pages, `p₁` = number of Fair pages (worst issue Moderate),
`p₀` = number of Good pages (Minor only / none), and `TP` = total pages. Any page containing a
Critical issue contributes 0 to the numerator. The overall score is the average of the per‑page
scores. Verified against Deque's documentation (see Sources).

The severity tiers (Critical / Serious / Moderate / Minor) come from axe‑core and reflect Deque's
assessment of user impact. They are **not** defined by WCAG; WCAG does not rank its success
criteria by severity.

### SiteImprove

The Site Target Score — the cleanest documented form of the ratio — is:

```
Score = 1 − (failed occurrences / total occurrences detected)
```

evaluated over the success criteria in the chosen WCAG target. The **DCI Accessibility sub‑score**
that the dashboard reads (`a11y.total`) is a weighted algorithm over how many WCAG success criteria
the site satisfies across A / AA / AAA plus WAI‑ARIA and best practices, yielding a 1–100 value; it
lands lower than the raw Site Target Score, typically in the 75–95 range. The blended DCI headline
(which the dashboard does **not** use) is:

```
DCI = (Accessibility + Quality Assurance + SEO) / 3
```

### How to refresh the numbers in this note

The snapshot figures (Sections 3–4) are point‑in‑time, computed from
`public/dashboard-data.json`. Regenerate that file with `npm run generate` (or
`npm run generate:offline` from cache), then recompute the overlap statistics against the `sites`
array. Update the snapshot date at the top when you do.

### Sources

- axe Monitor — Scan Overview (score formula): <https://docs.deque.com/monitor/8.3/en/scan-overview/>
- axe‑core — Issue Impact definitions: <https://github.com/dequelabs/axe-core/blob/develop/doc/issue_impact.md>
- SiteImprove — Digital Certainty Index (DCI): <https://help.siteimprove.com/support/solutions/articles/80000448555>
- SiteImprove — Accessibility Site Target Score: <https://help.siteimprove.com/support/solutions/articles/80001152008>
