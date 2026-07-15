import type { DashboardData, Site, Status } from '../types';
import { siteStatus } from '../status';
import { statusIntent, statusShort, formatScore, formatCount, esc, safeHref } from '../format';

/**
 * Site-level table (PRD §6.4): every site with domain, agency, the three
 * signals side by side, status chip, blocked & conflict badges, and links to
 * report/deck when present. Filterable by agency and status.
 *
 * Built on nys-table (native <table> in its slot) for NYSDS styling + built-in
 * column sorting. The automated-only caveat is carried in the column headers
 * and a persistent caption so the score never travels without it.
 */
export type StatusFilter = 'all' | Status | 'unknown' | 'blocked' | 'conflict';

/**
 * "Opens in new tab" affordance appended to external links. The icon itself
 * carries the announcement — role="img" + aria-label — so it contributes
 * "opens in new tab" to each link's accessible name. focusable="false" keeps
 * it out of the tab order.
 */
const EXTERNAL_ICON =
  '<svg class="external-icon" viewBox="0 0 24 24" width="16" height="16" role="img" aria-label="opens in new tab" focusable="false"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" fill="currentColor"/></svg>';

/** Controller returned by renderSiteTable, for driving the filters externally. */
export interface SiteTableController {
  /** Set both filters programmatically (e.g. from an agency-chart click). */
  applyFilters(agency: string, status: StatusFilter): void;
}

export function renderSiteTable(
  root: HTMLElement,
  data: DashboardData,
): SiteTableController {
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
      <nys-button
        id="filter-reset"
        class="filter-reset"
        label="Reset filters"
        variant="ghost"
        size="sm"
        prefixIcon="restart_alt"
      ></nys-button>
      <p id="table-count" class="table-count" aria-live="polite"></p>
    </div>

    <p class="caveat-line caveat-line--table">
      <span aria-hidden="true">⚠</span>
      axe Monitor and SiteImprove columns are <strong>automated scores</strong> (~${data.meta.automatedCoveragePct}%
      of issues). Auditor is a manual score where one exists. Status color follows the automated score;
      a <strong>blocked</strong> flag forces Red.
    </p>

    <div class="table-scroll">
    <nys-table id="sites-nys-table" sortable striped>
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
            <th scope="col" style="text-align:right">Pages tested<span class="visually-hidden"> (axe Monitor)</span></th>
            <th scope="col" style="text-align:right">Pages indexed<span class="visually-hidden"> (SiteImprove)</span></th>
            <th scope="col">Status</th>
            <th scope="col">Flags</th>
            <th scope="col">Reports</th>
          </tr>
        </thead>
        <tbody id="sites-tbody"></tbody>
      </table>
    </nys-table>
    </div>
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

  // Reset button → clear both filters back to "all".
  root
    .querySelector('#filter-reset')
    ?.addEventListener('nys-click', () => applyFilters('all', 'all'));

  // Keep an nys-select's displayed value in sync when we set filters in code.
  function syncSelect(id: string, value: string): void {
    const el = root.querySelector(id) as (HTMLElement & { value?: string }) | null;
    if (!el) return;
    el.setAttribute('value', value);
    el.value = value;
  }

  // Hoisted so the reset listener above can call it. Also the public API.
  function applyFilters(agency: string, status: StatusFilter): void {
    agencyFilter = agency;
    statusFilter = status;
    syncSelect('#filter-agency', agency);
    syncSelect('#filter-status', status);
    draw();
  }

  return { applyFilters };
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
      `<a class="external-link" href="${esc(site.auditorReportUrl)}" target="_blank" rel="noopener">Report<span class="visually-hidden"> for ${esc(site.domain)}</span>${EXTERNAL_ICON}</a>`,
    );
  }
  if (site.auditorDeckUrl) {
    links.push(
      `<a class="external-link" href="${esc(site.auditorDeckUrl)}" target="_blank" rel="noopener">Deck<span class="visually-hidden"> for ${esc(site.domain)}</span>${EXTERNAL_ICON}</a>`,
    );
  }

  // Blocked note is intentionally NOT rendered (PRD §4.2 — internal only).
  return `
    <tr>
      <td><a class="external-link" href="${esc(safeHref(site.url))}" target="_blank" rel="noopener">${esc(site.domain)}${EXTERNAL_ICON}</a></td>
      <td>${esc(site.agency)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatScore(site.axeMonitorScore)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatScore(site.siteImproveScore)}</td>
      <td class="num num--auditor" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--nys-color-text-weak)">${formatScore(site.auditorScore)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatCount(site.axeMonitorPagesTested)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatCount(site.siteImprovePagesIndexed)}</td>
      <td>${statusBadge}</td>
      <td><div class="flag-cell">${flags.join(' ') || '<span class="muted">—</span>'}</div></td>
      <td><div class="link-cell">${links.join(' ') || '<span class="muted">—</span>'}</div></td>
    </tr>
  `;
}
