# PRD: NYS Statewide Accessibility Dashboard (Phase 1)

**Owner:** Jesse Gardner, Director of Accessibility & Design Systems
**Primary stakeholder:** Dru (Head of ITS)
**Deadline:** End of July 2026 (leadership report)
**Status:** Phase 1 / MVP

---

## 1. Purpose

A single-screen internal dashboard that presents automated accessibility scan results across New York State's public-facing sites and applications, rolled up by agency, and translated into a 🔴🟡🟢 status framework.

The immediate goal is a credible statewide snapshot Dru can use as a working tool and pull into a deck for the August DCT Council. The dashboard is deliberately scoped as a **point-in-time snapshot with manual refresh** for this phase.

**Strategic note (not phase 1 scope):** This is the seed of a recurring monitoring product. Architecture decisions below favor a later monthly cadence and historical trend without building either now.

---

## 2. Non-goals (Phase 1)

- No page-level drill-down. Site/domain-level composite only.
- No historical trend view. Current snapshot only.
- No remediation cost/effort estimation. (Fast-follow — see §10.)
- No live API polling. Manual data regeneration only.
- No per-agency access control or authentication. Internal, single view.
- No PDF accessibility data. Explicitly out of scope.
- No in-dashboard editing of manual data.

---

## 3. Audience & deployment

- **Audience:** ITS leadership (Dru), internal accessibility team. Single shared view — everyone sees the same thing.
- **Deployment:** Static site on GitHub Pages.
- **Access:** Internal only.
- **Framing:** Working tool first; snapshot-to-deck second.

---

## 4. Data sources

### 4.1 Automated scan data (via API → static JSON)

Two sources, pulled via their respective APIs and baked into a static JSON dataset committed to the repo (GH Pages has no backend). API keys stored in `.env`, used only at data-generation time, **never shipped to the client bundle.**

| Source | Role |
|---|---|
| **axe Monitor** (Deque) | Automated scan scores. **Authoritative for agency grouping/normalization.** |
| **SiteImprove** | Automated scan scores. Second source of coverage. |

**Score model:** Site/domain-level composite percentage (0–100) from each tool.

**Source conflict rule:** URLs should not overlap between the two tools. **If the same URL appears in both, flag the conflict** visibly in the dashboard (a conflict badge on that row) rather than averaging or silently preferring one. Team resolves manually.

**Agency normalization:** Use **axe Monitor's agency grouping** as the canonical agency taxonomy. Map SiteImprove records to it. URLs with no resolvable agency go to an **"Unattributed"** bucket (to be reduced later via AI-assisted attribution — not phase 1).

### 4.2 Manual data layer (team-maintained JSON)

A separate JSON file the team edits by hand, keyed by URL/domain, merged at generation time. Fields per entry:

| Field | Type | Purpose |
|---|---|---|
| `auditor_score` | number \| null | Score from a comprehensive manual test (Axe Auditor). |
| `auditor_report_url` | string \| null | Link to full manual report. |
| `auditor_deck_url` | string \| null | Link to slide deck on user impact + priority fixes. |
| `blocked` | boolean | Team-set: high automated score but a known blocking issue automation missed. |
| `blocked_note` | string \| null | Internal rationale. **Stored but NOT surfaced in the UI.** |

---

## 5. Scoring & status logic

### 5.1 Base rubric (automated score → color)

| Status | Range |
|---|---|
| 🔴 Red | 0–40% |
| 🟡 Yellow | 41–79% |
| 🟢 Green | 80–100% |

### 5.2 Signal hierarchy (per site)

Three possible signals sit **side by side** in the UI: axe Monitor score, SiteImprove score, Axe Auditor (manual) score. Phase 1 does **not** compute a blended number — the reviewer sees all present signals.

Expected real-world pattern: Monitor/SiteImprove skew higher, Auditor skews lower. That gap is informative, not an error.

### 5.3 Blocked flag overrides everything

If `blocked = true`, the site's status renders **🔴 Red regardless of any numeric score.** The original automated score number still displays (so the gap between "scored 85%" and "flagged blocked" is visible), but the status color is Red. This is the whole point of the flag — it must be impossible to miss on an otherwise-green site.

### 5.4 The 30% caveat (mandatory, unmissable)

Automated testing catches roughly 30% of accessibility issues; the rest require manual review. This must be **impossible to miss.** Implementation:

- **Persistent header banner** on the dashboard stating scores reflect automated testing only.
- **Reinforced at the point of the number** — a small persistent label/tooltip on score displays, so nobody screenshots a green tile without the caveat traveling with it.
- **Methodology note** accessible from the header for the full explanation.

This is a psychological-placement requirement, not decoration. A green automated score is "no automated blockers detected," never "accessible."

---

## 6. Views & layout

Single screen, top-down.

1. **Header** — title, persistent 30%-automated-only banner, manual "last refreshed" date, link to methodology.
2. **Statewide summary** — total sites, count/% by 🔴🟡🟢, count blocked, count unattributed. This is the hero for leadership.
3. **Agency rollup** — one row/card per agency: site count, status distribution (stacked bar), average or worst-case indicator. Sortable. This is the peer-comparison surface that does the accountability work at DCT Council.
4. **Site-level table** — every site: domain, agency, axe Monitor score, SiteImprove score, Auditor score (if present), status chip, blocked badge, conflict badge, links to report/deck when present. Filterable by agency and status.

---

## 7. Visualization

- **Apache ECharts** for all charts.
- Statewide status breakdown: donut or stacked bar.
- Agency rollup: horizontal stacked bars (🔴🟡🟢 segments) — reads as an instant league table.
- Keep chart color semantics locked to the rubric colors via design tokens (see §8).

---

## 8. Design system & styling

- Use **NYS Design System (NYSDS) components** wherever a suitable component exists (tables, chips/badges, banners, layout).
- Where a needed component doesn't exist, build it styled with **NYSDS design tokens** (color, spacing, typography) — no ad-hoc values.
- Map 🔴🟡🟢 to NYSDS semantic status tokens rather than raw hex, so ECharts and NYSDS components stay visually consistent.
- Reference the live component/token data via the `@nysds/mcp-server`.

---

## 9. Data architecture (build-time)

```
[axe Monitor API]  [SiteImprove API]
        \               /
      (generation script, reads .env keys)
        \               /
     normalize agency (axe Monitor taxonomy)
     detect URL conflicts → flag
        \
     merge manual-data.json (auditor scores, links, blocked)
        \
     write dashboard-data.json  ──►  committed to repo
                                          │
                                   [GitHub Pages static dashboard]
```

- **Keys never reach the client.** `.env` is used only by the generation script; only the derived `dashboard-data.json` (no secrets) is published.
- Manual regeneration for phase 1; the script is the seed of the future scheduled monthly pull.

---

## 10. Fast-follow (post–Phase 1, flagged now)

- **Remediation effort/cost model** feeding the DOB budget ask. Needs a defensible per-issue or per-site estimation method. High priority, separate spec.
- AI-assisted agency attribution to shrink the Unattributed bucket.
- Historical trend (SiteImprove has years of history; leverage it).
- Scheduled monthly refresh + productization as a paid monitoring offering.

---

## 11. Open questions / assumptions

- **Assumption:** Both APIs expose a site/domain-level composite score directly. If only page-level is available, the generation script computes the composite (axe Monitor formula) at build time — still no page detail in the UI.
- **Assumption:** Agency metadata is retrievable per URL from axe Monitor. Where absent → Unattributed.
- **Assumption:** Manual-data JSON is small enough to hand-edit for MVP; revisit if it grows.
