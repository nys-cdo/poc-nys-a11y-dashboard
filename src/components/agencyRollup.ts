import * as echarts from 'echarts';
import type { DashboardData, Status } from '../types';
import { agencyRollups, sortAgencyRollups, type AgencySort } from '../status';
import { statusColor } from '../tokens';
import { statusLabel, esc } from '../format';

/** Called when a user clicks an agency's colored segment. */
export type SegmentClickHandler = (
  agency: string,
  status: Status | 'unknown',
) => void;

/** Reverse map: ECharts series name (a status label) → status key. */
const LABEL_TO_STATUS: Record<string, Status | 'unknown'> = {
  [statusLabel('red')]: 'red',
  [statusLabel('yellow')]: 'yellow',
  [statusLabel('green')]: 'green',
  [statusLabel('unknown')]: 'unknown',
};

/**
 * Agency rollup (PRD §6.3): one horizontal stacked bar per agency (red/yellow/
 * green segments) — reads as an instant league table. Sortable. This is the
 * peer-comparison surface that does the accountability work at DCT Council.
 *
 * Clicking a colored segment invokes `onSegmentClick(agency, status)` so the
 * caller can filter + scroll to the site table.
 */
/** Render options. */
export interface AgencyRollupOptions {
  /**
   * Succinct default: hide agencies with a single scanned site (siteCount < 2)
   * behind the expand toggle. When false (the `?full` view), show every agency.
   */
  hideSingleScan?: boolean;
}

export function renderAgencyRollup(
  root: HTMLElement,
  data: DashboardData,
  onSegmentClick?: SegmentClickHandler,
  opts?: AgencyRollupOptions,
): void {
  const hideSingleScan = opts?.hideSingleScan ?? false;
  root.innerHTML = `
    <div class="section-heading-row">
      <h2 id="agency-rollup-heading" class="section-heading">By agency</h2>
      <nys-select
        id="agency-sort"
        label="Sort agencies"
        width="md"
        value="worst"
      >
        <option value="worst" label="Most at-risk first"></option>
        <option value="name" label="Agency name (A–Z)"></option>
        <option value="sites" label="Number of sites"></option>
      </nys-select>
    </div>
    <p class="section-sub">
      Each bar shows the share of an agency’s sites at each status.
      <strong>Select a colored segment</strong>, or use the agency and status
      filters on the site table below, to see those sites.
      <span class="caveat-inline"><span aria-hidden="true">⚠</span> automated testing only</span>
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

  // Clicking a colored segment → filter + jump to the site table.
  chart.on('click', (params) => {
    if (params.componentType !== 'series') return;
    const agency = String(params.name);
    const status = LABEL_TO_STATUS[String(params.seriesName)];
    if (status) onSegmentClick?.(agency, status);
  });

  const draw = (sort: AgencySort, announce = false) => {
    currentSort = sort;
    const isMobile = mobileMq.matches;
    const allRollups = sortAgencyRollups(agencyRollups(data), sort);

    // Two collapsing dimensions, both released by the single expand toggle:
    //   1. hideSingleScan (succinct default) — drop 1-site agencies.
    //   2. mobile cap — only the top N fit legibly on a phone.
    // The collapsed base is what's shown before the mobile cap is applied.
    const collapsedBase = hideSingleScan
      ? allRollups.filter((r) => r.siteCount >= 2)
      : allRollups;
    const rollups = expanded
      ? allRollups
      : isMobile
        ? collapsedBase.slice(0, MOBILE_CAP)
        : collapsedBase;
    // ECharts y-axis renders bottom-up; reverse so the first item sits on top.
    const ordered = [...rollups].reverse();
    const agencies = ordered.map((r) => r.agency);

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
    el.style.height = `${Math.max(240, agencies.length * 40 + topPad + 40)}px`;
    chart.setOption(
      {
        // decal patterns per status so segments are distinguishable without
        // relying on color alone (WCAG 1.4.1).
        aria: { enabled: true, decal: { show: true } },
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
            width: isMobile ? 96 : 220,
            overflow: 'truncate',
            fontSize: 12,
          },
        },
        series,
      },
      { notMerge: true },
    );
    // The chart is an image with a SHORT summary label; the full per-agency
    // breakdown lives in the adjacent visually-hidden data table (rebuilt to
    // match what's currently rendered), which a screen reader can navigate.
    el.setAttribute('aria-label', agencyAria(rollups.length, allRollups.length));
    fallbackEl.innerHTML = agencyFallbackTable(rollups);
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
        expanded ? 'Show fewer agencies' : `Show all ${allRollups.length} agencies`,
      );
      // Chevron points down to expand, up to collapse.
      showAllBtn.setAttribute('suffixIcon', expanded ? 'chevron_up' : 'chevron_down');
    }

    // Announce sort/expand changes (not the initial paint) so screen-reader
    // users know the chart updated.
    if (announce) {
      liveEl.textContent = `Showing ${rollups.length} of ${allRollups.length} agencies, sorted by ${sortDescription(sort)}.`;
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
}

/** Short summary label for the chart image. The full breakdown is in the
 *  adjacent data table (agencyFallbackTable), so this stays concise. */
function agencyAria(shown: number, total: number): string {
  const scope =
    shown >= total
      ? `all ${total} agencies`
      : `the top ${shown} of ${total} agencies`;
  return (
    `Bar chart: share of each agency’s sites by accessibility status ` +
    `(red, yellow, green), automated testing only, for ${scope}. ` +
    `The full agency breakdown follows in the data table below.`
  );
}

/** Human description of a sort mode, for the live-region announcement. */
function sortDescription(sort: AgencySort): string {
  switch (sort) {
    case 'name':
      return 'agency name';
    case 'sites':
      return 'number of sites';
    case 'worst':
    default:
      return 'most at-risk first';
  }
}

/** Visually-hidden data table mirroring the currently-rendered rollups — the
 *  structured, navigable alternative to the chart image. */
function agencyFallbackTable(rollups: ReturnType<typeof agencyRollups>): string {
  const hasUnknown = rollups.some((r) => r.counts.unknown > 0);
  const hasBlocked = rollups.some((r) => r.blocked > 0);

  const heads = ['Agency', 'Red', 'Yellow', 'Green'];
  if (hasUnknown) heads.push('Not scored');
  if (hasBlocked) heads.push('Blocked');
  heads.push('Total sites');
  const thead = heads.map((h) => `<th scope="col">${h}</th>`).join('');

  const body = rollups
    .map((r) => {
      const cells = [`<th scope="row">${esc(r.agency)}</th>`];
      const nums = [r.counts.red, r.counts.yellow, r.counts.green];
      if (hasUnknown) nums.push(r.counts.unknown);
      if (hasBlocked) nums.push(r.blocked);
      nums.push(r.siteCount);
      cells.push(...nums.map((n) => `<td>${n}</td>`));
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  return (
    `<table><caption>Sites by agency and accessibility status (automated testing only)</caption>` +
    `<thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table>`
  );
}
