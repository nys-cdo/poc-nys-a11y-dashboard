import type { DashboardData } from '../types';
import { formatRefreshed } from '../format';
import { openMethodology } from '../methodology';

/**
 * App header: title, the PERSISTENT 30%-automated-only banner (PRD §5.4),
 * last-refreshed date, and a methodology entry point. The banner is a
 * non-dismissible nys-alert so the caveat can never be closed away.
 */
export function renderHeader(root: HTMLElement, data: DashboardData): void {
  const pct = data.meta.automatedCoveragePct;
  root.innerHTML = `
    <div class="app-header__bar">
      <div class="app-header__titles">
        <p class="app-header__eyebrow">New York State · Office of Information Technology Services</p>
        <h1 class="app-header__title">Statewide Accessibility Dashboard</h1>
      </div>
      <div class="app-header__meta">
        <p class="app-header__refreshed">
          <span class="app-header__refreshed-label">Snapshot last refreshed</span>
          <span class="app-header__refreshed-date">${formatRefreshed(data.meta.generatedAt)}</span>
        </p>
        <button type="button" id="methodology-btn" class="app-header__method-btn">
          <span aria-hidden="true">ⓘ</span> How to read this &amp; methodology
        </button>
      </div>
    </div>

    <nys-alert
      class="app-header__banner"
      type="warning"
      heading="These scores reflect automated testing only"
    >
      <span class="app-header__banner-body">Automated tools catch roughly <strong>${pct}%</strong>
        of accessibility issues — the rest require manual review. A green score means
        <strong>“no automated blockers detected,”</strong> never “accessible.”
        <button type="button" id="methodology-link" class="app-header__banner-link">Read the methodology</button></span>
    </nys-alert>
  `;

  root
    .querySelector<HTMLButtonElement>('#methodology-btn')
    ?.addEventListener('click', openMethodology);
  root
    .querySelector<HTMLButtonElement>('#methodology-link')
    ?.addEventListener('click', openMethodology);
}
