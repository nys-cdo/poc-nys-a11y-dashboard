import { NO_DCT, type DashboardData } from '../types';
import { portfolioSummary, type MonthOverMonth } from '../status';
import { esc, formatCount, formatDelta, formatMonth, impactLabel } from '../format';
import { portfolioLink } from '../urlState';
import { openRequestTest } from './requestTest';

/**
 * Portfolio summary strip — the DCT's own KPI row, shown when one portfolio is
 * selected (the `?dct=` deep link or the table's DCT filter). Frames the three
 * planning questions: risk (status mix, critical + serious issues), work (open
 * issues, most frequent rules, pages), and momentum (month-over-month). Hidden
 * when no portfolio is selected; the statewide row above stays as the peer
 * context.
 */
export function renderPortfolio(root: HTMLElement, data: DashboardData, dct: string | null): void {
  if (!dct) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }
  const p = portfolioSummary(data, dct);
  const heading = dct === NO_DCT ? NO_DCT : `${dct}'s portfolio`;
  const agencies = dct === NO_DCT ? 'Agencies outside every DCT portfolio' : p.agencies.join(', ');

  root.hidden = false;
  root.innerHTML = `
    <div class="section-heading-row">
      <div>
        <h2 id="portfolio-heading" class="section-heading">${esc(heading)}</h2>
        <p class="section-sub portfolio__agencies">${esc(agencies)}</p>
      </div>
      <div class="portfolio__actions">
        <a class="portfolio__link" href="${esc(portfolioLink(dct))}">Link to this portfolio</a>
        <nys-button id="portfolio-request" size="sm" label="Request an accessibility test"></nys-button>
      </div>
    </div>

    <div class="summary__grid portfolio__grid">
      ${kpi('Sites', formatCount(p.total), 'neutral', `${p.audited} with a manual audit`)}
      ${kpi('Red', formatCount(p.counts.red), 'red', `${p.percentages.red}% of the portfolio`)}
      ${kpi('Yellow', formatCount(p.counts.yellow), 'yellow', `${p.percentages.yellow}% of the portfolio`)}
      ${kpi('Green', formatCount(p.counts.green), 'green', `${p.percentages.green}% of the portfolio${p.counts.unknown ? ` · ${p.counts.unknown} not scored` : ''}`)}
      ${kpi(
        'Open issues',
        p.issues ? formatCount(p.issues.total) : '—',
        'neutral',
        p.issues
          ? `<span class="kpi__sub-lead">${formatCount(p.issues.high)} critical or serious</span>across ${p.issues.sitesCounted} scanned site${p.issues.sitesCounted === 1 ? '' : 's'}`
          : 'no axe Monitor scans in this portfolio',
      )}
      ${kpi(
        'Pages tested',
        formatCount(p.pagesTested),
        'neutral',
        `by axe Monitor${p.pagesIndexed ? ` · ${formatCount(p.pagesIndexed)} indexed by SiteImprove` : ''}`,
      )}
      ${momKpi('Score, month over month', p.momScore, ' pts', 'mean automated score')}
      ${momKpi('Issues, month over month', p.momIssues, '', 'mean open issues per site')}
    </div>

    ${
      p.topRules.length
        ? `
    <div class="portfolio__rules">
      <h3 class="summary__chart-title">Most frequent failing rules in this portfolio</h3>
      <ol class="portfolio__rule-list">
        ${p.topRules
          .map(
            (r) => `
          <li>
            <span class="impact impact--${r.impact}">${impactLabel(r.impact)}</span>
            ${r.helpUrl ? `<a href="${esc(r.helpUrl)}" target="_blank" rel="noopener">${esc(r.ruleId)}</a>` : esc(r.ruleId)}
            <span class="muted">— ${formatCount(r.count)} open issue${r.count === 1 ? '' : 's'} on ${r.sites} site${r.sites === 1 ? '' : 's'}${r.bestPractice ? ' · best practice' : ''}</span>
          </li>`,
          )
          .join('')}
      </ol>
      <p class="muted portfolio__rules-note">Ranked from each site's ten most frequent rules; open a site's issue profile in the table for its full breakdown.</p>
    </div>`
        : ''
    }
  `;

  root
    .querySelector('#portfolio-request')
    ?.addEventListener('nys-click', () => openRequestTest({ dct: dct === NO_DCT ? undefined : dct }));
}

function kpi(label: string, value: string, tone: 'red' | 'yellow' | 'green' | 'neutral', sub: string): string {
  return `
    <div class="kpi kpi--${tone}">
      <p class="kpi__label">${label}</p>
      <p class="kpi__value">${value}</p>
      <p class="kpi__sub">${sub}</p>
    </div>`;
}

function momKpi(label: string, mom: MonthOverMonth | null, unit: string, basis: string): string {
  if (!mom) return kpi(label, '—', 'neutral', 'needs two monthly snapshots');
  const tone = mom.delta === 0 ? 'neutral' : (mom.delta > 0) === (unit === ' pts') ? 'green' : 'red';
  return kpi(
    label,
    formatDelta(mom.delta, unit),
    tone,
    `<span class="kpi__sub-lead">${formatMonth(mom.prevMonth)} ${mom.prev} → ${formatMonth(mom.month)} ${mom.now}</span>${basis}, ${mom.sitesNow} site${mom.sitesNow === 1 ? '' : 's'}`,
  );
}
