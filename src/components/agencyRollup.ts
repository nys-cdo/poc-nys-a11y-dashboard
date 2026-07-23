import * as echarts from 'echarts';
import type { DashboardData, Status } from '../types';
import { agencyRollups, sortAgencyRollups, type AgencySort } from '../status';
import { statusColor } from '../tokens';
import { statusLabel } from '../format';

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
      <strong>Select a colored segment</strong> to see those sites below.
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
    <div id="agency-table-fallback" class="visually-hidden"></div>
  `;

  const el = document.getElementById('agency-chart')!;
  const chart = echarts.init(el, undefined, { renderer: 'svg' });

  // On phones the full 69-row chart is a ~2,800px wall with sliver-thin bars.
  // Below this breakpoint we render only the first N of the current sort (which
  // defaults to most-at-risk-first) and offer a toggle to reveal the rest.
  const mobileMq = window.matchMedia('(max-width: 560px)');
  const MOBILE_CAP = 10;
  let expanded = false;
  let currentSort: AgencySort = 'worst';
  const showAllBtn = document.getElementById('agency-show-all')!;

  // Clicking a colored segment → filter + jump to the site table.
  chart.on('click', (params) => {
    if (params.componentType !== 'series') return;
    const agency = String(params.name);
    const status = LABEL_TO_STATUS[String(params.seriesName)];
    if (status) onSegmentClick?.(agency, status);
  });

  const draw = (sort: AgencySort) => {
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
        aria: { enabled: true },
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
    // Screen-reader label describes exactly what's currently rendered so it
    // stays accurate as the succinct/mobile filters collapse and expand.
    el.setAttribute('aria-label', agencyAria(rollups));
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
  };

  draw('worst');

  document
    .getElementById('agency-sort')
    ?.addEventListener('nys-change', (e: Event) => {
      const value = (e as CustomEvent<{ value: string }>).detail?.value as AgencySort;
      // Re-collapse when the sort changes so the cap always shows the new top N.
      expanded = false;
      draw(value ?? 'worst');
    });

  showAllBtn.addEventListener('nys-click', () => {
    expanded = !expanded;
    draw(currentSort);
  });

  // Redraw when crossing the mobile breakpoint (cap appears/disappears).
  mobileMq.addEventListener('change', () => {
    expanded = false;
    draw(currentSort);
  });

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);
}

function agencyAria(rollups: ReturnType<typeof agencyRollups>): string {
  const parts = rollups.map(
    (r) =>
      `${r.agency}: ${r.siteCount} sites (${r.counts.red} red, ${r.counts.yellow} yellow, ${r.counts.green} green` +
      (r.blocked ? `, ${r.blocked} blocked` : '') +
      ')',
  );
  return `Sites by agency and status, automated testing only. ${parts.join('. ')}.`;
}
