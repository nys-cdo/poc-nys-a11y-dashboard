/**
 * Canonical data model for the NYS Statewide Accessibility Dashboard.
 *
 * `dashboard-data.json` is produced at build time by `scripts/generate.mjs`
 * (which merges axe Monitor + SiteImprove scans with the hand-maintained
 * `manual-data.json`). The client only ever reads this shape — no secrets,
 * no API access. See the PRD §4 & §9.
 */

/** Traffic-light status. See PRD §5.1. */
export type Status = 'red' | 'yellow' | 'green';

export const UNATTRIBUTED = 'Unattributed';

/** One scored site/domain. Scores are 0–100 composites, or null if absent. */
export interface Site {
  /** Bare domain, e.g. "health.ny.gov". Used as the join key across sources. */
  domain: string;
  /** Full canonical URL for linking out. */
  url: string;
  /**
   * Canonical agency name (axe Monitor taxonomy). Sites with no resolvable
   * agency use the literal `UNATTRIBUTED` bucket. See PRD §4.1.
   */
  agency: string;

  // --- Automated scans (0–100 composite, or null if the tool has no record) ---
  /** axe Monitor (Deque) automated composite score. */
  axeMonitorScore: number | null;
  /** SiteImprove automated composite score. */
  siteImproveScore: number | null;

  // --- Coverage (pages), pulled from the same calls as the scores above ---
  /**
   * axe Monitor: pages actually crawled AND scored in the latest run
   * (`pages.completed`). "Pages tested." Not comparable to SiteImprove's count.
   */
  axeMonitorPagesTested: number | null;
  /**
   * SiteImprove: pages in the site's monitored index (`pages`). "Pages indexed"
   * — the set its DCI is computed across, not a per-run scanned count.
   */
  siteImprovePagesIndexed: number | null;

  // --- Manual layer (from manual-data.json, merged at build time) ---
  /**
   * Team review / override score (0–100). The HIGHEST-priority signal in the
   * official-score chain — a human-set number that wins over every automated
   * source when present. `null` when the team hasn't scored the site.
   */
  teamScore: number | null;
  /**
   * Short human rationale for the team's `teamScore` (why they overrode the
   * automated numbers). Surfaced via a note disclosure in the succinct view.
   * `null` when there is no justification text. Distinct from `blocked_note`,
   * which is internal-only and never reaches the client.
   */
  overrideJustification: string | null;
  /** Axe Auditor comprehensive manual-test score. PRD §4.2. */
  auditorScore: number | null;
  /** Link to the full manual report, if one exists. */
  auditorReportUrl: string | null;
  /** Link to the user-impact / priority-fixes deck, if one exists. */
  auditorDeckUrl: string | null;
  /**
   * Public axe Monitor report link for the site, or `null` when none is
   * available. The axe Monitor Public API exposes no per-site public report
   * URL, so this is currently always null (the UI degrades gracefully).
   */
  monitorReportUrl: string | null;

  /**
   * Team-set: a known blocking issue automation missed. Surfaced as a "blocked"
   * flag badge, but no longer forces status Red — the official score (see
   * status.ts) drives color. A scoreless blocked site reads as "Not scored".
   */
  blocked: boolean;

  /**
   * True when the SAME url appeared in BOTH axe Monitor and SiteImprove.
   * URLs are not supposed to overlap; surfaced as a conflict badge for
   * manual resolution rather than averaged. PRD §4.1.
   */
  conflict: boolean;
}

/** Inclusive rubric ranges (automated score → color). PRD §5.1. */
export interface Rubric {
  /** [min, max] inclusive percent range for red. */
  red: [number, number];
  yellow: [number, number];
  green: [number, number];
}

export interface DashboardMeta {
  /** ISO timestamp the data was generated. Rendered as "last refreshed". */
  generatedAt: string;
  /** Coverage caveat headline number (≈30). PRD §5.4. */
  automatedCoveragePct: number;
  rubric: Rubric;
  /** Human-readable source labels, for the methodology note. */
  sources: string[];
}

export interface DashboardData {
  meta: DashboardMeta;
  sites: Site[];
}

/**
 * A single `manual-data.json` entry (raw file shape). PRD §4.2.
 *
 * The file is a hand-maintained list under a top-level `manual` key; the team
 * keeps editing it, so every field is optional and may be null. `flag_rating`
 * and `blocked_note` are read from the file but intentionally NOT propagated to
 * the client `Site` (they are internal-only).
 */
export interface ManualEntry {
  /** Bare domain — the join key against the automated sources. */
  domain?: string;
  /** Full URL (informational only; the merge keys on `domain`). */
  url?: string;
  /** Legacy human flag ("Red"/"Yellow"/…). Ignored by the pipeline. */
  flag_rating?: string | null;
  /** Team review / override score (0–100). */
  team_score?: number | null;
  /** Short rationale for the team's score/override. */
  override_justification?: string | null;
  auditor_score?: number | null;
  auditor_report_url?: string | null;
  auditor_deck_url?: string | null;
  /** `true` when the team flagged a blocker; `null`/absent otherwise. */
  blocked?: boolean | null;
  /** Internal rationale — stored but intentionally NOT surfaced in the UI. */
  blocked_note?: string | null;
}

/** Raw `manual-data.json` document: a `manual` array of entries. */
export interface ManualData {
  manual: ManualEntry[];
}
