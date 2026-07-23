/**
 * Client-side CSV export of the full site dataset — a structured,
 * assistive-tech- and analysis-friendly alternative to the charts and table
 * (offered as a "Download full data set" link). Always the WHOLE dataset, every
 * column, independent of the current view or filters.
 */
import type { DashboardData } from './types';
import { officialScore, officialStatus } from './status';
import { statusShort } from './format';

/** Quote a value only when it contains a comma, quote, or newline (RFC 4180). */
function csvCell(value: string | number | boolean | null): string {
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
    'Official score',
    'Status',
    'axe Monitor (automated)',
    'SiteImprove (automated)',
    'Auditor (manual)',
    'Team (manual)',
    'Pages tested (axe Monitor)',
    'Pages indexed (SiteImprove)',
    'Blocked',
    'Override justification',
    'Auditor report URL',
    'Auditor deck URL',
  ];

  const rows = [...data.sites]
    .sort((a, b) => a.domain.localeCompare(b.domain))
    .map((s) => {
      const { value } = officialScore(s);
      const status = officialStatus(s, rubric);
      return [
        s.domain,
        s.url,
        s.agency,
        value,
        statusShort(status),
        s.axeMonitorScore,
        s.siteImproveScore,
        s.auditorScore,
        s.teamScore,
        s.axeMonitorPagesTested,
        s.siteImprovePagesIndexed,
        s.blocked ? 'yes' : 'no',
        s.overrideJustification,
        s.auditorReportUrl,
        s.auditorDeckUrl,
      ]
        .map(csvCell)
        .join(',');
    });

  return [header.map(csvCell).join(','), ...rows].join('\r\n');
}
