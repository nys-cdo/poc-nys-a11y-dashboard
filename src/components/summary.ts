import * as echarts from 'echarts';
import type { DashboardData } from '../types';
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
        ${kpi('Total sites scanned', String(s.total), 'neutral', `across ${countAgencies(data)} agencies`)}
        ${kpi('Red', `${s.counts.red}`, 'red', `${s.percentages.red}% of sites · needs urgent attention`)}
        ${kpi('Yellow', `${s.counts.yellow}`, 'yellow', `${s.percentages.yellow}% of sites · needs review`)}
        ${kpi('Green', `${s.counts.green}`, 'green', `${s.percentages.green}% of sites · no automated blockers`)}
        ${kpi('Blocked', `${s.blocked}`, 'red', 'known barrier automation missed — forced Red')}
        ${kpi('Unattributed', `${s.unattributed}`, 'neutral', 'agency not yet resolved')}
      </div>

      <div class="summary__chart-card">
        <h3 class="summary__chart-title">Status distribution</h3>
        <div id="summary-donut" class="summary__donut" role="img"
             aria-label="${donutAria(s)}"></div>
        <p class="caveat-line">
          <span aria-hidden="true">⚠</span>
          Based on automated testing only (~${data.meta.automatedCoveragePct}% of issues).
          Green = no automated blockers detected, not “accessible.”
        </p>
      </div>
    </div>
  `;

  renderDonut(s);
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

  const series = [
    { name: statusLabel('red'), value: s.counts.red, color: statusColor('red') },
    { name: statusLabel('yellow'), value: s.counts.yellow, color: statusColor('yellow') },
    { name: statusLabel('green'), value: s.counts.green, color: statusColor('green') },
  ];
  if (s.counts.unknown) {
    series.push({
      name: statusLabel('unknown'),
      value: s.counts.unknown,
      color: statusColor('unknown'),
    });
  }

  chart.setOption({
    aria: { enabled: true },
    tooltip: {
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>${p.value} sites (${p.percent}%)`,
    },
    legend: { bottom: 0, left: 'center' },
    series: [
      {
        type: 'pie',
        radius: ['52%', '78%'],
        center: ['50%', '42%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: true, formatter: '{d}%', fontSize: 12 },
        data: series.map((d) => ({
          name: d.name,
          value: d.value,
          itemStyle: { color: d.color },
        })),
      },
    ],
  });

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);
}
