import * as echarts from 'echarts';
import { NO_DCT, type DashboardData, type Status } from '../types';
import {
  agencyRollups,
  dctKey,
  sortAgencyRollups,
  type AgencySort,
  type Grouping,
} from '../status';
import { statusColor } from '../tokens';
import { statusLabel, esc } from '../format';

/**
 * Called when a user clicks a group's colored segment. `key` is the group's
 * filter key — a DCT name (or `NO_DCT`) under `dct` grouping, else an agency.
 */
export type SegmentClickHandler = (
  grouping: Grouping,
  key: string,
  status: Status | 'unknown',
) => void;

/** Plural noun for the current grouping, for copy and announcements. */
function groupNoun(grouping: Grouping, count?: number): string {
  const one = grouping === 'dct' ? 'DCT portfolio' : 'agency';
  const many = grouping === 'dct' ? 'DCT portfolios' : 'agencies';
  return count === 1 ? one : many;
}

/** Reverse map: ECharts series name (a status label) → status key. */
const LABEL_TO_STATUS: Record<string, Status | 'unknown'> = {
  [statusLabel('red')]: 'red',
  [statusLabel('yellow')]: 'yellow',
  [statusLabel('green')]: 'green',
  [statusLabel('unknown')]: 'unknown',
};

/**
 * Rollup chart (PRD §6.3): one horizontal stacked bar per group (red/yellow/
 * green segments) — reads as an instant league table. Grouped by DCT
 * portfolio by default (each bar labeled with the portfolio's agencies, never
 * the DCT's name) or by agency; sortable. This is the peer-comparison surface
 * that does the accountability work at DCT Council.
 *
 * Clicking a colored segment invokes `onSegmentClick(grouping, key, status)`
 * so the caller can filter + scroll to the site table.
 */
/** Render options. */
export interface AgencyRollupOptions {
  /**
   * Succinct default: under `agency` grouping, hide agencies with a single
   * scanned site (siteCount < 2) behind the expand toggle. When false (the
   * `?full` view), show every agency. Never applies to DCT grouping.
   */
  hideSingleScan?: boolean;
  /** Initial grouping. Defaults to `dct`. */
  grouping?: Grouping;
  /**
   * Show only this portfolio (a DCT name or `NO_DCT`): one bar under DCT
   * grouping, its agencies under agency grouping. Null = every portfolio.
   */
  focusDct?: string | null;
  /** Called when the user asks to compare all portfolios again. */
  onClearFocus?: () => void;
}

/** Controller returned by renderAgencyRollup, so the URL state can scope it. */
export interface AgencyRollupController {
  /** Scope the chart to one portfolio, or null for all. */
  setFocus(dct: string | null): void;
}

export function renderAgencyRollup(
  root: HTMLElement,
  data: DashboardData,
  onSegmentClick?: SegmentClickHandler,
  opts?: AgencyRollupOptions,
): AgencyRollupController {
  const hideSingleScan = opts?.hideSingleScan ?? false;
  let grouping: Grouping = opts?.grouping ?? 'dct';
  let focusDct: string | null = opts?.focusDct ?? null;
  root.innerHTML = `
    <div class="section-heading-row">
      <h2 id="agency-rollup-heading" class="section-heading">By DCT portfolio</h2>
      <div class="section-controls">
        <nys-select
          id="agency-grouping"
          label="Group by"
          width="md"
          value="${grouping}"
        >
          <option value="dct" label="DCT portfolio"></option>
          <option value="agency" label="Agency"></option>
        </nys-select>
        <nys-select
          id="agency-sort"
          label="Sort"
          width="md"
          value="worst"
        >
          <option value="worst" label="Most at-risk first"></option>
          <option value="name" label="Name (A–Z)"></option>
          <option value="sites" label="Number of sites"></option>
        </nys-select>
      </div>
    </div>
    <p class="section-sub">
      <span id="agency-rollup-sub"></span>
      <strong>Select a colored segment</strong>, or use the filters on the
      site table below, to see those sites.
      <span class="caveat-inline"><span aria-hidden="true">⚠</span> automated testing only</span>
      <span id="agency-rollup-focus" hidden>
        Showing only this portfolio.
        <button type="button" id="agency-clear-focus" class="app-header__banner-link">Compare all portfolios</button>
      </span>
    </p>
    <div id="agency-chart" class="agency-chart" role="img" aria-label="Loading agency chart"></div>
    <div class="agency-chart__actions">
      <nys-button
        id="agency-show-all"
        variant="outline"
        size="sm"
        label="Show all agencies"
        suffixIcon="chevron_down"
      ></nys-button>
    </div>
    <p id="agency-live" class="visually-hidden" role="status" aria-live="polite"></p>
    <!-- Structured, screen-reader alternative to the chart image; rebuilt in
         draw() to match what's currently rendered. -->
    <div id="agency-table-fallback" class="visually-hidden"></div>
  `;

  const el = document.getElementById('agency-chart')!;
  const chart = echarts.init(el, undefined, { renderer: 'svg' });

  // On phones the full 69-row chart is a ~2,800px wall with sliver-thin bars.
  // Below this breakpoint we render only the first N of the current sort (which
  // defaults to most-at-risk-first) and offer a toggle to reveal the rest.
  const mobileMq = window.matchMedia('(max-width: 560px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOBILE_CAP = 10;
  let expanded = false;
  let currentSort: AgencySort = 'worst';
  const showAllBtn = document.getElementById('agency-show-all')!;
  const liveEl = document.getElementById('agency-live')!;
  const fallbackEl = document.getElementById('agency-table-fallback')!;
  const headingEl = document.getElementById('agency-rollup-heading')!;
  const subEl = document.getElementById('agency-rollup-sub')!;
  const focusEl = document.getElementById('agency-rollup-focus')!;
  document
    .getElementById('agency-clear-focus')
    ?.addEventListener('click', () => opts?.onClearFocus?.());

  /** Agencies that belong to the focused portfolio (for agency grouping). */
  const agenciesInFocus = (): Set<string> =>
    new Set(data.sites.filter((s) => dctKey(s) === focusDct).map((s) => s.agency));
  // Chart categories are display labels (a DCT bar shows its agency list);
  // this maps a label back to the group's filter key for the click handler.
  let keyByLabel = new Map<string, string>();

  // Clicking a colored segment → filter + jump to the site table.
  chart.on('click', (params) => {
    if (params.componentType !== 'series') return;
    const key = keyByLabel.get(String(params.name)) ?? String(params.name);
    const status = LABEL_TO_STATUS[String(params.seriesName)];
    if (status) onSegmentClick?.(grouping, key, status);
  });

  const draw = (sort: AgencySort, announce = false) => {
    currentSort = sort;
    const isMobile = mobileMq.matches;
    const isDct = grouping === 'dct';
    // In one portfolio's context the chart shows only that portfolio: its
    // single bar under DCT grouping, its agencies under agency grouping.
    const inFocus = focusDct ? agenciesInFocus() : null;
    const scoped = agencyRollups(data, grouping).filter((r) =>
      !focusDct ? true : isDct ? r.agency === focusDct : inFocus!.has(r.agency),
    );
    const allRollups = sortAgencyRollups(scoped, sort);
    keyByLabel = new Map(allRollups.map((r) => [r.label, r.agency]));

    const focusName = focusDct === NO_DCT ? NO_DCT : focusDct ? `${focusDct}'s portfolio` : '';
    headingEl.textContent = isDct
      ? focusDct ? focusName : 'By DCT portfolio'
      : focusDct ? `By agency, ${focusName}` : 'By agency';
    subEl.textContent = isDct
      ? focusDct
        ? 'The bar shows the share of this portfolio’s sites at each status. Group by agency to compare the agencies within it. '
        : 'Each bar is one Deputy Commissioner for Technology’s portfolio, labeled with its agencies, and shows the share of its sites at each status. '
      : focusDct
        ? 'Each bar shows the share of an agency’s sites at each status, for the agencies in this portfolio. '
        : 'Each bar shows the share of an agency’s sites at each status. ';
    focusEl.hidden = !focusDct;

    // Two collapsing dimensions, both released by the single expand toggle:
    //   1. hideSingleScan (succinct default, agency grouping only) — drop
    //      1-site agencies. DCT portfolios are always all shown, and so is
    //      every agency of a focused portfolio.
    //   2. mobile cap — only the top N fit legibly on a phone.
    // The collapsed base is what's shown before the mobile cap is applied.
    const collapsedBase =
      hideSingleScan && !isDct && !focusDct ? allRollups.filter((r) => r.siteCount >= 2) : allRollups;
    const rollups = expanded
      ? allRollups
      : isMobile
        ? collapsedBase.slice(0, MOBILE_CAP)
        : collapsedBase;
    // ECharts y-axis renders bottom-up; reverse so the first item sits on top.
    const ordered = [...rollups].reverse();
    const agencies = ordered.map((r) => r.label);
    // Portfolio labels list several agencies and wrap to a second line, so
    // DCT rows get more height and a wider label column than agency rows.
    const rowHeight = isDct ? 52 : 40;
    const labelWidth = isMobile ? 110 : isDct ? 300 : 220;

    const mk = (key: 'red' | 'yellow' | 'green' | 'unknown', status: 'red' | 'yellow' | 'green' | 'unknown') => ({
      name: statusLabel(status),
      type: 'bar' as const,
      stack: 'total',
      color: statusColor(status),
      emphasis: { focus: 'series' as const },
      label: {
        // In-bar counts turn to illegible overlap once bars go sliver-thin, so
        // hide them on mobile — the per-row tooltip carries the numbers there.
        show: !isMobile,
        formatter: (p: { value: number }) => (p.value > 0 ? String(p.value) : ''),
        color: status === 'yellow' ? '#1b1b1b' : '#fff',
        fontSize: 11,
        fontWeight: 'bold',
      },
      data: ordered.map((r) => r.counts[key]),
    });

    const series = [mk('green', 'green'), mk('yellow', 'yellow'), mk('red', 'red')];
    if (ordered.some((r) => r.counts.unknown > 0)) {
      series.push(mk('unknown', 'unknown'));
    }

    // Reserve room for the legend (which can wrap to two rows on a narrow
    // phone) so neither it nor the top bar is clipped, plus the x-axis name at
    // the bottom.
    const topPad = isMobile ? 72 : 48;
    el.style.height = `${Math.max(240, agencies.length * rowHeight + topPad + 40)}px`;
    chart.setOption(
      {
        // decal patterns per status so segments are distinguishable without
        // relying on color alone (WCAG 1.4.1). The generated description is
        // off: it would overwrite the summary aria-label set below, and the
        // fallback data table is the real long description.
        aria: { enabled: true, decal: { show: true }, label: { enabled: false } },
        animation: !reduceMotion,
        grid: { left: 8, right: 24, top: topPad, bottom: 8, containLabel: true },
        legend: { top: 8, left: 'center' },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
        },
        xAxis: {
          type: 'value',
          minInterval: 1,
          name: 'Sites',
          nameLocation: 'end',
          nameGap: 8,
          axisLabel: { color: '#62666a' },
        },
        yAxis: {
          type: 'category',
          data: agencies,
          // Narrower label column on mobile so the bars aren't squeezed to slivers.
          axisLabel: {
            color: '#1b1b1b',
            width: labelWidth,
            // Portfolio lists wrap onto two lines; agency names truncate.
            overflow: isDct ? 'break' : 'truncate',
            lineHeight: 15,
            fontSize: 12,
          },
        },
        series,
      },
      { notMerge: true },
    );
    // The chart is an image with a SHORT summary label; the full per-group
    // breakdown lives in the adjacent visually-hidden data table (rebuilt to
    // match what's currently rendered), which a screen reader can navigate.
    el.setAttribute('aria-label', agencyAria(grouping, rollups.length, allRollups.length));
    fallbackEl.innerHTML = agencyFallbackTable(grouping, rollups);
    // The container height is dynamic (grows with agency count). The SVG
    // renderer needs an explicit resize to match the new height, not just the
    // ResizeObserver — otherwise the chart draws compressed on first paint.
    chart.resize();

    // The toggle is meaningful whenever something is hidden: either single-scan
    // agencies (succinct default) or agencies beyond the mobile cap. Show it
    // when collapsed hides rows, or when expanded so the user can collapse back.
    const collapsedCount = isMobile
      ? Math.min(collapsedBase.length, MOBILE_CAP)
      : collapsedBase.length;
    const hasHidden = allRollups.length > collapsedCount;
    showAllBtn.style.display = hasHidden ? '' : 'none';
    if (hasHidden) {
      showAllBtn.setAttribute(
        'label',
        expanded
          ? `Show fewer ${groupNoun(grouping)}`
          : `Show all ${allRollups.length} ${groupNoun(grouping)}`,
      );
      // Chevron points down to expand, up to collapse.
      showAllBtn.setAttribute('suffixIcon', expanded ? 'chevron_up' : 'chevron_down');
    }

    // Announce sort/grouping/expand changes (not the initial paint) so
    // screen-reader users know the chart updated.
    if (announce) {
      liveEl.textContent = `Showing ${rollups.length} of ${allRollups.length} ${groupNoun(grouping)}, sorted by ${sortDescription(sort)}.`;
    }
  };

  draw('worst');

  document
    .getElementById('agency-sort')
    ?.addEventListener('nys-change', (e: Event) => {
      const value = (e as CustomEvent<{ value: string }>).detail?.value as AgencySort;
      // Re-collapse when the sort changes so the cap always shows the new top N.
      expanded = false;
      draw(value ?? 'worst', true);
    });

  document
    .getElementById('agency-grouping')
    ?.addEventListener('nys-change', (e: Event) => {
      const value = (e as CustomEvent<{ value: string }>).detail?.value;
      grouping = value === 'agency' ? 'agency' : 'dct';
      expanded = false;
      draw(currentSort, true);
    });

  showAllBtn.addEventListener('nys-click', () => {
    expanded = !expanded;
    draw(currentSort, true);
  });

  // Redraw when crossing the mobile breakpoint (cap appears/disappears).
  mobileMq.addEventListener('change', () => {
    expanded = false;
    draw(currentSort);
  });

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);

  return {
    setFocus(dct) {
      if (dct === focusDct) return;
      focusDct = dct;
      expanded = false;
      draw(currentSort, true);
    },
  };
}

/** Short summary label for the chart image. The full breakdown is in the
 *  adjacent data table (agencyFallbackTable), so this stays concise. */
function agencyAria(grouping: Grouping, shown: number, total: number): string {
  const noun = groupNoun(grouping);
  const scope = shown >= total ? `all ${total} ${noun}` : `the top ${shown} of ${total} ${noun}`;
  const unit = grouping === 'dct' ? 'DCT portfolio’s' : 'agency’s';
  return (
    `Bar chart: share of each ${unit} sites by accessibility status ` +
    `(red, yellow, green), automated testing only, for ${scope}. ` +
    `The full breakdown follows in the data table below.`
  );
}

/** Human description of a sort mode, for the live-region announcement. */
function sortDescription(sort: AgencySort): string {
  switch (sort) {
    case 'name':
      return 'name';
    case 'sites':
      return 'number of sites';
    case 'worst':
    default:
      return 'most at-risk first';
  }
}

/** Visually-hidden data table mirroring the currently-rendered rollups — the
 *  structured, navigable alternative to the chart image. */
function agencyFallbackTable(
  grouping: Grouping,
  rollups: ReturnType<typeof agencyRollups>,
): string {
  const hasUnknown = rollups.some((r) => r.counts.unknown > 0);
  const hasBlocked = rollups.some((r) => r.blocked > 0);

  const heads = [grouping === 'dct' ? 'DCT portfolio (agencies)' : 'Agency', 'Red', 'Yellow', 'Green'];
  if (hasUnknown) heads.push('Not scored');
  if (hasBlocked) heads.push('Blocked');
  heads.push('Total sites');
  const thead = heads.map((h) => `<th scope="col">${h}</th>`).join('');

  const body = rollups
    .map((r) => {
      const cells = [`<th scope="row">${esc(r.label)}</th>`];
      const nums = [r.counts.red, r.counts.yellow, r.counts.green];
      if (hasUnknown) nums.push(r.counts.unknown);
      if (hasBlocked) nums.push(r.blocked);
      nums.push(r.siteCount);
      cells.push(...nums.map((n) => `<td>${n}</td>`));
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  return (
    `<table><caption>Sites by ${groupNoun(grouping, 1)} and accessibility status (automated testing only)</caption>` +
    `<thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table>`
  );
}
