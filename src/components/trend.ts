import * as echarts from 'echarts';
import { NO_DCT, type DashboardData, type HistorySite } from '../types';
import { dctLabel, isMobileAudit } from '../status';
import { AUDIT_COLOR, AUTOMATED_COLOR, SERIES_OTHER, SERIES_PALETTE } from '../tokens';
import { esc, formatMonth } from '../format';

/**
 * Monthly trend: the automated score over time (one line) with manual Axe
 * Auditor audits marked as diamonds in the month they happened. Reads ONLY the
 * compiled `history` block in dashboard-data.json — every point is one of our
 * committed monthly snapshots (or an axe-run backfill for months before the
 * first one); the page never calls an API.
 *
 * Three scopes:
 *   - statewide (default): the average across every site, one line;
 *   - one DCT portfolio: a line per agency in it (each an average);
 *   - one agency: a line per site.
 * Up to eight lines carry a fixed identity color + marker shape and appear in
 * the legend; any beyond that are drawn in neutral gray and identified in the
 * tooltip and the data table, so hues are never cycled.
 */
export type TrendScope = 'all' | 'dct' | 'agency';
type Scope = TrendScope;

/** Controller returned by renderTrend, so the URL state can drive the scope. */
export interface TrendController {
  /** Show one portfolio / agency (or everything), syncing the selects. */
  setScope(scope: Scope, key?: string): void;
}

interface Line {
  name: string;
  /** Score per snapshot (aligned to history.snapshots); null = no data. */
  values: (number | null)[];
  /** Sites contributing per snapshot (for "average of N sites" tooltips). */
  counts: number[];
}

interface Audit {
  monthIndex: number;
  score: number;
  domain: string;
  /** "Desktop Web", "Mobile Web", … or null when the run didn't say. */
  assetType: string | null;
  /** Mobile-web audits are drawn as their own series (a different marker). */
  mobile: boolean;
}

const MOBILE_SERIES = 'Axe Auditor (mobile web audit)';
const DESKTOP_SERIES = 'Axe Auditor (manual audit)';

const MAX_IDENTIFIED = SERIES_PALETTE.length;
/** Marker shapes for identified lines — a second cue beyond hue. Diamond is
 *  reserved for audits. */
const LINE_SYMBOLS = ['circle', 'rect', 'triangle', 'roundRect', 'pin', 'arrow', 'circle', 'rect'];

/** Every calendar month from `from` to `to` inclusive, as `YYYY-MM`. */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 240) break; // safety valve
  }
  return out;
}

export function renderTrend(root: HTMLElement, data: DashboardData): TrendController {
  const { history } = data;
  // The axis is a contiguous run of months spanning both the snapshots and
  // every manual audit, so audits that predate the first snapshot sit in
  // their own month rather than piling onto the first one.
  const snapshotMonths = history.snapshots.map((s) => s.month);
  const auditMonths = history.sites.flatMap((s) => s.audits.map((a) => a.month));
  const allMonths = [...snapshotMonths, ...auditMonths].sort();
  const months = allMonths.length ? monthRange(allMonths[0], allMonths[allMonths.length - 1]) : [];
  // Snapshot index per axis month (null = no snapshot that month).
  const snapshotAt = months.map((m) => {
    const i = snapshotMonths.indexOf(m);
    return i === -1 ? null : i;
  });

  // DCTs present in the history, in page order, plus the no-DCT bucket.
  const presentDcts = new Set(history.sites.map((s) => s.dct ?? NO_DCT));
  const dctOptions = data.meta.dcts.map((d) => d.name).filter((n) => presentDcts.has(n));
  if (presentDcts.has(NO_DCT)) dctOptions.push(NO_DCT);
  const agencyOptions = [...new Set(history.sites.map((s) => s.agency))].sort((a, b) =>
    a.localeCompare(b),
  );

  root.innerHTML = `
    <div class="section-heading-row">
      <h2 id="trend-heading" class="section-heading">Monthly trend</h2>
      <div class="section-controls">
        <nys-select id="trend-scope" label="Show" width="lg" value="all">
          <option value="all" label="All sites (statewide average)"></option>
          <option value="dct" label="One DCT portfolio (a line per agency)"></option>
          <option value="agency" label="One agency (a line per site)"></option>
        </nys-select>
        <div id="trend-pick-dct-wrap" hidden>
          <nys-select id="trend-pick-dct" label="DCT portfolio" width="lg" value="${esc(dctOptions[0] ?? '')}">
            ${dctOptions.map((d) => `<option value="${esc(d)}" label="${esc(d === NO_DCT ? d : dctLabel(d, data))}"></option>`).join('')}
          </nys-select>
        </div>
        <div id="trend-pick-agency-wrap" hidden>
          <nys-select id="trend-pick-agency" label="Agency" width="lg" value="${esc(agencyOptions[0] ?? '')}">
            ${agencyOptions.map((a) => `<option value="${esc(a)}" label="${esc(a)}"></option>`).join('')}
          </nys-select>
        </div>
      </div>
    </div>
    <p class="section-sub">
      Average <strong>automated</strong> score per monthly snapshot, with each
      <strong>manual Axe Auditor audit</strong> marked in the month it was recorded
      (diamonds; triangles for mobile-web audits of the same site).
      <span class="caveat-inline"><span aria-hidden="true">⚠</span> automated testing only</span>
    </p>
    <div id="trend-chart" class="trend-chart" role="img" aria-label="Loading trend chart"></div>
    <p id="trend-note" class="trend-note"></p>
    <p id="trend-live" class="visually-hidden" role="status" aria-live="polite"></p>
    <!-- Structured, screen-reader alternative to the chart image. -->
    <div id="trend-table-fallback" class="visually-hidden"></div>
  `;

  const el = root.querySelector<HTMLElement>('#trend-chart')!;
  const noteEl = root.querySelector<HTMLElement>('#trend-note')!;
  const liveEl = root.querySelector<HTMLElement>('#trend-live')!;
  const fallbackEl = root.querySelector<HTMLElement>('#trend-table-fallback')!;
  const dctWrap = root.querySelector<HTMLElement>('#trend-pick-dct-wrap')!;
  const agencyWrap = root.querySelector<HTMLElement>('#trend-pick-agency-wrap')!;

  if (months.length === 0) {
    el.textContent = 'No monthly snapshots yet. The trend appears after the first monthly refresh.';
    el.setAttribute('aria-label', 'Trend chart: no monthly snapshots yet.');
    return { setScope: () => {} };
  }

  const chart = echarts.init(el, undefined, { renderer: 'svg' });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const monthLabels = months.map((m, i) => {
    const si = snapshotAt[i];
    const backfill = si !== null && history.snapshots[si].source !== 'dashboard';
    return formatMonth(m) + (backfill ? '*' : '');
  });
  const backfilled = history.snapshots.some((s) => s.source !== 'dashboard');
  // Re-index each site's automated series onto the axis months.
  const sitesOnAxis: HistorySite[] = history.sites.map((s) => ({
    ...s,
    automated: snapshotAt.map((si) => (si === null ? null : (s.automated[si] ?? null))),
  }));

  let scope: Scope = 'all';
  let pickDct = dctOptions[0] ?? NO_DCT;
  let pickAgency = agencyOptions[0] ?? '';

  const draw = (announce = false) => {
    dctWrap.hidden = scope !== 'dct';
    agencyWrap.hidden = scope !== 'agency';

    const sites =
      scope === 'all'
        ? sitesOnAxis
        : scope === 'dct'
          ? sitesOnAxis.filter((s) => (s.dct ?? NO_DCT) === pickDct)
          : sitesOnAxis.filter((s) => s.agency === pickAgency);

    const lines: Line[] =
      scope === 'all'
        ? [averageLine('Automated score (all sites, monthly average)', sites, months.length)]
        : scope === 'dct'
          ? groupBy(sites, (s) => s.agency).map(([name, group]) =>
              averageLine(name, group, months.length),
            )
          : sites.map((s) => siteLine(s));
    lines.sort((a, b) => a.name.localeCompare(b.name));

    const audits: Audit[] = [];
    for (const s of sites) {
      for (const a of s.audits) {
        const i = months.indexOf(a.month);
        if (i !== -1) {
          audits.push({
            monthIndex: i,
            score: a.score,
            domain: s.domain,
            assetType: a.assetType ?? null,
            mobile: isMobileAudit(a.assetType),
          });
        }
      }
    }
    const desktopAudits = audits.filter((a) => !a.mobile);
    const mobileAudits = audits.filter((a) => a.mobile);

    const identified = lines.slice(0, MAX_IDENTIFIED);
    const rest = lines.slice(MAX_IDENTIFIED);
    const single = lines.length === 1;

    const lineSeries = lines.map((line, i) => {
      const isIdentified = i < MAX_IDENTIFIED;
      const color = single ? AUTOMATED_COLOR : isIdentified ? SERIES_PALETTE[i] : SERIES_OTHER;
      return {
        name: line.name,
        type: 'line' as const,
        data: line.values,
        color,
        symbol: single ? 'circle' : isIdentified ? LINE_SYMBOLS[i] : 'circle',
        symbolSize: isIdentified ? 9 : 6,
        lineStyle: { width: isIdentified ? 2 : 1.5 },
        emphasis: { focus: 'series' as const },
        // Months without a snapshot are gaps on the axis; bridge them so a
        // sparse series still reads as a line, and let the tooltip say which
        // months actually carry a snapshot.
        connectNulls: true,
        z: isIdentified ? 3 : 2,
      };
    });

    // Desktop audits are diamonds; mobile-web audits of the same site are
    // triangles in the same orange, so eight mobile runs on one site read as
    // a separate track rather than eight audits of the site.
    const auditSeries = {
      name: DESKTOP_SERIES,
      type: 'scatter' as const,
      data: desktopAudits.map((a) => ({ value: [a.monthIndex, a.score], name: a.domain })),
      color: AUDIT_COLOR,
      symbol: 'diamond',
      symbolSize: 16,
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      z: 4,
    };
    const mobileSeries = {
      name: MOBILE_SERIES,
      type: 'scatter' as const,
      data: mobileAudits.map((a) => ({ value: [a.monthIndex, a.score], name: a.domain })),
      color: AUDIT_COLOR,
      symbol: 'triangle',
      symbolSize: 14,
      itemStyle: { borderColor: '#fff', borderWidth: 2, opacity: 0.85 },
      z: 4,
    };

    const legendNames = [...identified.map((l) => l.name), auditSeries.name];
    if (mobileAudits.length) legendNames.push(mobileSeries.name);

    chart.setOption(
      {
        // The container carries its own summary aria-label and a data table;
        // ECharts' generated description would overwrite that label.
        aria: { enabled: false },
        animation: !reduceMotion,
        grid: { left: 8, right: 24, top: single ? 48 : 72, bottom: 8, containLabel: true },
        legend: { top: 8, left: 'center', data: legendNames, type: 'scroll' },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line' },
          formatter: (params: TooltipParam[]) => tooltipHtml(params, lines, audits, monthLabels),
        },
        xAxis: {
          type: 'category',
          data: monthLabels,
          boundaryGap: true,
          axisLabel: { color: '#62666a' },
          axisTick: { alignWithLabel: true },
        },
        yAxis: {
          type: 'value',
          name: 'Score',
          min: 0,
          max: 100,
          interval: 20,
          axisLabel: { color: '#62666a' },
          splitLine: { lineStyle: { color: '#e4e4e2' } },
        },
        series: mobileAudits.length ? [...lineSeries, auditSeries, mobileSeries] : [...lineSeries, auditSeries],
      },
      { notMerge: true },
    );

    const notes: string[] = [];
    if (rest.length) {
      notes.push(
        `${rest.length} more ${scope === 'agency' ? 'sites' : 'agencies'} are drawn in gray without a legend entry; hover a line or use the data table for names.`,
      );
    }
    if (backfilled) {
      notes.push(
        '* Backfilled from axe Monitor run history: automated scores only, and possibly fewer sites than a full snapshot.',
      );
    }
    noteEl.textContent = notes.join(' ');

    const scopeText =
      scope === 'all'
        ? 'all sites'
        : scope === 'dct'
          ? `the ${pickDct === NO_DCT ? NO_DCT : dctLabel(pickDct, data)} portfolio`
          : `${pickAgency}`;
    el.setAttribute(
      'aria-label',
      `Line chart: average automated accessibility score per month for ${scopeText}, ` +
        `${lines.length} line${lines.length === 1 ? '' : 's'} across ${months.length} month${months.length === 1 ? '' : 's'}, ` +
        `with ${audits.length} manual audit${audits.length === 1 ? '' : 's'} marked` +
        `${mobileAudits.length ? ` (${mobileAudits.length} of them mobile-web audits)` : ''}. ` +
        'The full series follows in the data table below.',
    );
    fallbackEl.innerHTML = fallbackTable(lines, audits, monthLabels);
    if (announce) {
      liveEl.textContent = `Trend updated: ${lines.length} line${lines.length === 1 ? '' : 's'} for ${scopeText}.`;
    }
  };

  draw();

  root.querySelector('#trend-scope')?.addEventListener('nys-change', (e: Event) => {
    const v = (e as CustomEvent<{ value: string }>).detail?.value;
    scope = v === 'dct' || v === 'agency' ? v : 'all';
    draw(true);
  });
  root.querySelector('#trend-pick-dct')?.addEventListener('nys-change', (e: Event) => {
    pickDct = (e as CustomEvent<{ value: string }>).detail?.value ?? pickDct;
    draw(true);
  });
  root.querySelector('#trend-pick-agency')?.addEventListener('nys-change', (e: Event) => {
    pickAgency = (e as CustomEvent<{ value: string }>).detail?.value ?? pickAgency;
    draw(true);
  });

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);

  // Keep an nys-select's displayed value in step when the scope is set in code.
  const syncSelect = (id: string, value: string) => {
    const sel = root.querySelector(id) as (HTMLElement & { value?: string }) | null;
    if (!sel) return;
    sel.setAttribute('value', value);
    sel.value = value;
  };

  return {
    setScope(next, key) {
      // Property sync only sticks once nys-select has upgraded.
      void customElements.whenDefined('nys-select').then(() => {
        syncSelect('#trend-scope', scope);
        if (scope === 'dct') syncSelect('#trend-pick-dct', pickDct);
        if (scope === 'agency') syncSelect('#trend-pick-agency', pickAgency);
      });
      if (next === 'dct' && key && dctOptions.includes(key)) {
        scope = 'dct';
        pickDct = key;
        syncSelect('#trend-pick-dct', key);
      } else if (next === 'agency' && key && agencyOptions.includes(key)) {
        scope = 'agency';
        pickAgency = key;
        syncSelect('#trend-pick-agency', key);
      } else {
        scope = 'all';
      }
      syncSelect('#trend-scope', scope);
      draw();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Series building                                                             */
/* -------------------------------------------------------------------------- */

/** Mean automated score per snapshot across `sites` (null when none scored). */
function averageLine(name: string, sites: HistorySite[], length: number): Line {
  const values: (number | null)[] = [];
  const counts: number[] = [];
  for (let i = 0; i < length; i++) {
    let sum = 0;
    let n = 0;
    for (const s of sites) {
      const v = s.automated[i];
      if (v !== null && v !== undefined) {
        sum += v;
        n += 1;
      }
    }
    values.push(n ? Math.round(sum / n) : null);
    counts.push(n);
  }
  return { name, values, counts };
}

function siteLine(site: HistorySite): Line {
  return {
    name: site.domain,
    values: site.automated.map((v) => v ?? null),
    counts: site.automated.map((v) => (v === null || v === undefined ? 0 : 1)),
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return [...map.entries()];
}

/* -------------------------------------------------------------------------- */
/* Tooltip + fallback table                                                    */
/* -------------------------------------------------------------------------- */

interface TooltipParam {
  seriesType: string;
  seriesName: string;
  seriesIndex: number;
  dataIndex: number;
  marker: string;
  value: number | null | [number, number];
  name: string;
  data: { name?: string } | number | null;
}

function tooltipHtml(
  params: TooltipParam[],
  lines: Line[],
  audits: Audit[],
  monthLabels: string[],
): string {
  if (!params.length) return '';
  const monthIndex = params[0].dataIndex;
  const rows: string[] = [`<strong>${esc(monthLabels[monthIndex] ?? '')}</strong>`];
  for (const p of params) {
    if (p.seriesType !== 'line') continue;
    const line = lines[p.seriesIndex];
    const v = line?.values[monthIndex];
    if (v === null || v === undefined) continue;
    const n = line.counts[monthIndex];
    const basis = n > 1 ? ` <span style="color:#62666a">(average of ${n} sites)</span>` : '';
    rows.push(`${p.marker} ${esc(p.seriesName)}: <strong>${v}%</strong>${basis}`);
  }
  // One audit per line (a month can hold many), highest score first so a
  // site's desktop and mobile runs sit together and stay readable.
  const monthAudits = audits
    .filter((a) => a.monthIndex === monthIndex)
    .sort((a, b) => a.domain.localeCompare(b.domain) || Number(a.mobile) - Number(b.mobile) || b.score - a.score);
  if (monthAudits.length) {
    rows.push(`<strong>Manual audit${monthAudits.length === 1 ? '' : 's'}</strong>`);
    for (const a of monthAudits) {
      rows.push(
        `<span style="color:${AUDIT_COLOR}">${a.mobile ? '▲' : '◆'}</span> ${esc(a.domain)}` +
          `${a.mobile ? ' <span style="color:#62666a">(mobile web)</span>' : ''}: <strong>${a.score}%</strong>`,
      );
    }
  }
  return rows.join('<br/>');
}

/** Visually-hidden data table mirroring the rendered lines and audits. */
function fallbackTable(lines: Line[], audits: Audit[], monthLabels: string[]): string {
  const thead =
    `<th scope="col">Series</th>` + monthLabels.map((m) => `<th scope="col">${esc(m)}</th>`).join('');
  const body = lines
    .map(
      (l) =>
        `<tr><th scope="row">${esc(l.name)}</th>` +
        l.values.map((v) => `<td>${v === null ? '—' : `${v}%`}</td>`).join('') +
        '</tr>',
    )
    .join('');
  const auditRows = audits.length
    ? `<h3>Manual audits</h3><ul>` +
      audits
        .map(
          (a) =>
            `<li>${esc(monthLabels[a.monthIndex] ?? '')}: ${esc(a.domain)}${a.mobile ? ' (mobile web)' : ''} — ${a.score}%</li>`,
        )
        .join('') +
      '</ul>'
    : '';
  return (
    `<table><caption>Automated score per monthly snapshot</caption>` +
    `<thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table>` +
    auditRows
  );
}
