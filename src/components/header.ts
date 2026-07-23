import type { DashboardData } from '../types';
import { formatRefreshed } from '../format';
import { openMethodology } from '../methodology';

/**
 * App header: the NYSDS agency header (nys-globalheader with the NYS brand mark
 * enabled, since we intentionally omit nys-unavheader), the PERSISTENT
 * 30%-automated-only banner (PRD §5.4), the last-refreshed date, and a
 * methodology entry point. The banner is a non-dismissible nys-alert so the
 * caveat can never be closed away.
 */
export function renderHeader(root: HTMLElement, data: DashboardData): void {
  const pct = data.meta.automatedCoveragePct;
  root.innerHTML = `
    <nys-globalheader
      appName="Statewide Accessibility Dashboard"
      agencyName="Office of Information Technology Services"
      homepageLink="."
      nysLogo
    >
      <div slot="user-actions" class="app-header__actions">
        <span class="app-header__refreshed">
          <span class="app-header__refreshed-label">Snapshot</span>
          <span class="app-header__refreshed-date">${formatRefreshed(data.meta.generatedAt)}</span>
        </span>
        <nys-button
          id="methodology-btn"
          variant="outline"
          size="sm"
          prefixIcon="info"
          label="How to read this & methodology"
        ></nys-button>
      </div>
    </nys-globalheader>

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
    .querySelector('#methodology-btn')
    ?.addEventListener('nys-click', openMethodology);
  root
    .querySelector<HTMLButtonElement>('#methodology-link')
    ?.addEventListener('click', openMethodology);
}
