/**
 * Pure status-derivation logic. No DOM, no data loading — trivially testable
 * and the single source of truth for how a score becomes a color.
 *
 * Rules (PRD §5):
 *  - Base rubric maps an automated score to red/yellow/green (§5.1).
 *  - `blocked = true` forces Red regardless of any numeric score (§5.3).
 *  - Phase 1 does NOT blend the three signals into one number (§5.2); the
 *    Auditor (manual) score is displayed side-by-side but does NOT drive the
 *    status chip.
 *
 * DESIGN DECISION (documented for confirmation): the status chip for a site is
 * driven by the *worst* of the available AUTOMATED scores (axe Monitor,
 * SiteImprove) — the conservative / accountability-oriented reading of §5.1 +
 * the "worst-case indicator" language in §6.3. Change `siteAutomatedScore`
 * below if leadership prefers "axe Monitor authoritative" or "average".
 */

import type { DashboardData, Rubric, Site, Status } from './types';
import { UNATTRIBUTED } from './types';

/** Map a 0–100 score to a status via inclusive rubric ranges. */
export function scoreToStatus(score: number, rubric: Rubric): Status {
  if (score <= rubric.red[1]) return 'red';
  if (score <= rubric.yellow[1]) return 'yellow';
  return 'green';
}

/**
 * The automated score that drives a site's status chip: the worst (lowest) of
 * the present automated scores. Null if the site has no automated score at all.
 */
export function siteAutomatedScore(site: Site): number | null {
  const scores = [site.axeMonitorScore, site.siteImproveScore].filter(
    (s): s is number => typeof s === 'number',
  );
  return scores.length ? Math.min(...scores) : null;
}

/**
 * Resolve a site's displayed status.
 *  - blocked always wins → red (PRD §5.3)
 *  - otherwise map the worst automated score
 *  - if there is no automated score, it is unknown (rendered as a neutral chip)
 */
export function siteStatus(site: Site, rubric: Rubric): Status | 'unknown' {
  if (site.blocked) return 'red';
  const auto = siteAutomatedScore(site);
  if (auto === null) return 'unknown';
  return scoreToStatus(auto, rubric);
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
