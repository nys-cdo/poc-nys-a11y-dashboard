// NYSDS design tokens, reset, typography, and utility classes.
import '@nysds/styles/full';
// NYSDS web components (registers nys-alert, nys-table, nys-badge, nys-select, …).
import '@nysds/components';
// NYS official fonts (Proxima Nova, D Sari).
import '../assets/fonts/nysds-fonts.css';
// App styles (tokens-only, no ad-hoc values).
import './app.css';

import { requireGate } from './gate';
import { loadDashboardData } from './data';
import { renderHeader } from './components/header';
import { renderSummary } from './components/summary';
import { renderAgencyRollup } from './components/agencyRollup';
import { renderSiteTable } from './components/siteTable';

async function boot(): Promise<void> {
  const header = document.getElementById('app-header')!;
  const summary = document.getElementById('statewide-summary')!;
  const rollup = document.getElementById('agency-rollup')!;
  const table = document.getElementById('site-table')!;
  const footer = document.getElementById('app-footer')!;

  // Default view is the succinct dashboard; `?full` opens the advanced view
  // (every signal column + blocked/conflict filters). One flag drives the
  // site table's mode and whether the agency rollup hides single-scan agencies.
  const full = new URLSearchParams(location.search).has('full');

  try {
    const data = await loadDashboardData();

    renderHeader(header, data);
    renderSummary(summary, data);
    const siteTable = renderSiteTable(table, data, { mode: full ? 'full' : 'succinct' });
    renderAgencyRollup(
      rollup,
      data,
      (agency, status) => {
        // Clicking an agency's colored segment filters and reveals the site table.
        siteTable.applyFilters(agency, status);
        const heading = document.getElementById('site-table-heading');
        table.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Move focus to the section heading for screen-reader + keyboard context.
        heading?.setAttribute('tabindex', '-1');
        heading?.focus({ preventScroll: true });
      },
      { hideSingleScan: !full },
    );

    // Unobtrusive view toggle, placed just above the site-table heading.
    // Succinct → "View full data →" (?full); full → "← Back to summary" (strip query).
    const toggle = document.createElement('p');
    toggle.className = 'view-toggle';
    toggle.innerHTML = full
      ? '<a class="view-toggle__link" href=".">&larr; Back to summary</a>'
      : '<a class="view-toggle__link" href="?full">View full data &rarr;</a>';
    table.insertAdjacentElement('afterbegin', toggle);

    // NYSDS footers: agency (nys-globalfooter) above the universal NYS footer.
    footer.innerHTML = `
      <nys-globalfooter
        agencyName="Office of Information Technology Services"
        agencySubheading="Statewide Accessibility Dashboard"
        homepageLink="https://its.ny.gov/"
      >
        <p>
          Internal working tool · Phase 1 snapshot · Sources:
          ${data.meta.sources.map((s) => `<strong>${s}</strong>`).join(', ')}.
          Automated testing detects ~${data.meta.automatedCoveragePct}% of accessibility issues.
        </p>
      </nys-globalfooter>
      <nys-unavfooter></nys-unavfooter>
    `;
  } catch (err) {
    header.innerHTML = `
      <div class="app-header__bar">
        <h1 class="app-header__title">Statewide Accessibility Dashboard</h1>
      </div>`;
    summary.innerHTML = `
      <nys-alert type="danger" heading="Could not load dashboard data">
        ${(err as Error).message}
      </nys-alert>`;
    console.error(err);
  }
}

// Gate the page behind the shared password before doing anything else.
void requireGate().then(boot);
