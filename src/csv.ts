/**
 * Client-side CSV export of the full site dataset — a structured,
 * assistive-tech- and analysis-friendly alternative to the charts and table
 * (offered as a "Download full data set" link). Always the WHOLE dataset, every
 * column, independent of the current view or filters.
 */
import { NO_DCT, type DashboardData } from './types';
import { issuesPerPage, officialScore, officialStatus, scoreSourceShort } from './status';
import { statusShort } from './format';

/** Quote a value only when it contains a comma, quote, or newline (RFC 4180). */
function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildSitesCsv(data: DashboardData): string {
  const { rubric } = data.meta;
  const header = [
    'Domain',
    'URL',
    'Agency',
    'DCT',
    'Official score',
    'Score source',
    'Status',
    'axe Monitor (automated)',
    'SiteImprove (automated)',
    'Auditor (manual)',
    'Auditor date',
    'Auditor runs',
    'Team (manual)',
    'Pages tested (axe Monitor)',
    'Pages indexed (SiteImprove)',
    'Open issues (axe Monitor)',
    'Critical issues',
    'Serious issues',
    'Moderate issues',
    'Minor issues',
    'Open issues per page',
    'Top rules (axe Monitor)',
    'Blocked',
    'Override justification',
    'Auditor report URL',
    'Auditor deck URL',
  ];

  const rows = [...data.sites]
    .sort((a, b) => a.domain.localeCompare(b.domain))
    .map((s) => {
      const { value, source } = officialScore(s);
      const status = officialStatus(s, rubric);
      const c = s.axeMonitorIssues;
      return [
        s.domain,
        s.url,
        s.agency,
        s.dct ?? NO_DCT,
        value,
        source ? scoreSourceShort(source) : null,
        statusShort(status),
        s.axeMonitorScore,
        s.siteImproveScore,
        s.auditorScore,
        s.auditorDate,
        s.auditorRuns.length,
        s.teamScore,
        s.axeMonitorPagesTested,
        s.siteImprovePagesIndexed,
        c?.total ?? null,
        c?.critical ?? null,
        c?.serious ?? null,
        c?.moderate ?? null,
        c?.minor ?? null,
        issuesPerPage(s),
        (s.axeMonitorTopRules ?? []).map((r) => `${r.ruleId} (${r.impact}, ${r.count})`).join('; ') || null,
        s.blocked ? 'yes' : 'no',
        s.overrideJustification,
        s.auditorReportUrl,
        s.auditorDeckUrl,
      ]
        .map((v) => csvCell(v as string | number | boolean | null))
        .join(',');
    });

  return [header.map(csvCell).join(','), ...rows].join('\r\n');
}
