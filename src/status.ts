/**
 * Pure status-derivation logic. No DOM, no data loading — trivially testable
 * and the single source of truth for how a score becomes a color.
 *
 * THE OFFICIAL SCORE (the canonical number for the whole dashboard):
 * a single value resolved from a priority chain, first non-null wins:
 *   1. teamScore       (manual team review / override) — highest authority
 *   2. auditorScore    (Axe Auditor manual score)
 *   3. axeMonitorScore (axe Monitor automated)
 *   4. siteImproveScore (SiteImprove automated)
 *   5. else null       → "Not scored / unscanned"
 *
 * The rubric (`meta.rubric`) maps that official value to red/yellow/green.
 * `blocked` no longer forces red — a scoreless site (blocked or not) is simply
 * "Not scored". The official score drives the summary pie, the agency rollups,
 * and every site-table status chip, so they ALL agree.
 */

import type { DashboardData, Rubric, Site, Status } from './types';
import { UNATTRIBUTED } from './types';

/** Which source in the priority chain supplied the official score. */
export type ScoreSource = 'team' | 'auditor' | 'monitor' | 'siteimprove' | null;

/** The resolved official score plus which source it came from. */
export interface OfficialScore {
  value: number | null;
  source: ScoreSource;
}

/** Map a 0–100 score to a status via inclusive rubric ranges. */
export function scoreToStatus(score: number, rubric: Rubric): Status {
  if (score <= rubric.red[1]) return 'red';
  if (score <= rubric.yellow[1]) return 'yellow';
  return 'green';
}

/**
 * Resolve a site's OFFICIAL score via the priority chain (first non-null wins):
 * teamScore → auditorScore → axeMonitorScore → siteImproveScore → null.
 * Returns both the value and the source that supplied it (so the UI can pick
 * the right annotation: team note vs. auditor report vs. monitor link).
 */
export function officialScore(site: Site): OfficialScore {
  if (site.teamScore !== null) return { value: site.teamScore, source: 'team' };
  if (site.auditorScore !== null) return { value: site.auditorScore, source: 'auditor' };
  if (site.axeMonitorScore !== null) return { value: site.axeMonitorScore, source: 'monitor' };
  if (site.siteImproveScore !== null) return { value: site.siteImproveScore, source: 'siteimprove' };
  return { value: null, source: null };
}

/**
 * Resolve a site's displayed status from its official score.
 *  - map the official score through the rubric
 *  - no official score → 'unknown' (rendered as a neutral "Not scored" chip)
 * `blocked` no longer affects color.
 */
export function officialStatus(site: Site, rubric: Rubric): Status | 'unknown' {
  const { value } = officialScore(site);
  if (value === null) return 'unknown';
  return scoreToStatus(value, rubric);
}

/**
 * Resolve a site's displayed status. Delegates to {@link officialStatus} so the
 * summary, agency rollups, and site table all agree on the official score.
 */
export function siteStatus(site: Site, rubric: Rubric): Status | 'unknown' {
  return officialStatus(site, rubric);
}

export interface StatusCounts {
  red: number;
  yellow: number;
  green: number;
  unknown: number;
}

export interface StatewideSummary {
  total: number;
  counts: StatusCounts;
  /** Percentage (0–100, rounded) of total for each status. */
  percentages: StatusCounts;
  blocked: number;
  unattributed: number;
  conflicts: number;
}

function emptyCounts(): StatusCounts {
  return { red: 0, yellow: 0, green: 0, unknown: 0 };
}

function tally(sites: Site[], rubric: Rubric): StatusCounts {
  const counts = emptyCounts();
  for (const site of sites) counts[siteStatus(site, rubric)] += 1;
  return counts;
}

function toPercentages(counts: StatusCounts, total: number): StatusCounts {
  if (total === 0) return emptyCounts();
  return {
    red: Math.round((counts.red / total) * 100),
    yellow: Math.round((counts.yellow / total) * 100),
    green: Math.round((counts.green / total) * 100),
    unknown: Math.round((counts.unknown / total) * 100),
  };
}

export function statewideSummary(data: DashboardData): StatewideSummary {
  const { sites, meta } = data;
  const counts = tally(sites, meta.rubric);
  return {
    total: sites.length,
    counts,
    percentages: toPercentages(counts, sites.length),
    blocked: sites.filter((s) => s.blocked).length,
    unattributed: sites.filter((s) => s.agency === UNATTRIBUTED).length,
    conflicts: sites.filter((s) => s.conflict).length,
  };
}

export interface AgencyRollup {
  agency: string;
  siteCount: number;
  counts: StatusCounts;
  blocked: number;
  conflicts: number;
  /** Worst status present in the agency, for a single at-a-glance indicator. */
  worstStatus: Status | 'unknown';
}

const STATUS_SEVERITY: Record<Status | 'unknown', number> = {
  red: 3,
  yellow: 2,
  green: 1,
  unknown: 0,
};

export function agencyRollups(data: DashboardData): AgencyRollup[] {
  const { rubric } = data.meta;
  const byAgency = new Map<string, Site[]>();
  for (const site of data.sites) {
    const list = byAgency.get(site.agency) ?? [];
    list.push(site);
    byAgency.set(site.agency, list);
  }

  const rollups: AgencyRollup[] = [];
  for (const [agency, sites] of byAgency) {
    const counts = tally(sites, rubric);
    let worst: Status | 'unknown' = 'unknown';
    for (const s of sites) {
      const st = siteStatus(s, rubric);
      if (STATUS_SEVERITY[st] > STATUS_SEVERITY[worst]) worst = st;
    }
    rollups.push({
      agency,
      siteCount: sites.length,
      counts,
      blocked: sites.filter((s) => s.blocked).length,
      conflicts: sites.filter((s) => s.conflict).length,
      worstStatus: worst,
    });
  }
  return rollups;
}

export type AgencySort = 'worst' | 'name' | 'sites';

/** Sort agency rollups. Default 'worst' surfaces the league-table laggards. */
export function sortAgencyRollups(
  rollups: AgencyRollup[],
  sort: AgencySort,
): AgencyRollup[] {
  const copy = [...rollups];
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => a.agency.localeCompare(b.agency));
    case 'sites':
      return copy.sort((a, b) => b.siteCount - a.siteCount);
    case 'worst':
    default:
      // Most red sites first, then yellow, then by size. The accountability view.
      return copy.sort(
        (a, b) =>
          b.counts.red - a.counts.red ||
          b.counts.yellow - a.counts.yellow ||
          b.siteCount - a.siteCount ||
          a.agency.localeCompare(b.agency),
      );
  }
}
