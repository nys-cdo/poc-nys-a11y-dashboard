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

  // --- Manual layer (from manual-data.json, merged at build time) ---
  /** Axe Auditor comprehensive manual-test score. PRD §4.2. */
  auditorScore: number | null;
  /** Link to the full manual report, if one exists. */
  auditorReportUrl: string | null;
  /** Link to the user-impact / priority-fixes deck, if one exists. */
  auditorDeckUrl: string | null;

  /**
   * Team-set: high automated score but a known blocking issue automation
   * missed. Forces status Red regardless of score. PRD §5.3.
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

/** A single manual-data.json entry (keyed by domain in the file). PRD §4.2. */
export interface ManualEntry {
  auditor_score?: number | null;
  auditor_report_url?: string | null;
  auditor_deck_url?: string | null;
  blocked?: boolean;
  /** Internal rationale — stored but intentionally NOT surfaced in the UI. */
  blocked_note?: string | null;
}

export type ManualData = Record<string, ManualEntry>;
