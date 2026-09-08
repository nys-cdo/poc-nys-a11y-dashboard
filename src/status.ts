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
import { NO_DCT, UNATTRIBUTED } from './types';

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

/**
 * How sites are grouped for the rollup chart: by DCT portfolio (the default —
 * the accountability unit at DCT Council) or by individual agency.
 */
export type Grouping = 'dct' | 'agency';

export interface AgencyRollup {
  /**
   * The group key: an agency name, or (for `dct` grouping) the DCT name /
   * `NO_DCT`. Filters and the fallback table key on this.
   */
  agency: string;
  /** What the chart prints for the group: the agency list for a DCT, else the key. */
  label: string;
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

/** A site's DCT key: the DCT name, or the literal `NO_DCT` bucket. */
export function dctKey(site: Pick<Site, 'dct'>): string {
  return site.dct ?? NO_DCT;
}

/**
 * The chart label for a DCT group: the portfolio's agency list, comma-joined
 * ("Gaming, DHR, OMIG, …"). The portfolio is what's being compared, so the
 * bars name the agencies rather than the person.
 */
export function dctLabel(dctName: string, data: DashboardData): string {
  if (dctName === NO_DCT) return NO_DCT;
  const group = data.meta.dcts.find((d) => d.name === dctName);
  return group?.agencies.join(', ') || dctName;
}

export function agencyRollups(data: DashboardData, grouping: Grouping = 'agency'): AgencyRollup[] {
  const { rubric } = data.meta;
  const byKey = new Map<string, Site[]>();
  for (const site of data.sites) {
    const key = grouping === 'dct' ? dctKey(site) : site.agency;
    const list = byKey.get(key) ?? [];
    list.push(site);
    byKey.set(key, list);
  }

  const rollups: AgencyRollup[] = [];
  for (const [key, sites] of byKey) {
    const counts = tally(sites, rubric);
    let worst: Status | 'unknown' = 'unknown';
    for (const s of sites) {
      const st = siteStatus(s, rubric);
      if (STATUS_SEVERITY[st] > STATUS_SEVERITY[worst]) worst = st;
    }
    rollups.push({
      agency: key,
      label: grouping === 'dct' ? dctLabel(key, data) : key,
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
  // The no-DCT catch-all is not a portfolio, so it never competes for the top
  // of the league table: it is pinned to the end under every sort.
  const pinned = rollups.filter((r) => r.agency === NO_DCT);
  const copy = rollups.filter((r) => r.agency !== NO_DCT);
  switch (sort) {
    case 'name':
      copy.sort((a, b) => a.label.localeCompare(b.label));
      break;
    case 'sites':
      copy.sort((a, b) => b.siteCount - a.siteCount);
      break;
    case 'worst':
    default:
      // Most red sites first, then yellow, then by size. The accountability view.
      copy.sort(
        (a, b) =>
          b.counts.red - a.counts.red ||
          b.counts.yellow - a.counts.yellow ||
          b.siteCount - a.siteCount ||
          a.agency.localeCompare(b.agency),
      );
  }
  return [...copy, ...pinned];
}
