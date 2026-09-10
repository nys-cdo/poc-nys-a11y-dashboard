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

import type { DashboardData, Impact, IssueCounts, Rubric, Site, Status, TopRule } from './types';
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

/** Human label for the source that supplied the official score. */
export function scoreSourceLabel(source: ScoreSource): string {
  switch (source) {
    case 'team':
      return 'Team review (manual)';
    case 'auditor':
      return 'Axe Auditor (manual)';
    case 'monitor':
      return 'Axe Monitor (automated)';
    case 'siteimprove':
      return 'SiteImprove (automated)';
    default:
      return 'No score';
  }
}

/** True when the official score came from a person rather than a scanner. */
export function isManualSource(source: ScoreSource): boolean {
  return source === 'team' || source === 'auditor';
}

/**
 * How much of a site the automated score is based on: axe Monitor's pages
 * tested in the latest run, else SiteImprove's indexed page count. The two
 * are not comparable, so the kind travels with the number.
 */
export interface Coverage {
  pages: number;
  kind: 'tested' | 'indexed';
}

export function siteCoverage(site: Site): Coverage | null {
  if (site.axeMonitorPagesTested !== null) return { pages: site.axeMonitorPagesTested, kind: 'tested' };
  if (site.siteImprovePagesIndexed !== null) return { pages: site.siteImprovePagesIndexed, kind: 'indexed' };
  return null;
}

/** Critical + serious open issues — the "fix first" load. */
export function highIssues(counts: IssueCounts | null): number | null {
  return counts ? counts.critical + counts.serious : null;
}

/** Open issues per page tested (one decimal), when both numbers exist. */
export function issuesPerPage(site: Site): number | null {
  const total = site.axeMonitorIssues?.total;
  const pages = site.axeMonitorPagesTested;
  if (total === undefined || total === null || !pages) return null;
  return Math.round((total / pages) * 10) / 10;
}

/** A site counts as audited when a person has scored it (Auditor run or team score). */
export function isAudited(site: Site): boolean {
  return site.auditorScore !== null || site.auditorRuns.length > 0;
}

/** Axe Auditor's mobile asset types ("Mobile Web", "iOS", …). */
export function isMobileAudit(assetType: string | null | undefined): boolean {
  return /mobile|ios|android/i.test(assetType ?? '');
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

/* -------------------------------------------------------------------------- */
/* Portfolio summary (one DCT)                                                */
/* -------------------------------------------------------------------------- */

/** A failing rule aggregated across a portfolio's sites. */
export interface PortfolioRule extends TopRule {
  /** How many of the portfolio's sites list this rule among their top rules. */
  sites: number;
}

/** Two-snapshot comparison of a portfolio-wide mean. */
export interface MonthOverMonth {
  month: string;
  prevMonth: string;
  /** Mean in each month, across the sites that had a value. */
  now: number;
  prev: number;
  /** `now - prev`. */
  delta: number;
  sitesNow: number;
  sitesPrev: number;
}

export interface PortfolioSummary {
  dct: string;
  /** The portfolio's agency list (the chart label). */
  label: string;
  agencies: string[];
  sites: Site[];
  total: number;
  counts: StatusCounts;
  percentages: StatusCounts;
  /** Sites with a manual audit (Axe Auditor run or team score). */
  audited: number;
  /** Sum of axe Monitor pages tested across the portfolio. */
  pagesTested: number;
  /** Sum of SiteImprove pages indexed across the portfolio. */
  pagesIndexed: number;
  /** Open axe Monitor issues across the portfolio; null when no site has counts. */
  issues: (IssueCounts & { high: number; sitesCounted: number }) | null;
  /** The portfolio's most frequent failing rules, from its sites' top rules. */
  topRules: PortfolioRule[];
  /** Mean automated score, latest snapshot vs the one before; null with <2 snapshots. */
  momScore: MonthOverMonth | null;
  /** Mean open issues per site, latest snapshot vs the one before; null until two snapshots carry counts. */
  momIssues: MonthOverMonth | null;
}

const IMPACT_RANK: Record<Impact, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

/** Everything the portfolio strip shows for one DCT (or the no-DCT bucket). */
export function portfolioSummary(data: DashboardData, dctName: string): PortfolioSummary {
  const { rubric } = data.meta;
  const sites = data.sites.filter((s) => dctKey(s) === dctName);
  const counts = tally(sites, rubric);
  const group = data.meta.dcts.find((d) => d.name === dctName);

  const withCounts = sites.filter((s) => s.axeMonitorIssues);
  const issues = withCounts.length
    ? withCounts.reduce(
        (acc, s) => {
          const c = s.axeMonitorIssues!;
          acc.total += c.total;
          acc.critical += c.critical;
          acc.serious += c.serious;
          acc.moderate += c.moderate;
          acc.minor += c.minor;
          acc.high += c.critical + c.serious;
          return acc;
        },
        { total: 0, critical: 0, serious: 0, moderate: 0, minor: 0, high: 0, sitesCounted: withCounts.length },
      )
    : null;

  const ruleMap = new Map<string, PortfolioRule>();
  for (const s of sites) {
    for (const r of s.axeMonitorTopRules ?? []) {
      const agg = ruleMap.get(r.ruleId);
      if (agg) {
        agg.count += r.count;
        agg.sites += 1;
        if (IMPACT_RANK[r.impact] < IMPACT_RANK[agg.impact]) agg.impact = r.impact;
      } else {
        ruleMap.set(r.ruleId, { ...r, sites: 1 });
      }
    }
  }
  const topRules = [...ruleMap.values()]
    .sort((a, b) => b.count - a.count || b.sites - a.sites || a.ruleId.localeCompare(b.ruleId))
    .slice(0, 5);

  return {
    dct: dctName,
    label: dctLabel(dctName, data),
    agencies: group?.agencies ?? [],
    sites,
    total: sites.length,
    counts,
    percentages: toPercentages(counts, sites.length),
    audited: sites.filter(isAudited).length,
    pagesTested: sites.reduce((n, s) => n + (s.axeMonitorPagesTested ?? 0), 0),
    pagesIndexed: sites.reduce((n, s) => n + (s.siteImprovePagesIndexed ?? 0), 0),
    issues,
    topRules,
    momScore: monthOverMonth(data, dctName, 'automated'),
    momIssues: monthOverMonth(data, dctName, 'issues'),
  };
}

/**
 * Compare the last two monthly snapshots for a portfolio: the mean of `field`
 * across the portfolio's sites that had a value in each month. Null when there
 * are not two snapshots, or either month has no site with a value.
 */
function monthOverMonth(
  data: DashboardData,
  dctName: string,
  field: 'automated' | 'issues',
): MonthOverMonth | null {
  const { snapshots, sites } = data.history;
  if (snapshots.length < 2) return null;
  const i = snapshots.length - 1;
  const rows = sites.filter((s) => (s.dct ?? NO_DCT) === dctName);
  const mean = (idx: number): [number, number] => {
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const v = r[field]?.[idx];
      if (v !== null && v !== undefined) {
        sum += v;
        n += 1;
      }
    }
    return [n ? sum / n : NaN, n];
  };
  const [now, sitesNow] = mean(i);
  const [prev, sitesPrev] = mean(i - 1);
  if (!sitesNow || !sitesPrev) return null;
  const round = (v: number) => (field === 'issues' ? Math.round(v) : Math.round(v * 10) / 10);
  return {
    month: snapshots[i].month,
    prevMonth: snapshots[i - 1].month,
    now: round(now),
    prev: round(prev),
    delta: round(now - prev),
    sitesNow,
    sitesPrev,
  };
}
