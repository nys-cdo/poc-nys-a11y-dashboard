import * as echarts from 'echarts';
import type { DashboardData } from '../types';
import { agencyRollups, sortAgencyRollups, type AgencySort } from '../status';
import { statusColor } from '../tokens';
import { statusLabel } from '../format';

/**
 * Agency rollup (PRD §6.3): one horizontal stacked bar per agency (red/yellow/
 * green segments) — reads as an instant league table. Sortable. This is the
 * peer-comparison surface that does the accountability work at DCT Council.
 */
export function renderAgencyRollup(root: HTMLElement, data: DashboardData): void {
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
      <span class="caveat-inline"><span aria-hidden="true">⚠</span> automated testing only</span>
    </p>
    <div id="agency-chart" class="agency-chart" role="img" aria-label="Loading agency chart"></div>
    <div id="agency-table-fallback" class="visually-hidden"></div>
  `;

  const el = document.getElementById('agency-chart')!;
  const chart = echarts.init(el, undefined, { renderer: 'svg' });

  const draw = (sort: AgencySort) => {
    const rollups = sortAgencyRollups(agencyRollups(data), sort);
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
        show: true,
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

    el.style.height = `${Math.max(240, agencies.length * 40 + 80)}px`;
    chart.setOption(
      {
        aria: { enabled: true },
        grid: { left: 8, right: 24, top: 40, bottom: 8, containLabel: true },
        legend: { top: 0, left: 'center' },
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
          axisLabel: { color: '#1b1b1b', width: 220, overflow: 'truncate', fontSize: 12 },
        },
        series,
      },
      { notMerge: true },
    );
    el.setAttribute('aria-label', agencyAria(rollups));
  };

  draw('worst');

  document
    .getElementById('agency-sort')
    ?.addEventListener('nys-change', (e: Event) => {
      const value = (e as CustomEvent<{ value: string }>).detail?.value as AgencySort;
      draw(value ?? 'worst');
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
