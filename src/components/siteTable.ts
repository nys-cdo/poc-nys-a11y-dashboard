import type { DashboardData, Site, Status } from '../types';
import { siteStatus } from '../status';
import { statusIntent, statusShort, formatScore, esc } from '../format';

/**
 * Site-level table (PRD §6.4): every site with domain, agency, the three
 * signals side by side, status chip, blocked & conflict badges, and links to
 * report/deck when present. Filterable by agency and status.
 *
 * Built on nys-table (native <table> in its slot) for NYSDS styling + built-in
 * column sorting. The automated-only caveat is carried in the column headers
 * and a persistent caption so the score never travels without it.
 */
type StatusFilter = 'all' | Status | 'unknown' | 'blocked' | 'conflict';

export function renderSiteTable(root: HTMLElement, data: DashboardData): void {
  const agencies = [...new Set(data.sites.map((s) => s.agency))].sort((a, b) =>
    a.localeCompare(b),
  );

  root.innerHTML = `
    <h2 id="site-table-heading" class="section-heading">All sites</h2>

    <div class="table-filters">
      <nys-select id="filter-agency" label="Filter by agency" width="lg" value="all">
        <option value="all" label="All agencies"></option>
        ${agencies.map((a) => `<option value="${esc(a)}" label="${esc(a)}"></option>`).join('')}
      </nys-select>
      <nys-select id="filter-status" label="Filter by status" width="md" value="all">
        <option value="all" label="All statuses"></option>
        <option value="red" label="Red"></option>
        <option value="yellow" label="Yellow"></option>
        <option value="green" label="Green"></option>
        <option value="blocked" label="Blocked"></option>
        <option value="conflict" label="Conflict"></option>
        <option value="unknown" label="Not scored"></option>
      </nys-select>
      <p id="table-count" class="table-count" aria-live="polite"></p>
    </div>

    <p class="caveat-line caveat-line--table">
      <span aria-hidden="true">⚠</span>
      axe Monitor and SiteImprove columns are <strong>automated scores</strong> (~${data.meta.automatedCoveragePct}%
      of issues). Auditor is a manual score where one exists. Status color follows the automated score;
      a <strong>blocked</strong> flag forces Red.
    </p>

    <nys-table id="sites-nys-table" sortable>
      <table>
        <caption class="visually-hidden">
          All scanned sites with agency, automated and manual scores, status, and flags.
          Scores reflect automated testing only.
        </caption>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">Agency</th>
            <th scope="col" style="text-align:right">axe Monitor (automated)</th>
            <th scope="col" style="text-align:right">SiteImprove (automated)</th>
            <th scope="col" style="text-align:right">Auditor (manual)</th>
            <th scope="col">Status</th>
            <th scope="col">Flags</th>
            <th scope="col">Reports</th>
          </tr>
        </thead>
        <tbody id="sites-tbody"></tbody>
      </table>
    </nys-table>
  `;

  const tbody = root.querySelector<HTMLTableSectionElement>('#sites-tbody')!;
  const countEl = root.querySelector<HTMLParagraphElement>('#table-count')!;
  let agencyFilter = 'all';
  let statusFilter: StatusFilter = 'all';

  const rows = data.sites
    .map((site) => ({ site, status: siteStatus(site, data.meta.rubric) }))
    .sort((a, b) => a.site.domain.localeCompare(b.site.domain));

  function matches(site: Site, status: Status | 'unknown'): boolean {
    if (agencyFilter !== 'all' && site.agency !== agencyFilter) return false;
    switch (statusFilter) {
      case 'all':
        return true;
      case 'blocked':
        return site.blocked;
      case 'conflict':
        return site.conflict;
      default:
        return status === statusFilter;
    }
  }

  function draw(): void {
    const visible = rows.filter((r) => matches(r.site, r.status));
    tbody.innerHTML = visible.map((r) => rowHtml(r.site, r.status)).join('');
    countEl.textContent = `Showing ${visible.length} of ${rows.length} sites`;
  }

  draw();

  root
    .querySelector('#filter-agency')
    ?.addEventListener('nys-change', (e: Event) => {
      agencyFilter = (e as CustomEvent<{ value: string }>).detail?.value ?? 'all';
      draw();
    });
  root
    .querySelector('#filter-status')
    ?.addEventListener('nys-change', (e: Event) => {
      statusFilter =
        ((e as CustomEvent<{ value: string }>).detail?.value as StatusFilter) ?? 'all';
      draw();
    });
}

function rowHtml(site: Site, status: Status | 'unknown'): string {
  const statusBadge = `<nys-badge size="sm" intent="${statusIntent(status)}" label="${statusShort(status)}" prefixIcon></nys-badge>`;

  const flags: string[] = [];
  if (site.blocked) {
    flags.push(
      `<nys-badge size="sm" variant="strong" intent="error" label="Blocked" prefixIcon srText="known blocking barrier automation missed"></nys-badge>`,
    );
  }
  if (site.conflict) {
    flags.push(
      `<nys-badge size="sm" intent="warning" label="Conflict" prefixIcon srText="URL appears in both scanning tools; needs manual resolution"></nys-badge>`,
    );
  }

  const links: string[] = [];
  if (site.auditorReportUrl) {
    links.push(
      `<a href="${esc(site.auditorReportUrl)}" target="_blank" rel="noopener">Report<span class="visually-hidden"> for ${esc(site.domain)} (opens in new tab)</span></a>`,
    );
  }
  if (site.auditorDeckUrl) {
    links.push(
      `<a href="${esc(site.auditorDeckUrl)}" target="_blank" rel="noopener">Deck<span class="visually-hidden"> for ${esc(site.domain)} (opens in new tab)</span></a>`,
    );
  }

  // Blocked note is intentionally NOT rendered (PRD §4.2 — internal only).
  return `
    <tr>
      <td><a href="${esc(site.url)}" target="_blank" rel="noopener">${esc(site.domain)}<span class="visually-hidden"> (opens in new tab)</span></a></td>
      <td>${esc(site.agency)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatScore(site.axeMonitorScore)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatScore(site.siteImproveScore)}</td>
      <td class="num num--auditor" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--nys-color-text-weak)">${formatScore(site.auditorScore)}</td>
      <td>${statusBadge}</td>
      <td><div class="flag-cell">${flags.join(' ') || '<span class="muted">—</span>'}</div></td>
      <td><div class="link-cell">${links.join(' ') || '<span class="muted">—</span>'}</div></td>
    </tr>
  `;
}
