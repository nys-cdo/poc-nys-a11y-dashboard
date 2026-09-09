import { NO_DCT, type DashboardData } from './types';
import type { SiteFilters, StatusFilter } from './components/siteTable';

/**
 * The page's shareable view state lives in the query string, so a DCT can
 * bookmark or forward a link that opens straight into their portfolio:
 *
 *   ?dct=Kathryn%20Shelton          one portfolio (case-insensitive match)
 *   ?dct=none                       the "No DCT assigned" bucket
 *   ?agency=DOL&status=red          the site-table filters
 *   ?full                           the advanced table (kept across changes)
 *
 * Filters read the URL on load and write it back (replaceState, no history
 * spam) whenever they change, so the address bar always reflects the view.
 */
export interface ViewState {
  filters: SiteFilters;
  full: boolean;
}

const STATUS_VALUES = new Set<StatusFilter>(['all', 'red', 'yellow', 'green', 'unknown', 'blocked']);

/** Case- and whitespace-insensitive key for matching names from a URL. */
function fold(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Resolve a `dct` query value to a DCT name known to the data, or `'all'`. */
export function resolveDct(value: string | null, data: DashboardData): string {
  if (!value) return 'all';
  const key = fold(value);
  if (key === 'none' || key === fold(NO_DCT)) return NO_DCT;
  const match = data.meta.dcts.find((d) => fold(d.name) === key);
  if (match) return match.name;
  // Also accept a surname alone ("shelton") when it is unambiguous.
  const bySurname = data.meta.dcts.filter((d) => fold(d.name).split(/[\s&]+/).includes(key));
  if (bySurname.length === 1) return bySurname[0].name;
  console.warn(`[url] Unknown DCT "${value}" — showing all portfolios.`);
  return 'all';
}

function resolveAgency(value: string | null, data: DashboardData): string {
  if (!value) return 'all';
  const key = fold(value);
  const match = data.sites.find((s) => fold(s.agency) === key);
  if (!match) console.warn(`[url] Unknown agency "${value}" — showing all agencies.`);
  return match?.agency ?? 'all';
}

export function readViewState(data: DashboardData, search = location.search): ViewState {
  const params = new URLSearchParams(search);
  const status = (params.get('status') ?? 'all') as StatusFilter;
  return {
    full: params.has('full'),
    filters: {
      dct: resolveDct(params.get('dct'), data),
      agency: resolveAgency(params.get('agency'), data),
      status: STATUS_VALUES.has(status) ? status : 'all',
    },
  };
}

/** The query string for a view (relative, so it works under the Pages subpath). */
export function viewQuery(state: ViewState): string {
  const params = new URLSearchParams();
  if (state.full) params.set('full', '');
  const { dct, agency, status } = state.filters;
  if (dct !== 'all') params.set('dct', dct === NO_DCT ? 'none' : dct);
  if (agency !== 'all') params.set('agency', agency);
  if (status !== 'all') params.set('status', status);
  // `full=` reads better as a bare flag.
  const q = params.toString().replace(/(^|&)full=(?=&|$)/, '$1full');
  return q ? `?${q}` : '';
}

/** Write the view into the address bar without adding a history entry. */
export function writeViewState(state: ViewState): void {
  const next = `${location.pathname}${viewQuery(state)}${location.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (next !== current) history.replaceState(history.state, '', next);
}

/** A shareable link to one portfolio's view (drops other filters). */
export function portfolioLink(dct: string, full = false): string {
  return `./${viewQuery({ full, filters: { dct, agency: 'all', status: 'all' } })}`;
}
