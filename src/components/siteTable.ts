import type { DashboardData, Site, Status } from '../types';
import { officialScore, officialStatus, type ScoreSource } from '../status';
import { statusIntent, statusShort, formatScore, formatCount, esc, safeHref } from '../format';

/**
 * Site-level table (PRD §6.4). Two modes:
 *
 *  - 'succinct' (default): Domain | Agency | Score. The Score cell shows the
 *    OFFICIAL value + a strong status badge, with a source-driven annotation
 *    (team note disclosure, auditor report/deck links, or axe Monitor link).
 *  - 'full' (the `?full` advanced view): every automated + manual signal side
 *    by side, plus a Team score column, status chip, flags, and report links.
 *    Never renders notes (overrideJustification / blocked_note).
 *
 * Built on nys-table (native <table> in its slot) for NYSDS styling + built-in
 * column sorting. Filterable by agency and status; the "official score" is the
 * single number every mode agrees on.
 */
export type TableMode = 'succinct' | 'full';
export type StatusFilter = 'all' | Status | 'unknown' | 'blocked' | 'conflict';

/**
 * "Opens in new tab" affordance appended to external links. The icon itself
 * carries the announcement — role="img" + aria-label — so it contributes
 * "opens in new tab" to each link's accessible name. focusable="false" keeps
 * it out of the tab order.
 */
const EXTERNAL_ICON =
  '<svg class="external-icon" viewBox="0 0 24 24" width="16" height="16" role="img" aria-label="opens in new tab" focusable="false"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" fill="currentColor"/></svg>';

/**
 * Note glyph for the score-rationale disclosure. Purely decorative — the
 * <summary> carries a visually-hidden accessible name — so it is aria-hidden.
 */
const NOTE_ICON =
  '<svg class="note-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" fill="currentColor"/></svg>';

/** Controller returned by renderSiteTable, for driving the filters externally. */
export interface SiteTableController {
  /** Set both filters programmatically (e.g. from an agency-chart click). */
  applyFilters(agency: string, status: StatusFilter): void;
}

export interface SiteTableOptions {
  mode?: TableMode;
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

  // Status options: succinct drops blocked/conflict (they aren't scores); full
  // keeps them because it surfaces the flag badges alongside the number.
  const statusOptions =
    mode === 'full'
      ? `
        <option value="red" label="Red"></option>
        <option value="yellow" label="Yellow"></option>
        <option value="green" label="Green"></option>
        <option value="blocked" label="Blocked"></option>
        <option value="conflict" label="Conflict"></option>
        <option value="unknown" label="Not scored"></option>`
      : `
        <option value="red" label="Red"></option>
        <option value="yellow" label="Yellow"></option>
        <option value="green" label="Green"></option>
        <option value="unknown" label="Not scored"></option>`;

  root.innerHTML = `
    <h2 id="site-table-heading" class="section-heading">All sites</h2>

    <div class="table-filters">
      <nys-select id="filter-agency" label="Filter by agency" width="lg" value="all">
        <option value="all" label="All agencies"></option>
        ${agencies.map((a) => `<option value="${esc(a)}" label="${esc(a)}"></option>`).join('')}
      </nys-select>
      <nys-select id="filter-status" label="Filter by status" width="md" value="all">
        <option value="all" label="All statuses"></option>
        ${statusOptions}
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

    ${caveatLine(mode, data.meta.automatedCoveragePct)}

    <div class="table-scroll">
    <nys-table id="sites-nys-table" sortable striped>
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
  let agencyFilter = 'all';
  let statusFilter: StatusFilter = 'all';

  const rows = data.sites
    .map((site) => ({ site, status: officialStatus(site, rubric) }))
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

  const rowHtml = mode === 'full' ? fullRowHtml : succinctRowHtml;

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

/* -------------------------------------------------------------------------- */
/* Shared shell helpers                                                        */
/* -------------------------------------------------------------------------- */

function caption(mode: TableMode): string {
  return mode === 'full'
    ? 'All scanned sites with agency, automated and manual scores, status, and flags. Scores reflect automated testing only unless a manual score exists.'
    : 'All sites with agency and the official accessibility score.';
}

function caveatLine(mode: TableMode, coveragePct: number): string {
  if (mode === 'full') {
    return `
    <p class="caveat-line caveat-line--table">
      <span aria-hidden="true">⚠</span>
      axe Monitor and SiteImprove columns are <strong>automated scores</strong> (~${coveragePct}%
      of issues). Auditor and Team are <strong>manual scores</strong> where one exists. Status color
      follows the <strong>official score</strong> (team → auditor → axe Monitor → SiteImprove); a
      <strong>blocked</strong> flag marks a barrier automation missed but no longer changes the score.
    </p>`;
  }
  return `
    <p class="caveat-line caveat-line--table">
      <span aria-hidden="true">⚠</span>
      Score is the <strong>official value</strong> — a team or auditor manual score where one exists,
      otherwise the automated (~${coveragePct}% of issues) score. Open the note or report icon in a
      score cell for the source detail.
    </p>`;
}

function headerCells(mode: TableMode): string {
  if (mode === 'full') {
    return `
      <th scope="col">Domain</th>
      <th scope="col">Agency</th>
      <th scope="col" style="text-align:right">axe Monitor (automated)</th>
      <th scope="col" style="text-align:right">SiteImprove (automated)</th>
      <th scope="col" style="text-align:right">Auditor (manual)</th>
      <th scope="col" style="text-align:right">Team (manual)</th>
      <th scope="col" style="text-align:right">Pages tested<span class="visually-hidden"> (axe Monitor)</span></th>
      <th scope="col" style="text-align:right">Pages indexed<span class="visually-hidden"> (SiteImprove)</span></th>
      <th scope="col">Status</th>
      <th scope="col">Flags</th>
      <th scope="col">Reports</th>`;
  }
  return `
      <th scope="col">Domain</th>
      <th scope="col">Agency</th>
      <th scope="col">Score</th>`;
}

/* -------------------------------------------------------------------------- */
/* Succinct mode                                                              */
/* -------------------------------------------------------------------------- */

/** Icon-only external link. The visually-hidden label + the icon's own
 *  "opens in new tab" announcement form the link's accessible name. */
function iconLink(url: string, label: string, domain: string): string {
  return `<a class="icon-link" href="${esc(safeHref(url))}" target="_blank" rel="noopener"><span class="visually-hidden">${esc(label)} for ${esc(domain)}</span>${EXTERNAL_ICON}</a>`;
}

/** Native disclosure revealing the team's override justification. Rendered
 *  only when justification text exists. */
function noteDisclosure(site: Site): string {
  const text = (site.overrideJustification ?? '').trim();
  if (!text) return '';
  return `<details class="note-disclosure">
      <summary class="note-toggle"><span class="visually-hidden">Score rationale for ${esc(site.domain)}</span>${NOTE_ICON}</summary>
      <div class="note-body">${esc(text)}</div>
    </details>`;
}

/** Source-driven annotation controls for the succinct score cell. */
function succinctAnnotation(site: Site, source: ScoreSource): string {
  switch (source) {
    case 'team':
      return noteDisclosure(site);
    case 'auditor': {
      const parts: string[] = [];
      if (site.auditorReportUrl) parts.push(iconLink(site.auditorReportUrl, 'Auditor report', site.domain));
      if (site.auditorDeckUrl) parts.push(iconLink(site.auditorDeckUrl, 'Auditor deck', site.domain));
      return parts.join('');
    }
    case 'monitor':
      // monitorReportUrl is currently always null → renders nothing. Graceful.
      return site.monitorReportUrl
        ? iconLink(site.monitorReportUrl, 'axe Monitor report', site.domain)
        : '';
    default:
      // 'siteimprove' or null → no annotation.
      return '';
  }
}

function succinctRowHtml(site: Site, status: Status | 'unknown'): string {
  const { value, source } = officialScore(site);
  const badge = `<nys-badge size="sm" variant="strong" intent="${statusIntent(status)}" label="${statusShort(status)}"></nys-badge>`;
  const valueHtml =
    value === null ? '' : `<span class="score-cell__value">${formatScore(value)}</span>`;
  const annotation = succinctAnnotation(site, source);

  return `
    <tr>
      <td><a class="external-link" href="${esc(safeHref(site.url))}" target="_blank" rel="noopener">${esc(site.domain)}${EXTERNAL_ICON}</a></td>
      <td>${esc(site.agency)}</td>
      <td class="score-cell">
        <div class="score-cell__main">${valueHtml}${badge}${annotation}</div>
      </td>
    </tr>
  `;
}

/* -------------------------------------------------------------------------- */
/* Full mode                                                                  */
/* -------------------------------------------------------------------------- */

function fullRowHtml(site: Site, status: Status | 'unknown'): string {
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

  // Notes (overrideJustification / blocked_note) are intentionally NEVER rendered.
  return `
    <tr>
      <td><a class="external-link" href="${esc(safeHref(site.url))}" target="_blank" rel="noopener">${esc(site.domain)}${EXTERNAL_ICON}</a></td>
      <td>${esc(site.agency)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatScore(site.axeMonitorScore)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatScore(site.siteImproveScore)}</td>
      <td class="num num--auditor" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--nys-color-text-weak)">${formatScore(site.auditorScore)}</td>
      <td class="num num--team" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatScore(site.teamScore)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatCount(site.axeMonitorPagesTested)}</td>
      <td class="num" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${formatCount(site.siteImprovePagesIndexed)}</td>
      <td>${statusBadge}</td>
      <td><div class="flag-cell">${flags.join(' ') || '<span class="muted">—</span>'}</div></td>
      <td><div class="link-cell">${links.join(' ') || '<span class="muted">—</span>'}</div></td>
    </tr>
  `;
}
