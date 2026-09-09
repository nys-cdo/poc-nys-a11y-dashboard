import { NO_DCT, type DashboardData, type Impact, type Site } from '../types';
import {
  highIssues,
  isMobileAudit,
  issuesPerPage,
  officialScore,
  officialStatus,
  scoreSourceLabel,
  siteCoverage,
} from '../status';
import { esc, formatCount, formatScore, impactLabel, safeHref, statusIntent, statusShort } from '../format';
import { openRequestTest } from './requestTest';

/**
 * Per-site issue profile: a native <dialog> opened from the site table's
 * Issues cell. Answers "how much work is this site?" — open issues by
 * severity, issues per page tested, the most frequent failing rules with a
 * link to each rule's fix guidance, and the manual audit history — and ends
 * with the request-a-test call to action for that site.
 */
let dialog: HTMLDialogElement | null = null;

const IMPACTS: Impact[] = ['critical', 'serious', 'moderate', 'minor'];

function severityBars(site: Site): string {
  const c = site.axeMonitorIssues;
  if (!c) return '';
  const max = Math.max(1, ...IMPACTS.map((k) => c[k]));
  return `
    <ul class="severity" aria-label="Open issues by severity">
      ${IMPACTS.map(
        (k) => `
        <li class="severity__row severity__row--${k}">
          <span class="severity__label">${impactLabel(k)}</span>
          <span class="severity__bar" aria-hidden="true"><span style="width:${Math.round((c[k] / max) * 100)}%"></span></span>
          <span class="severity__count">${formatCount(c[k])}</span>
        </li>`,
      ).join('')}
    </ul>`;
}

function rulesTable(site: Site): string {
  const rules = site.axeMonitorTopRules ?? [];
  if (!rules.length) return '<p class="muted">No rule breakdown is available for this site.</p>';
  const examined = site.axeMonitorIssuesExamined;
  const total = site.axeMonitorIssues?.total ?? 0;
  const sampled = examined !== null && examined < total;
  return `
    <div class="table-scroll">
    <table class="rules-table">
      <caption class="visually-hidden">Most frequent failing rules for ${esc(site.domain)}</caption>
      <thead>
        <tr>
          <th scope="col">Rule</th>
          <th scope="col">Severity</th>
          <th scope="col" class="num">Open issues</th>
          <th scope="col">Type</th>
        </tr>
      </thead>
      <tbody>
        ${rules
          .slice(0, 5)
          .map(
            (r) => `
          <tr>
            <td>
              ${
                r.helpUrl
                  ? `<a href="${esc(r.helpUrl)}" target="_blank" rel="noopener">${esc(r.ruleId)}</a>`
                  : esc(r.ruleId)
              }
              ${r.description ? `<span class="rules-table__desc">${esc(r.description)}</span>` : ''}
            </td>
            <td><span class="impact impact--${r.impact}">${impactLabel(r.impact)}</span></td>
            <td class="num">${formatCount(r.count)}</td>
            <td>${r.bestPractice ? '<span class="muted">Best practice</span>' : 'WCAG'}</td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    </div>
    ${
      sampled
        ? `<p class="muted rules-table__note">Rule counts come from the first ${formatCount(examined)} of ${formatCount(total)} open issues; the severity totals above cover the whole run.</p>`
        : ''
    }`;
}

function auditHistory(site: Site): string {
  if (!site.auditorRuns.length) {
    return site.auditorScore !== null
      ? `<p>Auditor score <strong>${formatScore(site.auditorScore)}</strong>${site.auditorDate ? ` (${esc(site.auditorDate)})` : ''}.</p>`
      : '<p class="muted">No manual audit yet.</p>';
  }
  return `
    <ul class="audit-list">
      ${[...site.auditorRuns]
        .reverse()
        .map(
          (r) => `
        <li>
          <span class="audit-list__date">${esc(r.date)}</span>
          <a href="${esc(r.reportUrl)}" target="_blank" rel="noopener">${esc(r.testCase)}</a>
          ${isMobileAudit(r.assetType) ? '<span class="audit-list__asset">mobile web</span>' : ''}
          <strong>${formatScore(r.score)}</strong>
        </li>`,
        )
        .join('')}
    </ul>`;
}

function render(site: Site, data: DashboardData): string {
  const { rubric } = data.meta;
  const { value, source } = officialScore(site);
  const status = officialStatus(site, rubric);
  const cov = siteCoverage(site);
  const c = site.axeMonitorIssues;
  const high = highIssues(c);
  const perPage = issuesPerPage(site);
  return `
    <div class="methodology-dialog__inner">
      <div class="methodology-dialog__header">
        <div>
          <h2 id="site-detail-title">${esc(site.domain)}</h2>
          <p class="site-detail__meta">
            ${esc(site.agency)} · ${esc(site.dct ?? NO_DCT)}
          </p>
        </div>
        <button type="button" class="methodology-dialog__close" aria-label="Close">✕</button>
      </div>
      <div class="methodology-dialog__body">
        <div class="site-detail__kpis">
          <div class="kpi kpi--${status === 'unknown' ? 'neutral' : status}">
            <p class="kpi__label">Official score</p>
            <p class="kpi__value">${value === null ? '—' : formatScore(value)}</p>
            <p class="kpi__sub">
              <nys-badge size="sm" strong intent="${statusIntent(status)}" label="${statusShort(status)}" prefixIcon></nys-badge>
              <span class="kpi__sub-lead">${esc(scoreSourceLabel(source))}</span>
            </p>
          </div>
          <div class="kpi kpi--neutral">
            <p class="kpi__label">Open issues</p>
            <p class="kpi__value">${c ? formatCount(c.total) : '—'}</p>
            <p class="kpi__sub">${
              high === null
                ? 'no axe Monitor run'
                : `<span class="kpi__sub-lead">${formatCount(high)} critical or serious</span>fix these first`
            }</p>
          </div>
          <div class="kpi kpi--neutral">
            <p class="kpi__label">Coverage</p>
            <p class="kpi__value">${cov ? formatCount(cov.pages) : '—'}</p>
            <p class="kpi__sub">${
              cov
                ? `<span class="kpi__sub-lead">pages ${cov.kind === 'tested' ? 'tested by axe Monitor' : 'indexed by SiteImprove'}</span>${
                    perPage !== null ? `${perPage} open issues per page` : ''
                  }`
                : 'not scanned'
            }</p>
          </div>
        </div>

        <h3>Most frequent failing rules</h3>
        ${rulesTable(site)}

        <h3>Severity</h3>
        ${c ? severityBars(site) : '<p class="muted">No axe Monitor run for this site.</p>'}

        <h3>Manual audits</h3>
        ${auditHistory(site)}

        <p class="request-dialog__actions">
          <button type="button" id="site-detail-request" class="request-dialog__button">
            Request an accessibility test for this site
          </button>
          <a class="site-detail__visit" href="${esc(safeHref(site.url))}" target="_blank" rel="noopener">Open ${esc(site.domain)}</a>
        </p>
      </div>
    </div>
  `;
}

export function openSiteDetail(site: Site, data: DashboardData): void {
  const root = document.getElementById('methodology-root');
  if (!root) return;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'methodology-dialog site-detail';
    dialog.setAttribute('aria-labelledby', 'site-detail-title');
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog!.close();
    });
    root.appendChild(dialog);
  }
  dialog.innerHTML = render(site, data);
  dialog.querySelector('.methodology-dialog__close')?.addEventListener('click', () => dialog!.close());
  dialog.querySelector('#site-detail-request')?.addEventListener('click', () =>
    openRequestTest({ domain: site.domain, agency: site.agency, dct: site.dct ?? undefined }),
  );
  dialog.showModal();
}
