import { NO_DCT, type DashboardData, type Site, type Status } from '../types';
import {
  dctKey,
  highIssues,
  officialScore,
  officialStatus,
  scoreSourceLabel,
  siteCoverage,
  type ScoreSource,
} from '../status';
import { buildSitesCsv } from '../csv';
import {
  statusIntent,
  statusShort,
  statusLabel,
  formatScore,
  formatCount,
  esc,
  safeHref,
} from '../format';
import { openSiteDetail } from './siteDetail';

/**
 * Site-level table (PRD §6.4). Two modes:
 *
 *  - 'succinct' (default): Domain | Agency | DCT | Score | Source | Coverage |
 *    Issues | Notes | Status. The Score cell shows the OFFICIAL value; Source
 *    says which signal supplied it; Coverage is the pages the automated score
 *    rests on; Issues opens the site's issue profile; Notes carries a
 *    source-driven annotation (team rationale, auditor report/deck links).
 *  - 'full' (the `?full` advanced view): every automated + manual signal side
 *    by side, plus a Team score column, issue counts, status chip, flags, and
 *    report links. Never renders notes (overrideJustification / blocked_note).
 *
 * Built on nys-table (native <table> in its slot) for NYSDS styling + built-in
 * column sorting. Filterable by DCT, agency, and status; the "official score"
 * is the single number every mode agrees on.
 */
export type TableMode = 'succinct' | 'full';
export type StatusFilter = 'all' | Status | 'unknown' | 'blocked';

/** The three table filters. `'all'` clears a dimension. */
export interface SiteFilters {
  /** A DCT name, `NO_DCT`, or `'all'`. */
  dct: string;
  /** An agency name or `'all'`. */
  agency: string;
  status: StatusFilter;
}

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
  /** Set the filters programmatically (e.g. from a rollup-chart click). */
  applyFilters(filters: SiteFilters): void;
  /** The filters currently applied. */
  getFilters(): SiteFilters;
}

export interface SiteTableOptions {
  mode?: TableMode;
  /** Filters to start with (from the URL). Defaults to everything. */
  initialFilters?: SiteFilters;
  /** Called after every filter change, from the selects or `applyFilters`. */
  onChange?: (filters: SiteFilters) => void;
}

export function renderSiteTable(
  root: HTMLElement,
  data: DashboardData,
  opts: SiteTableOptions = {},
): SiteTableController {
  const mode: TableMode = opts.mode ?? 'succinct';
  const { rubric } = data.meta;

  const agencies = [...new Set(data.sites.map((s) => s.agency))].sort((a, b) =>
    a.localeCompare(b),
  );
  // DCTs in page order (its.ny.gov lists them by surname), then the no-DCT
  // bucket last — only DCTs that actually cover a site are offered.
  const presentDcts = new Set(data.sites.map(dctKey));
  const dcts = data.meta.dcts.map((d) => d.name).filter((n) => presentDcts.has(n));
  if (presentDcts.has(NO_DCT)) dcts.push(NO_DCT);

  // A downloadable CSV of the WHOLE dataset (every site, every column) — a
  // structured, screen-reader- and analysis-friendly alternative to the charts.
  // A real <a download> (href built once) so it works with keyboard and
  // right-click "Save link as" without a click handler.
  const csvUrl = URL.createObjectURL(
    // Lead with a UTF-8 BOM so Excel opens accented agency names correctly.
    new Blob(['\uFEFF' + buildSitesCsv(data)], { type: 'text/csv;charset=utf-8' }),
  );

  // Status options: succinct drops blocked/conflict (they aren't scores); full
  // keeps them because it surfaces the flag badges alongside the number.
  // The color dots make an active status filter stand out in the select.
  const statusOptions =
    mode === 'full'
      ? `
        <option value="red" label="Red 🔴"></option>
        <option value="yellow" label="Yellow 🟡"></option>
        <option value="green" label="Green 🟢"></option>
        <option value="blocked" label="Blocked"></option>
        <option value="unknown" label="Not scored"></option>`
      : `
        <option value="red" label="Red 🔴"></option>
        <option value="yellow" label="Yellow 🟡"></option>
        <option value="green" label="Green 🟢"></option>
        <option value="unknown" label="Not scored"></option>`;

  const initial = opts.initialFilters ?? { dct: 'all', agency: 'all', status: 'all' };

  root.innerHTML = `
    <h2 id="site-table-heading" class="section-heading">All sites</h2>

    <div class="table-filters">
      <nys-select id="filter-dct" label="Filter by DCT" width="lg" value="${esc(initial.dct)}">
        <option value="all" label="All DCTs"></option>
        ${dcts.map((d) => `<option value="${esc(d)}" label="${esc(d)}"></option>`).join('')}
      </nys-select>
      <nys-select id="filter-agency" label="Filter by agency" width="lg" value="${esc(initial.agency)}">
        <option value="all" label="All agencies"></option>
        ${agencies.map((a) => `<option value="${esc(a)}" label="${esc(a)}"></option>`).join('')}
      </nys-select>
      <nys-select id="filter-status" label="Filter by status" width="md" value="${esc(initial.status)}">
        <option value="all" label="All statuses"></option>
        ${statusOptions}
      </nys-select>
      <nys-button
        id="filter-reset"
        class="filter-reset"
        label="Reset filters"
        variant="ghost"
        size="sm"
        prefixIcon="refresh"
      ></nys-button>
      <p id="table-count" class="table-count" aria-live="polite"></p>
      <a class="table-download" href="${csvUrl}" download="nys-accessibility-dashboard.csv">
        Download full data set (CSV)
      </a>
    </div>

    ${caveatLine(mode, data.meta.automatedCoveragePct)}

    <div class="table-scroll">
    <nys-table id="sites-nys-table" data-mode="${mode}" sortable striped>
      <table>
        <caption class="visually-hidden">${caption(mode)}</caption>
        <thead>
          <tr>${headerCells(mode)}</tr>
        </thead>
        <tbody id="sites-tbody"></tbody>
      </table>
    </nys-table>
    </div>
  `;

  const tbody = root.querySelector<HTMLTableSectionElement>('#sites-tbody')!;
  const countEl = root.querySelector<HTMLParagraphElement>('#table-count')!;
  let dctFilter = initial.dct;
  let agencyFilter = initial.agency;
  let statusFilter: StatusFilter = initial.status;

  const rows = data.sites
    .map((site) => ({ site, status: officialStatus(site, rubric) }))
    .sort((a, b) => a.site.domain.localeCompare(b.site.domain));
  const siteByDomain = new Map(data.sites.map((s) => [s.domain, s]));

  // The Issues cell is a button that opens the site's issue profile; one
  // delegated listener covers every row, including rows drawn later.
  tbody.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-issues-for]');
    const site = btn && siteByDomain.get(btn.dataset.issuesFor ?? '');
    if (site) openSiteDetail(site, data);
  });

  function matches(site: Site, status: Status | 'unknown'): boolean {
    if (dctFilter !== 'all' && dctKey(site) !== dctFilter) return false;
    if (agencyFilter !== 'all' && site.agency !== agencyFilter) return false;
    switch (statusFilter) {
      case 'all':
        return true;
      case 'blocked':
        return site.blocked;
      default:
        return status === statusFilter;
    }
  }

  const rowHtml = mode === 'full' ? fullRowHtml : succinctRowHtml;

  const columnCount = mode === 'full' ? 15 : 9;

  function draw(): void {
    const visible = rows.filter((r) => matches(r.site, r.status));
    tbody.innerHTML = visible.length
      ? visible.map((r, i) => rowHtml(r.site, r.status, i)).join('')
      : `<tr><td colspan="${columnCount}" class="table-empty">No sites match these filters.</td></tr>`;
    countEl.textContent = `Showing ${visible.length} of ${rows.length} sites`;
  }

  function getFilters(): SiteFilters {
    return { dct: dctFilter, agency: agencyFilter, status: statusFilter };
  }

  function changed(): void {
    draw();
    opts.onChange?.(getFilters());
  }

  draw();

  // nys-select reads its `value` attribute before the options are slotted, so
  // an initial filter from the URL only shows once the property is set on the
  // upgraded element.
  void customElements.whenDefined('nys-select').then(() => {
    syncSelect('#filter-dct', dctFilter);
    syncSelect('#filter-agency', agencyFilter);
    syncSelect('#filter-status', statusFilter);
  });

  root
    .querySelector('#filter-dct')
    ?.addEventListener('nys-change', (e: Event) => {
      dctFilter = (e as CustomEvent<{ value: string }>).detail?.value ?? 'all';
      changed();
    });
  root
    .querySelector('#filter-agency')
    ?.addEventListener('nys-change', (e: Event) => {
      agencyFilter = (e as CustomEvent<{ value: string }>).detail?.value ?? 'all';
      changed();
    });
  root
    .querySelector('#filter-status')
    ?.addEventListener('nys-change', (e: Event) => {
      statusFilter =
        ((e as CustomEvent<{ value: string }>).detail?.value as StatusFilter) ?? 'all';
      changed();
    });

  // Reset button → clear every filter back to "all".
  root
    .querySelector('#filter-reset')
    ?.addEventListener('nys-click', () =>
      applyFilters({ dct: 'all', agency: 'all', status: 'all' }),
    );

  // Keep an nys-select's displayed value in sync when we set filters in code.
  function syncSelect(id: string, value: string): void {
    const el = root.querySelector(id) as (HTMLElement & { value?: string }) | null;
    if (!el) return;
    el.setAttribute('value', value);
    el.value = value;
  }

  // Hoisted so the reset listener above can call it. Also the public API.
  function applyFilters({ dct, agency, status }: SiteFilters): void {
    dctFilter = dct;
    agencyFilter = agency;
    statusFilter = status;
    syncSelect('#filter-dct', dct);
    syncSelect('#filter-agency', agency);
    syncSelect('#filter-status', status);
    changed();
  }

  return { applyFilters, getFilters };
}

/* -------------------------------------------------------------------------- */
/* Shared shell helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The status badge shared by BOTH table modes, so the succinct and `?full`
 * views always render the official status identically. Strong fill (the updated
 * badge design) + an intent icon (a shape cue beyond color — WCAG 1.4.1) +
 * the visible color label, with the meaning ("Needs urgent attention") appended
 * for screen readers via srText.
 */
function statusBadge(status: Status | 'unknown'): string {
  return `<nys-badge
      size="sm"
      strong
      intent="${statusIntent(status)}"
      label="${statusShort(status)}"
      prefixIcon
      srText="${esc(statusLabel(status))}"
    ></nys-badge>`;
}

/** DCT name, or a muted placeholder when no DCT portfolio covers the agency. */
function dctCell(site: Site): string {
  return site.dct ? esc(site.dct) : `<span class="muted">${NO_DCT}</span>`;
}

function caption(mode: TableMode): string {
  return mode === 'full'
    ? 'All scanned sites with agency, DCT, automated and manual scores, open issues, status, and flags. Scores reflect automated testing only unless a manual score exists.'
    : 'All sites with agency, DCT, the official accessibility score, its source, coverage, and open issues.';
}

/** Coverage cell: the pages the automated score rests on, with its kind. */
function coverageCell(site: Site): string {
  const cov = siteCoverage(site);
  if (!cov) return '<span class="muted">—</span>';
  return `${formatCount(cov.pages)} <span class="muted">${cov.kind}</span>`;
}

/**
 * Issues cell: total open issues with the critical + serious share, as a
 * button that opens the site's issue profile. Nothing for sites axe Monitor
 * has not run.
 */
function issuesCell(site: Site): string {
  const c = site.axeMonitorIssues;
  if (!c) return '<span class="muted">—</span>';
  const high = highIssues(c) ?? 0;
  return `<button
      type="button"
      class="issues-btn"
      data-issues-for="${esc(site.domain)}"
      aria-label="Issue profile for ${esc(site.domain)}: ${formatCount(c.total)} open issues, ${formatCount(high)} critical or serious"
    >${formatCount(c.total)}${high ? ` <span class="issues-btn__high">${formatCount(high)} high</span>` : ''}</button>`;
}

/** Source cell: which signal supplied the official score. */
function sourceCell(source: ScoreSource): string {
  if (!source) return '<span class="muted">—</span>';
  const manual = source === 'team' || source === 'auditor';
  return `<span class="source source--${manual ? 'manual' : 'automated'}">${esc(scoreSourceLabel(source))}</span>`;
}

function caveatLine(mode: TableMode, coveragePct: number): string {
  if (mode === 'full') {
    return `
    <p class="caveat-line caveat-line--table">
      <span aria-hidden="true">⚠</span>
      axe Monitor and SiteImprove columns are <strong>automated scores</strong> (~${coveragePct}%
      of issues). Auditor and Team are <strong>manual scores</strong> where one exists. Status color
      follows the <strong>official score</strong> (team → auditor → axe Monitor → SiteImprove); a
      <strong>blocked</strong> flag marks a site that could not be scanned or scored (counted as Not scored).
    </p>`;
  }
  return `
    <p class="caveat-line caveat-line--table">
      <span aria-hidden="true">⚠</span>
      Score is the <strong>official value</strong> — a team or auditor manual score where one exists,
      otherwise the automated (~${coveragePct}% of issues) score; <strong>Source</strong> says which.
      <strong>Coverage</strong> is the pages behind an automated score. <strong>Issues</strong> is the
      open axe Monitor count (select it for the site’s profile). <strong>Notes</strong> holds a
      rationale tooltip or a report link.
    </p>`;
}

function headerCells(mode: TableMode): string {
  if (mode === 'full') {
    return `
      <th scope="col">Domain</th>
      <th scope="col">Agency</th>
      <th scope="col">DCT</th>
      <th scope="col" style="text-align:right">axe Monitor (automated)</th>
      <th scope="col" style="text-align:right">SiteImprove (automated)</th>
      <th scope="col" style="text-align:right">Auditor (manual)</th>
      <th scope="col" style="text-align:right">Team (manual)</th>
      <th scope="col" style="text-align:right">Pages tested<span class="visually-hidden"> (axe Monitor)</span></th>
      <th scope="col" style="text-align:right">Pages indexed<span class="visually-hidden"> (SiteImprove)</span></th>
      <th scope="col" style="text-align:right">Open issues<span class="visually-hidden"> (axe Monitor)</span></th>
      <th scope="col" style="text-align:right">Critical + serious</th>
      <th scope="col">Source</th>
      <th scope="col">Status</th>
      <th scope="col">Flags</th>
      <th scope="col">Reports</th>`;
  }
  return `
      <th scope="col">Domain</th>
      <th scope="col">Agency</th>
      <th scope="col">DCT</th>
      <th scope="col" style="text-align:right">Score</th>
      <th scope="col">Source</th>
      <th scope="col" style="text-align:right">Coverage<span class="visually-hidden"> (pages)</span></th>
      <th scope="col" style="text-align:right">Issues</th>
      <th scope="col">Notes</th>
      <th scope="col">Status</th>`;
}

/* -------------------------------------------------------------------------- */
/* Succinct mode                                                              */
/* -------------------------------------------------------------------------- */

/** Icon-only external link, rendered as a compact circular nys-button that
 *  navigates (href → <a>). `label` becomes the button's accessible name in
 *  circle mode; we fold "opens in new tab" into it. */
function iconLinkButton(url: string, icon: string, label: string, domain: string): string {
  return `<nys-button
      href="${esc(safeHref(url))}"
      target="_blank"
      circle
      size="sm"
      variant="ghost"
      icon="${icon}"
      label="${esc(label)} for ${esc(domain)} (opens in new tab)"
    ></nys-button>`;
}

/** Score-rationale affordance: a compact circular nys-button that triggers an
 *  nys-tooltip (for → id) revealing the team's override justification on
 *  hover/focus. Rendered only when justification text exists. `index` gives the
 *  trigger a unique id per row.
 *
 *  NOTE: this depends on the nys-table slotting fix (post-1.19.3). Before it,
 *  nys-table deep-cloned its slotted table into its shadow root, so the
 *  tooltip's `for=id` (resolved via document.getElementById) hit the hidden
 *  light-DOM original instead of the visible shadow clone and never fired. */
function rationaleTooltip(site: Site, index: number): string {
  const text = (site.overrideJustification ?? '').trim();
  if (!text) return '';
  const id = `rationale-${index}`;
  return `<nys-button
      id="${id}"
      circle
      size="sm"
      variant="ghost"
      icon="info"
      label="Score rationale for ${esc(site.domain)}"
    ></nys-button>` +
    `<nys-tooltip for="${id}" text="${esc(text)}"></nys-tooltip>`;
}

/** Contents of the succinct Notes column, chosen by the official score's source:
 *  team → rationale tooltip; auditor → report/deck link icons; monitor → report
 *  link icon; siteimprove/none → nothing. */
function notesCell(site: Site, source: ScoreSource, index: number): string {
  switch (source) {
    case 'team':
      return rationaleTooltip(site, index);
    case 'auditor': {
      const parts: string[] = [];
      if (site.auditorReportUrl) parts.push(iconLinkButton(site.auditorReportUrl, 'link', 'Auditor report', site.domain));
      if (site.auditorDeckUrl) parts.push(iconLinkButton(site.auditorDeckUrl, 'open_in_new', 'Auditor deck', site.domain));
      return parts.join('');
    }
    case 'monitor':
      // monitorReportUrl is currently always null → renders nothing. Graceful.
      return site.monitorReportUrl
        ? iconLinkButton(site.monitorReportUrl, 'open_in_new', 'axe Monitor report', site.domain)
        : '';
    default:
      // 'siteimprove' or null → no annotation.
      return '';
  }
}

function succinctRowHtml(site: Site, status: Status | 'unknown', index: number): string {
  const { value, source } = officialScore(site);
  // The color badge lives in its own (last) column; the Score column carries
  // just the number; Source, Coverage, and Issues sit between; the Notes
  // column carries the source affordances.
  const badge = statusBadge(status);
  const valueHtml = value === null ? '<span class="muted">—</span>' : formatScore(value);
  const notes = notesCell(site, source, index);

  return `
    <tr>
      <td><a class="external-link" href="${esc(safeHref(site.url))}" target="_blank" rel="noopener">${esc(site.domain)}${EXTERNAL_ICON}</a></td>
      <td>${esc(site.agency)}</td>
      <td>${dctCell(site)}</td>
      <td class="num score-num">${valueHtml}</td>
      <td>${sourceCell(source)}</td>
      <td class="num">${coverageCell(site)}</td>
      <td class="num">${issuesCell(site)}</td>
      <td><div class="notes-cell">${notes}</div></td>
      <td>${badge}</td>
    </tr>
  `;
}

/* -------------------------------------------------------------------------- */
/* Full mode                                                                  */
/* -------------------------------------------------------------------------- */

function fullRowHtml(site: Site, status: Status | 'unknown', _index: number): string {
  const flags: string[] = [];
  if (site.blocked) {
    flags.push(
      `<nys-badge size="sm" strong intent="danger" label="Blocked" prefixIcon srText="could not be scanned or scored"></nys-badge>`,
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

  const { source } = officialScore(site);

  // Notes (overrideJustification / blocked_note) are intentionally NEVER rendered.
  return `
    <tr>
      <td><a class="external-link" href="${esc(safeHref(site.url))}" target="_blank" rel="noopener">${esc(site.domain)}${EXTERNAL_ICON}</a></td>
      <td>${esc(site.agency)}</td>
      <td>${dctCell(site)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatScore(site.axeMonitorScore)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatScore(site.siteImproveScore)}</td>
      <td class="num num--auditor" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--nys-color-text-weak)">${formatScore(site.auditorScore)}</td>
      <td class="num num--team" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatScore(site.teamScore)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatCount(site.axeMonitorPagesTested)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatCount(site.siteImprovePagesIndexed)}</td>
      <td class="num">${issuesCell(site)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatCount(highIssues(site.axeMonitorIssues))}</td>
      <td>${sourceCell(source)}</td>
      <td>${statusBadge(status)}</td>
      <td><div class="flag-cell">${flags.join(' ') || '<span class="muted">—</span>'}</div></td>
      <td><div class="link-cell">${links.join(' ') || '<span class="muted">—</span>'}</div></td>
    </tr>
  `;
}
