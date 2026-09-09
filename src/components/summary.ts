import * as echarts from 'echarts';
import type { DashboardData, Status } from '../types';
import { statewideSummary } from '../status';
import { statusColor } from '../tokens';
import { statusLabel } from '../format';

/**
 * Statewide summary — the leadership hero (PRD §6.2): total sites, count & %
 * by red/yellow/green, blocked count, unattributed count, plus a donut of the
 * status distribution. The automated-only caveat is embedded in the card so it
 * travels with any screenshot.
 */
export function renderSummary(root: HTMLElement, data: DashboardData): void {
  const s = statewideSummary(data);

  root.innerHTML = `
    <h2 id="statewide-summary-heading" class="section-heading">Statewide snapshot</h2>

    <div class="summary">
      <div class="summary__grid">
        ${kpi('Red', `${s.counts.red}`, 'red', pctSub(s.percentages.red, 'needs urgent attention'))}
        ${kpi('Yellow', `${s.counts.yellow}`, 'yellow', pctSub(s.percentages.yellow, 'needs review'))}
        ${kpi('Green', `${s.counts.green}`, 'green', pctSub(s.percentages.green, 'no automated blockers'))}
        ${kpi('Total sites scanned', String(s.total), 'neutral', `across ${countAgencies(data)} agencies`)}
        ${kpi('Blocked', `${s.blocked}`, 'neutral', 'could not be scanned — counted as Not scored')}
        ${kpi('Unattributed', `${s.unattributed}`, 'neutral', 'agency not yet resolved')}
      </div>

      <div class="summary__chart-card">
        <h3 class="summary__chart-title">Status distribution</h3>
        <div id="summary-donut" class="summary__donut" role="img"
             aria-label="${donutAria(s)}"></div>
      </div>
    </div>
  `;

  renderDonut(s);
}

/** Sub-line with a larger "X% of sites" lead on its own line over the descriptor. */
function pctSub(pct: number, descriptor: string): string {
  return `<span class="kpi__sub-lead">${pct}% of sites</span>${descriptor}`;
}

function kpi(
  label: string,
  value: string,
  tone: 'red' | 'yellow' | 'green' | 'neutral',
  sub: string,
): string {
  return `
    <div class="kpi kpi--${tone}">
      <p class="kpi__label">${label}</p>
      <p class="kpi__value">${value}</p>
      <p class="kpi__sub">${sub}</p>
    </div>
  `;
}

function countAgencies(data: DashboardData): number {
  return new Set(data.sites.map((s) => s.agency)).size;
}

function donutAria(s: ReturnType<typeof statewideSummary>): string {
  return (
    `Status distribution of ${s.total} sites: ` +
    `${s.counts.red} red (${s.percentages.red}%), ` +
    `${s.counts.yellow} yellow (${s.percentages.yellow}%), ` +
    `${s.counts.green} green (${s.percentages.green}%)` +
    (s.counts.unknown ? `, ${s.counts.unknown} not scored` : '') +
    '. Based on automated testing only.'
  );
}

function renderDonut(s: ReturnType<typeof statewideSummary>): void {
  const el = document.getElementById('summary-donut');
  if (!el) return;
  const chart = echarts.init(el, undefined, { renderer: 'svg' });

  // Only the four rubric statuses; the "not scored" slice appears only when
  // some sites are actually unscored.
  const slices: { key: Status | 'unknown'; value: number; pct: number }[] = [
    { key: 'red', value: s.counts.red, pct: s.percentages.red },
    { key: 'yellow', value: s.counts.yellow, pct: s.percentages.yellow },
    { key: 'green', value: s.counts.green, pct: s.percentages.green },
  ];
  if (s.counts.unknown) {
    slices.push({ key: 'unknown', value: s.counts.unknown, pct: s.percentages.unknown });
  }

  const series = slices.map((d) => ({
    name: statusLabel(d.key),
    value: d.value,
    itemStyle: { color: statusColor(d.key) },
  }));

  // The readout ("Label — N (P%)") lives in the legend so the slices themselves
  // carry no outside labels — those were the ones running off the container and
  // truncating. Percentages come from the statewide summary (whole numbers,
  // consistent with the KPI cards) instead of ECharts' own decimal recompute.
  const readout = new Map(
    slices.map((d) => [statusLabel(d.key), `${statusLabel(d.key)} — ${d.value} (${d.pct}%)`]),
  );

  // A vertical legend of up to four longish rows needs vertical room; give the
  // container enough height so neither the donut nor the legend is clipped.
  el.style.height = `${300 + slices.length * 12}px`;

  // Respect the OS "reduce motion" setting: skip the load/resize animation.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  chart.setOption({
    // decal patterns give each slice a texture, so status is distinguishable
    // without relying on color alone (WCAG 1.4.1). The generated description
    // is off so it cannot overwrite the container's summary aria-label.
    aria: { enabled: true, decal: { show: true }, label: { enabled: false } },
    animation: !reduceMotion,
    tooltip: {
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>${p.value} sites (${p.percent}%)`,
    },
    legend: {
      orient: 'vertical',
      bottom: 8,
      left: 'center',
      itemGap: 10,
      textStyle: { fontSize: 12 },
      formatter: (name: string) => readout.get(name) ?? name,
    },
    series: [
      {
        type: 'pie',
        // A solid pie (no inner radius) rather than a ring.
        radius: '62%',
        center: ['50%', '36%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        // Slices carry no outside labels — the legend is the readout.
        label: { show: false },
        labelLine: { show: false },
        data: series,
      },
    ],
  });

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);
}
