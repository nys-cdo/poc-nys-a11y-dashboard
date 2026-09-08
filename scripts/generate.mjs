#!/usr/bin/env node
/**
 * NYS Statewide Accessibility Dashboard — build-time data generator.
 * =================================================================
 *
 * This is the ONLY part of the project that touches API secrets. It reads the
 * axe Monitor + SiteImprove credentials from `.env`, pulls their scan data,
 * merges in the hand-maintained manual layer (`data/manual-data.json`), and
 * writes a secret-free `public/dashboard-data.json` that the static GitHub
 * Pages site ships. See PRD §4 (data sources) and §9 (build-time architecture).
 *
 *   [axe Monitor API]  [SiteImprove API]
 *           \                /
 *         (this script, reads .env keys)
 *           \                /
 *        normalize agency (axe Monitor taxonomy)   ── PRD §4.1
 *        detect URL conflicts → flag               ── PRD §4.1
 *           \
 *        merge manual-data.json                     ── PRD §4.2
 *           \
 *        write public/dashboard-data.json  ──►  committed / published
 *
 * Design rules baked into this file:
 *   - Zero runtime npm dependencies. Node 20+ built-ins only + global `fetch`.
 *   - API keys NEVER appear in the output JSON. Only derived, non-secret data.
 *   - The `fetch*` + `normalize*` functions are deliberately isolated so a
 *     teammate can drop in the real API response shapes in ~5 minutes once we
 *     have sample payloads — look for the `TODO(live-data)` markers.
 *
 * Run with:  npm run generate   (i.e. `node scripts/generate.mjs`)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// --- Paths --------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_PATH = join(ROOT, '.env');
const MANUAL_DATA_PATH = join(ROOT, 'data', 'manual-data.json');
const EXCLUDE_LIST_PATH = join(ROOT, 'data', 'exclude_list.json');
const AGENCY_OVERRIDES_PATH = join(ROOT, 'data', 'agency-overrides.json');
const DCTS_PATH = join(ROOT, 'data', 'dcts.json');
const DCT_ALIASES_PATH = join(ROOT, 'data', 'dct-aliases.json');
const DCT_ADDITIONS_PATH = join(ROOT, 'data', 'dct-portfolio-additions.json');
const HISTORY_DIR = join(ROOT, 'data', 'history');
const OUTPUT_DIR = join(ROOT, 'public');
const OUTPUT_PATH = join(OUTPUT_DIR, 'dashboard-data.json');
const CACHE_DIR = join(ROOT, 'scripts', '.cache');

/** Public ITS page listing every Deputy Commissioner for Technology (DCT) and
 *  the agencies in their portfolio. Scraped on each run; see fetchDcts(). */
const DCT_URL = 'https://its.ny.gov/dcts';

// ------------------------------------------------------------------------
// Local response cache (so re-runs don't hammer the rate-limited APIs).
// ------------------------------------------------------------------------
//
// Every successful GET is cached to scripts/.cache/<hash>.json keyed by URL +
// pagination headers (NEVER by auth headers, which are also never stored).
// This makes a pull RESUMABLE: after a 429 storm, a re-run reuses everything
// that already succeeded and only fetches the gaps.
//
// Flags (via `npm run generate -- <flag>`):
//   --refresh / --no-cache : ignore cached entries; fetch fresh (and re-cache).
//   --offline              : use ONLY the cache; never hit the network.
// TTL: entries older than CACHE_TTL_HOURS (default 24) are treated as misses.
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 3600 * 1000;
const CLI = new Set(process.argv.slice(2));
const CACHE_REFRESH = CLI.has('--refresh') || CLI.has('--no-cache');
const CACHE_OFFLINE = CLI.has('--offline');
const CACHE_STATS = { hits: 0, misses: 0, writes: 0 };

/** Cache key: URL + pagination headers only (auth headers deliberately excluded). */
function cacheKey(url, init) {
  const h = init?.headers ?? {};
  const pagination = [h['X-Pagination-Page'], h['X-Pagination-Per-Page']]
    .filter((v) => v !== undefined)
    .join(':');
  return createHash('sha1').update(`${String(url)}||${pagination}`).digest('hex');
}

/** Return a cached body if present and fresh (unless --refresh). */
function cacheGet(key) {
  if (CACHE_REFRESH) return null;
  const file = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(file)) return null;
  try {
    const { savedAt, body } = JSON.parse(readFileSync(file, 'utf8'));
    if (!CACHE_OFFLINE && Date.now() - savedAt > CACHE_TTL_MS) return null; // stale
    CACHE_STATS.hits += 1;
    return body;
  } catch {
    return null;
  }
}

/** Persist a successful response body (no secrets — just the JSON payload + url). */
function cacheSet(key, url, body) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const meta = { savedAt: Date.now(), url: String(url), body };
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(meta));
    CACHE_STATS.writes += 1;
  } catch (err) {
    console.warn(`[cache] could not write ${key}: ${err.message}`);
  }
}

/**
 * The literal bucket for sites with no resolvable agency (PRD §4.1).
 * Mirrors the `UNATTRIBUTED` constant in `src/types.ts` — kept as a plain
 * string here to avoid importing a `.ts` file into this runtime script.
 */
const UNATTRIBUTED = 'Unattributed';

// ------------------------------------------------------------------------
// 1. Environment loading (PRD §9 — keys live only in .env, only at build time)
// ------------------------------------------------------------------------

/**
 * Tiny hand-rolled `.env` parser — deliberately dependency-free (no dotenv).
 *
 * Node 20+ also supports `node --env-file=.env`, but `npm run generate` calls
 * `node scripts/generate.mjs` with no flag, so we load `.env` ourselves here.
 * Values already present in `process.env` win (so CI secrets / shell exports
 * override the file, matching standard dotenv behavior).
 *
 * Supports: `KEY=value`, `#` comments, blank lines, optional surrounding
 * quotes, and inline `export KEY=value`.
 */
function loadEnv() {
  const env = { ...process.env };

  if (!existsSync(ENV_PATH)) {
    console.warn(
      '[env] No .env file found at project root. Continuing with process.env only.\n' +
        '      (Copy .env.example → .env and fill in credentials for live data.)'
    );
    return env;
  }

  const raw = readFileSync(ENV_PATH, 'utf8');
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice(7) : line;
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;

    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();

    // Strip a single layer of matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Shell export / real secret wins over the file value.
    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
    }
  }

  return env;
}

// ------------------------------------------------------------------------
// 2. Source: axe Monitor (Deque)  — PRD §4.1
//    Authoritative for agency grouping/normalization.
//
//    API: axe Monitor Public API v1 (read-only).
//    Base : https://<yourcompany>.dequecloud.com/monitor-public-api/v1
//    Auth : header  X-API-Key: <key>
//    Traversal for a site's composite score + agency + domain:
//      GET /scans                               → scans[]{ id, name, groups[]{id,name} }
//      GET /scans/{scanId}/runs                 → scanRuns[]{ runNumber, status, score, completedAt }
//      GET /scans/{scanId}/runs/{run}/pages     → pages[]{ url, domainUrl }
//    - "agency" = a scan's Scan Group name (groups[]).  Canonical taxonomy.
//    - score    = latest COMPLETED run's `score`.
//    - domain   = a page's `domainUrl` (the scanned site's host).
//    Pagination is via request headers X-Pagination-Page / X-Pagination-Per-Page;
//    there is no total-count field, so we page until a short page is returned.
// ------------------------------------------------------------------------

const AXE_PER_PAGE = 100;

/**
 * axe Scan Group names that are functional/categorization tags, NOT agencies
 * (they describe HOW a site was crawled). A scan may carry one of these ALONGSIDE
 * a real agency group, in which case the agency wins; a scan whose ONLY group is
 * one of these has no agency grouping → Unattributed.
 */
const NON_AGENCY_GROUPS = new Set([
  '👐 Non-auth Domains',
  '🤖 Scripted',
  '🔐 Auth-CUSTOM',
]);

function isNonAgencyGroup(name) {
  // Known non-agency tags, plus the general shape (emoji/symbol-prefixed rather
  // than an alphanumeric agency name like "ITS"). Refine the explicit set as the
  // team confirms which Scan Groups are agencies.
  return NON_AGENCY_GROUPS.has(name.trim()) || !/^[A-Za-z0-9]/.test(name.trim());
}

/**
 * Pick the owning agency for a scan from its Scan Groups.
 * A scan can belong to multiple groups; non-agency tags (see above) are set
 * aside. If a real agency group remains we use it (preferring the first);
 * otherwise the scan has no agency grouping → Unattributed.
 */
function agencyFromScan(scan) {
  const groups = Array.isArray(scan?.groups) ? scan.groups : [];
  const named = groups.map((g) => g?.name).filter(Boolean);
  const agencies = named.filter((n) => !isNonAgencyGroup(n));
  // Only functional tags (or no groups at all) → no resolvable agency.
  return agencies[0] ?? UNATTRIBUTED;
}

/** Pick the most recent COMPLETED run (fallback: most recent run of any status). */
function pickLatestRun(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const completed = runs.filter((r) => String(r.status).toLowerCase() === 'completed');
  const pool = completed.length ? completed : runs;
  // Prefer latest completedAt; fall back to highest runNumber.
  return [...pool].sort((a, b) => {
    const ta = Date.parse(a.completedAt ?? '') || 0;
    const tb = Date.parse(b.completedAt ?? '') || 0;
    if (tb !== ta) return tb - ta;
    return (b.runNumber ?? 0) - (a.runNumber ?? 0);
  })[0];
}

/**
 * Fetch + normalize all axe Monitor records.
 * Returns a normalized `{ domain, url, agency, score }[]` (one per scanned domain).
 * Returns `[]` (with a clear warning) if credentials are missing.
 */
async function fetchAxeMonitor(env) {
  const apiKey = env.AXE_MONITOR_API_KEY;
  // Accept either name for the base (full base incl. /monitor-public-api/v1).
  const apiBase = env.AXE_MONITOR_API_BASE || env.AXE_MONITOR_API_URL;

  if (!apiKey || !apiBase) {
    console.warn(
      '[axe Monitor] AXE_MONITOR_API_KEY and/or AXE_MONITOR_API_BASE not set — ' +
        'skipping this source and returning [].'
    );
    return [];
  }

  const headers = { 'X-API-Key': apiKey, Accept: 'application/json' };

  // 1) List every accessible scan (header-paginated). scans[]{id,name,groups[]}.
  const scans = await axePaginate(joinUrl(apiBase, '/scans'), headers, (b) => b.scans ?? []);
  console.log(`[axe Monitor] ${scans.length} scans found; fetching latest run per scan…`);

  let multiGroup = 0;

  // 2+3) For each scan, resolve latest-run score + domain. Bounded concurrency
  //      keeps build time reasonable without hammering the API.
  const records = await mapLimit(scans, 3, async (scan) => {
    const scanId = scan.id;
    if (Array.isArray(scan.groups) && scan.groups.length > 1) multiGroup += 1;
    const agency = agencyFromScan(scan);

    // Runs — one page of up to AXE_PER_PAGE is plenty to find the latest run.
    let latest = null;
    let runsBody = null;
    try {
      runsBody = await fetchJson(joinUrl(apiBase, `/scans/${scanId}/runs`), {
        headers: { ...headers, 'X-Pagination-Per-Page': String(AXE_PER_PAGE) },
      });
      latest = pickLatestRun(runsBody.scanRuns ?? []);
    } catch (err) {
      console.warn(`[axe Monitor] scan ${scanId}: could not read runs — ${err.message}`);
    }
    if (!latest) return null;

    const score = normalizeAxeScore(latest.score);
    // Pages actually crawled + scored in this run (`pages.completed`). Some runs
    // (errored/in-progress) omit the object entirely → null.
    const pagesTested = Number.isFinite(latest.pages?.completed)
      ? latest.pages.completed
      : null;
    // Every COMPLETED run with a date, for backfilling months that have no
    // dashboard snapshot of their own (see backfillHistoryFromAxeRuns).
    const runHistory = (runsBody?.scanRuns ?? [])
      .filter((r) => String(r.status).toLowerCase() === 'completed' && r.completedAt)
      .map((r) => ({ completedAt: r.completedAt, score: normalizeAxeScore(r.score) }))
      .filter((r) => r.score !== null);

    // Domain — read a single page from the chosen run to get its host.
    let domainUrl = '';
    let pageUrl = '';
    try {
      const pagesBody = await fetchJson(
        joinUrl(apiBase, `/scans/${scanId}/runs/${latest.runNumber}/pages`),
        { headers: { ...headers, 'X-Pagination-Per-Page': '1' } }
      );
      const page0 = (pagesBody.pages ?? [])[0];
      if (page0) {
        domainUrl = page0.domainUrl ?? '';
        pageUrl = page0.url ?? '';
      }
    } catch (err) {
      console.warn(`[axe Monitor] scan ${scanId}: could not read pages — ${err.message}`);
    }

    // Fall back to the scan name only if the API gave us no page URL at all.
    const domain = domainFromUrl(domainUrl || pageUrl || scan.name || '');
    if (!domain) return null;
    return {
      domain,
      url: httpUrl(pageUrl || domainUrl, domain),
      agency,
      score,
      pagesTested,
      runHistory,
    };
  });

  if (multiGroup > 0) {
    console.warn(
      `[axe Monitor] ${multiGroup} scan(s) belong to multiple Scan Groups; used the ` +
        `first non-tag agency group (functional tags like “👐 Non-auth Domains” are ` +
        `ignored, and a scan with only tags is Unattributed). Review if attribution looks off.`
    );
  }

  return records.filter(Boolean);
}

// ------------------------------------------------------------------------
// 3. Source: SiteImprove  — PRD §4.1
//    Second source of coverage. Agency is derived from axe Monitor, not this.
//
//    API: Siteimprove API v2.
//    Base : https://api.eu.siteimprove.com/v2   (EU cluster; US tenants differ)
//    Auth : HTTP Basic — username = account email, password = API key.
//    Reads:
//      GET /sites?page_size=1000    → items[]{ id, url, product[] }, total_pages
//      GET /sites/{id}/dci/overview → { a11y:{total}, accessibility:{total}, … }
//    Score = the accessibility DCI (0–100 index shown in the SiteImprove UI):
//      - a11y.total          when the site has the next-gen module (a11_y_next_gen)
//      - accessibility.total when the site has the legacy module   (accessibility)
// ------------------------------------------------------------------------

const SI_PAGE_SIZE = 1000;

/**
 * Extract the accessibility DCI score from a /dci/overview body for a site.
 *
 * Confirmed against live data (2026-07): the meaningful accessibility index is
 * `a11y.total` (next-gen module, 0–100). The legacy `accessibility.total` is
 * present but 0 on this account, so we do NOT trust the site's `product` flags
 * — we prefer whichever field carries a real (> 0) score. A 0/absent value is
 * treated as "not measured" (null) rather than a real 0, so unscored sites show
 * as "—" instead of a misleading red.
 */
function siteImproveA11yScore(dciBody /*, products */) {
  const nextGen = dciBody?.a11y?.total;
  const legacy = dciBody?.accessibility?.total;
  if (typeof nextGen === 'number' && nextGen > 0) return nextGen;
  if (typeof legacy === 'number' && legacy > 0) return legacy;
  return null;
}

/**
 * Fetch + normalize all SiteImprove records.
 * Returns a normalized `{ domain, url, score }[]`.
 * Returns `[]` (with a clear warning) if credentials are missing.
 */
async function fetchSiteImprove(env) {
  const apiUser = env.SITEIMPROVE_API_USER; // account email (Basic-auth username)
  const apiKey = env.SITEIMPROVE_API_KEY; // API token (Basic-auth password)
  // Default to the US/global host; override via SITEIMPROVE_API_BASE (or _URL).
  const apiBase =
    env.SITEIMPROVE_API_BASE || env.SITEIMPROVE_API_URL || 'https://api.siteimprove.com/v2';

  if (!apiUser || !apiKey) {
    console.warn(
      '[SiteImprove] SITEIMPROVE_API_USER (account email) and/or SITEIMPROVE_API_KEY ' +
        'not set — skipping this source and returning [].'
    );
    return [];
  }
  if (!env.SITEIMPROVE_API_BASE && !env.SITEIMPROVE_API_URL) {
    console.log(`[SiteImprove] SITEIMPROVE_API_BASE not set — defaulting to ${apiBase}`);
  }

  const basic = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');
  const headers = { Authorization: `Basic ${basic}`, Accept: 'application/json' };

  // 1) List all sites (paginated on total_pages).
  const sites = await siPaginate(joinUrl(apiBase, '/sites'), headers);
  console.log(`[SiteImprove] ${sites.length} sites found; fetching accessibility DCI per site…`);

  // 2) Per site, read its accessibility DCI score.
  const records = await mapLimit(sites, 3, async (site) => {
    const domain = domainFromUrl(site.url);
    if (!domain) return null;
    let score = null;
    try {
      const dci = await fetchJson(joinUrl(apiBase, `/sites/${site.id}/dci/overview`), { headers });
      score = normalizeSiScore(siteImproveA11yScore(dci, site.product));
    } catch (err) {
      console.warn(`[SiteImprove] site ${site.id} (${domain}): no DCI score — ${err.message}`);
    }
    // Pages in SiteImprove's monitored index for this site (`pages` on the list
    // item). Distinct from axe's "tested" count — this is index size, not scanned.
    const pagesIndexed = Number.isFinite(site.pages) ? site.pages : null;
    return { domain, url: httpUrl(site.url, domain), score, pagesIndexed };
  });

  return records.filter(Boolean);
}

/** Page through a SiteImprove list endpoint using page / page_size + total_pages. */
async function siPaginate(baseUrl, headers) {
  const out = [];
  let page = 1;
  let totalPages = 1;
  do {
    const url = new URL(baseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(SI_PAGE_SIZE));
    const body = await fetchJson(url, { headers });
    for (const item of body.items ?? []) out.push(item);
    totalPages = Number(body.total_pages ?? 1) || 1;
    page += 1;
    if (page > 1000) break; // safety valve
  } while (page <= totalPages);
  return out;
}

// ------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------

/** Join a base URL that may itself contain a path (e.g. /monitor-public-api/v1). */
function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET JSON with a clear error on non-2xx, and automatic retry/backoff on
 * rate-limit (429) and transient (502/503/504) responses. Honors a numeric
 * `Retry-After` header when present, else exponential backoff.
 */
async function fetchJson(url, init = {}, { retries = 8 } = {}) {
  const key = cacheKey(url, init);

  // 1) Serve from cache when possible.
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  if (CACHE_OFFLINE) {
    CACHE_STATS.misses += 1;
    throw new Error(`[offline] no cached response for ${String(url).split('?')[0]}`);
  }

  // 2) Otherwise fetch (with retry/backoff) and cache on success.
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Network hiccup — retry a few times before giving up.
      if (attempt >= retries) throw err;
      await sleep(Math.min(1000 * 2 ** attempt, 15000));
      continue;
    }
    if (res.ok) {
      const body = await res.json();
      cacheSet(key, url, body);
      CACHE_STATS.misses += 1;
      return body;
    }

    const retryable = res.status === 429 || (res.status >= 500 && res.status <= 504);
    if (retryable && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** attempt, 30000);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${String(url).split('?')[0]}`);
  }
}

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Preserves order.
 * Dependency-free bounded concurrency for build-time N+1 fetching.
 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Page through an axe Monitor list endpoint using its header-based pagination
 * (X-Pagination-Page / X-Pagination-Per-Page). There is no total-count field,
 * so we stop when a page returns fewer than AXE_PER_PAGE items.
 * `pick(body)` extracts the array from the response envelope.
 */
async function axePaginate(url, headers, pick) {
  const out = [];
  let page = 1;
  for (;;) {
    const body = await fetchJson(url, {
      headers: {
        ...headers,
        'X-Pagination-Page': String(page),
        'X-Pagination-Per-Page': String(AXE_PER_PAGE),
      },
    });
    const items = pick(body) ?? [];
    for (const item of items) out.push(item);
    if (items.length < AXE_PER_PAGE) break;
    page += 1;
    if (page > 1000) break; // safety valve
  }
  return out;
}

/**
 * Ensure a linkable absolute URL. axe Monitor's `domainUrl` often comes back as
 * a bare host ("my.ny.gov") with no scheme, which renders as a broken relative
 * link. Prepend https:// when there's no scheme; fall back to the domain.
 */
function httpUrl(raw, domain) {
  const s = String(raw ?? '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s) return `https://${s.replace(/^\/+/, '')}`;
  return domain ? `https://${domain}` : '';
}

/** Best-effort bare-domain extraction from a URL string. */
function domainFromUrl(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    // Not a full URL — strip protocol/path/leading www. as a fallback.
    return String(url)
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./i, '');
  }
}

/**
 * Normalize a raw score to an integer in [0,100], or null.
 * The `label` is used only for the ratio-scale sanity warning below.
 */
function coerceScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * axe Monitor returns `score` as a 0–1 RATIO (confirmed against live data,
 * 2026-07); scale it to a 0–100 percentage. Defensive: a value already > 1 is
 * assumed to be on the 0–100 scale and passed through unscaled.
 */
function normalizeAxeScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return coerceScore(n <= 1 ? n * 100 : n);
}

/** SiteImprove DCI scores are already a 0–100 index — just round/clamp. */
function normalizeSiScore(value) {
  return coerceScore(value);
}

// ------------------------------------------------------------------------
// 4. Merge pipeline (PRD §4.1 normalization + conflict, §4.2 manual layer)
// ------------------------------------------------------------------------

/**
 * Read + parse the hand-maintained manual layer (PRD §4.2).
 *
 * File shape (a list the team keeps editing):
 *   { "manual": [ { "domain", "url", "flag_rating", "team_score",
 *                   "override_justification", "auditor_score",
 *                   "auditor_report_url", "auditor_deck_url",
 *                   "blocked", "blocked_note" }, … ] }
 *
 * Returns a plain object keyed by bare domain. Defensive by design: a missing
 * `manual` array, non-object rows, or entries without a `domain` are skipped
 * rather than throwing (the team edits this file by hand).
 *
 * IMPORTANT: `flag_rating` and `blocked_note` are internal-only and MUST NOT be
 * copied into the output — that stripping happens in `buildSites`.
 */
function loadManualData() {
  if (!existsSync(MANUAL_DATA_PATH)) {
    console.warn('[manual] data/manual-data.json not found — no manual layer will be merged.');
    return {};
  }
  const parsed = JSON.parse(readFileSync(MANUAL_DATA_PATH, 'utf8'));
  const rows = Array.isArray(parsed?.manual) ? parsed.manual : [];
  const byDomain = {};
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const domain = typeof row.domain === 'string' ? row.domain.trim() : '';
    if (!domain) continue;
    byDomain[domain] = row; // last entry wins on duplicate domains
  }
  return byDomain;
}

/**
 * Load the team-maintained exclusion list (`data/exclude_list.json`) and return
 * a matcher. These are sites (typically dev/QA/demo hosts pulled in from
 * SiteImprove) to drop ENTIRELY from the dashboard and all counts.
 *
 * File shape (any entry may be a bare string or an object with a `reason`):
 *   { "exclude": [
 *       "dev.example.ny.gov",
 *       "*.acquia-sites.com",
 *       { "url": "https://qa.example.ny.gov", "reason": "QA copy" }
 *   ] }
 *
 * Matching is host-based and includes subdomains: an entry `acquia-sites.com`
 * (or `*.acquia-sites.com`) drops that host and everything under it. A full URL
 * is reduced to its host. Blank/`#`-commented entries are ignored.
 */
function loadExcludeList() {
  if (!existsSync(EXCLUDE_LIST_PATH)) {
    return { patterns: [], isExcluded: () => false };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(EXCLUDE_LIST_PATH, 'utf8'));
  } catch (err) {
    console.warn(`[exclude] could not parse exclude_list.json — ignoring it (${err.message}).`);
    return { patterns: [], isExcluded: () => false };
  }
  const rows = Array.isArray(parsed?.exclude) ? parsed.exclude : [];
  const patterns = [];
  for (const row of rows) {
    const raw = typeof row === 'string' ? row : row && typeof row === 'object' ? row.url : '';
    let entry = typeof raw === 'string' ? raw.trim() : '';
    if (!entry || entry.startsWith('#')) continue; // allow "#"-prefixed comment lines
    entry = entry.replace(/^\*\./, ''); // "*.acquia-sites.com" → "acquia-sites.com"
    // A URL (has a scheme or a slash) → reduce to host; otherwise it's a bare host.
    const host = /:\/\/|\//.test(entry) ? domainFromUrl(entry) : entry.toLowerCase();
    if (host) patterns.push(host);
  }
  const isExcluded = (domain) => {
    if (!domain) return false;
    const d = domain.toLowerCase();
    return patterns.some((p) => d === p || d.endsWith(`.${p}`));
  };
  return { patterns, isExcluded };
}

/**
 * Load the team-maintained agency attribution overrides
 * (`data/agency-overrides.json`) and return a `domain → agency` Map.
 *
 * axe Monitor's Scan Groups are the only automated source of agency, and they
 * mix real agencies with functional tags — so many sites land in "Unattributed"
 * or (rarely) under the wrong name. This is the hand-maintained corrections
 * layer for that: an EXPLICIT entry here WINS over the automated attribution
 * (it can fill an Unattributed site AND correct a mis-attributed one).
 *
 * File shape (any row may be a bare `"domain"` string paired with an agency, or
 * an object; a full URL is reduced to its host, matching how sites are keyed):
 *   { "overrides": [
 *       { "domain": "apps.labor.ny.gov", "agency": "Department of Labor" },
 *       { "domain": "https://budget.ny.gov/", "agency": "Division of the Budget", "note": "…" }
 *   ] }
 *
 * Defensive by design (hand-edited): a missing file, unparseable JSON, or rows
 * without both a domain and a non-empty agency are skipped rather than throwing.
 */
function loadAgencyOverrides() {
  if (!existsSync(AGENCY_OVERRIDES_PATH)) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(AGENCY_OVERRIDES_PATH, 'utf8'));
  } catch (err) {
    console.warn(`[agency] could not parse agency-overrides.json — ignoring it (${err.message}).`);
    return new Map();
  }
  const rows = Array.isArray(parsed?.overrides) ? parsed.overrides : [];
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const domain = domainFromUrl(typeof row.domain === 'string' ? row.domain.trim() : '');
    const agency = typeof row.agency === 'string' ? row.agency.trim() : '';
    if (!domain || !agency) continue;
    map.set(domain, agency); // last entry wins on duplicate domains
  }
  return map;
}

/**
 * Apply the agency overrides to the built sites (mutates in place). Explicit
 * entries win over the automated attribution. Logs what happened so nothing is
 * silent: how many were applied, any override that CHANGED an already-named
 * agency, overrides whose domain matched no site, and agency names that don't
 * match any name already in the dataset (a likely typo → a stray rollup bucket).
 */
function applyAgencyOverrides(sites, overrides) {
  if (overrides.size === 0) return;
  const knownAgencies = new Set(
    sites.map((s) => s.agency).filter((a) => a && a !== UNATTRIBUTED),
  );
  const byDomain = new Map(sites.map((s) => [s.domain, s]));
  let applied = 0;
  const changed = []; // overrode an already-attributed agency
  const unmatched = []; // override domain not present in the dataset
  const unknownAgency = new Set(); // agency name not seen anywhere else

  for (const [domain, agency] of overrides) {
    const site = byDomain.get(domain);
    if (!site) {
      unmatched.push(domain);
      continue;
    }
    if (site.agency !== agency) {
      if (site.agency !== UNATTRIBUTED) changed.push(`${domain}: "${site.agency}" → "${agency}"`);
      site.agency = agency;
      applied += 1;
    }
    if (!knownAgencies.has(agency)) unknownAgency.add(agency);
  }

  console.log(`[agency] ${applied} override(s) applied from agency-overrides.json.`);
  if (changed.length) {
    console.warn(`[agency] ${changed.length} override(s) REPLACED an existing agency:`);
    for (const c of changed) console.warn(`           ${c}`);
  }
  if (unmatched.length) {
    console.warn(
      `[agency] ${unmatched.length} override(s) matched no site (domain not in the dataset): ` +
        unmatched.join(', '),
    );
  }
  if (unknownAgency.size) {
    console.warn(
      `[agency] ${unknownAgency.size} override agency name(s) don't match any other site — ` +
        `check for typos or they'll form their own rollup bucket: ` +
        [...unknownAgency].map((a) => `"${a}"`).join(', '),
    );
  }
}

/**
 * Build the merged `Site[]` array from the two normalized sources + manual data.
 *
 * PRD §4.1:
 *   - axe Monitor's agency grouping is the CANONICAL taxonomy.
 *   - SiteImprove records inherit agency by domain; unresolved → Unattributed.
 *   - Same domain in BOTH tools → `conflict: true` (surface, don't average).
 * PRD §4.2:
 *   - manual layer supplies auditorScore / report / deck / blocked by domain.
 */
function buildSites(axeRecords, siteImproveRecords, manualData) {
  // Canonical domain → agency map, sourced ONLY from axe Monitor (PRD §4.1).
  const agencyByDomain = new Map();
  for (const rec of axeRecords) {
    if (rec.domain && rec.agency && rec.agency !== UNATTRIBUTED) {
      agencyByDomain.set(rec.domain, rec.agency);
    }
  }

  // Track which source(s) each domain appeared in for conflict detection.
  const sites = new Map(); // domain → partial Site

  const getSite = (domain, url) => {
    let site = sites.get(domain);
    if (!site) {
      site = {
        domain,
        url: url || '',
        agency: agencyByDomain.get(domain) ?? UNATTRIBUTED,
        axeMonitorScore: null,
        siteImproveScore: null,
        axeMonitorPagesTested: null,
        siteImprovePagesIndexed: null,
        teamScore: null,
        overrideJustification: null,
        auditorScore: null,
        auditorReportUrl: null,
        auditorDeckUrl: null,
        monitorReportUrl: null,
        blocked: false,
        conflict: false,
        _inAxe: false, // internal — stripped before output
        _inSiteImprove: false, // internal — stripped before output
      };
      sites.set(domain, site);
    }
    // Prefer a non-empty url if we didn't have one yet.
    if (!site.url && url) site.url = url;
    return site;
  };

  // --- axe Monitor scores + canonical agency ---
  for (const rec of axeRecords) {
    if (!rec.domain) continue;
    const site = getSite(rec.domain, rec.url);
    site.axeMonitorScore = rec.score;
    site.axeMonitorPagesTested = rec.pagesTested ?? null;
    site.agency = agencyByDomain.get(rec.domain) ?? UNATTRIBUTED;
    // monitorReportUrl: the axe Monitor Public API exposes no public per-site
    // report URL — scans/runs/pages responses carry only ids, scores, and the
    // (auth-gated) domain host, no permalink/report/public link. So we leave it
    // null rather than fabricate an unverifiable URL pattern; the UI degrades
    // gracefully (no monitor link rendered).
    site.monitorReportUrl = null;
    site._inAxe = true;
  }

  // --- SiteImprove scores (agency mapped onto axe taxonomy) ---
  for (const rec of siteImproveRecords) {
    if (!rec.domain) continue;
    const site = getSite(rec.domain, rec.url);
    site.siteImproveScore = rec.score;
    site.siteImprovePagesIndexed = rec.pagesIndexed ?? null;
    // Agency comes from axe Monitor taxonomy; unresolved stays Unattributed.
    site.agency = agencyByDomain.get(rec.domain) ?? site.agency ?? UNATTRIBUTED;
    site._inSiteImprove = true;
  }

  // --- Conflict flag: same domain in BOTH tools (PRD §4.1) ---
  for (const site of sites.values()) {
    site.conflict = site._inAxe && site._inSiteImprove;
  }

  // --- Merge manual layer by domain (PRD §4.2) ---
  // The manual layer AUGMENTS matching automated sites and also CONTRIBUTES
  // hand-reviewed domains that appear in neither tool (team/auditor scores for
  // sites axe Monitor and SiteImprove never crawled). Iterate the manual rows —
  // not the existing sites — so those manual-only domains become sites too;
  // `getSite` creates one on first sight (all automated scores null, agency
  // Unattributed, since the agency taxonomy only comes from axe Monitor).
  // Defensive: the team hand-edits this file, so normalize the domain key (a
  // stray scheme like "https://omig.ny.gov" must not leak into output or miss a
  // match) and treat any missing field as null/false.
  for (const [rawDomain, manual] of Object.entries(manualData)) {
    const domain = domainFromUrl(rawDomain) || rawDomain;
    const site = getSite(domain, manual.url);
    site.teamScore = manual.team_score ?? null;
    site.overrideJustification = manual.override_justification ?? null;
    site.auditorScore = manual.auditor_score ?? null;
    site.auditorReportUrl = manual.auditor_report_url ?? null;
    site.auditorDeckUrl = manual.auditor_deck_url ?? null;
    site.blocked = !!manual.blocked;
    // NOTE: `flag_rating` and `blocked_note` are intentionally NOT copied —
    // internal only, never surfaced to the client (PRD §4.2).
  }

  // Strip internal bookkeeping fields → final Site shape (matches src/types.ts).
  return [...sites.values()].map(({ _inAxe, _inSiteImprove, ...site }) => site);
}

// ------------------------------------------------------------------------
// 4b. Deputy Commissioners for Technology (DCTs)
//     Each DCT owns a portfolio of agencies. The dashboard groups sites by
//     DCT (default chart view, table column + filter). The list is PUBLIC on
//     its.ny.gov and is scraped on each run so it never drifts from the page.
// ------------------------------------------------------------------------

/** Decode the handful of HTML entities the DCT page uses, then strip tags. */
function htmlToText(fragment) {
  return String(fragment)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse the "Name | Agencies Supported" table on the DCT page into
 * `[{ name, agencies: [token, …] }]`. Titles ("DCT:", "Acting DCT:") are
 * stripped from names; two DCTs sharing one row ("A | DCT: B") become
 * "A & B". Agency tokens are the page's own comma-separated abbreviations,
 * kept verbatim — they are the chart labels.
 */
function parseDctTable(html) {
  const tables = String(html).match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const table = tables.find((t) => /Agencies\s+Supported/i.test(t));
  if (!table) return [];
  const out = [];
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (row.match(/<td[\s\S]*?<\/td>/gi) ?? []).map(htmlToText);
    if (cells.length < 2) continue; // header row (th) or malformed
    const name = cells[0]
      .split('|')
      .map((part) => part.replace(/\b(acting\s+)?dct\s*:?/gi, '').trim())
      .filter(Boolean)
      .join(' & ');
    const agencies = cells[1]
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (name && agencies.length) out.push({ name, agencies });
  }
  return out;
}

/**
 * Fetch the DCT list from its.ny.gov and cache it to `data/dcts.json` (which
 * is committed, so `--offline` runs and the trend backfill work without the
 * page). Falls back to that file when the page is unreachable or its markup
 * no longer parses, with a warning — the last good list is better than none.
 */
async function fetchDcts() {
  let dcts = [];
  if (!CACHE_OFFLINE) {
    try {
      const res = await fetch(DCT_URL, {
        headers: { Accept: 'text/html', 'User-Agent': 'nys-a11y-dashboard-generator' },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      dcts = parseDctTable(await res.text());
      if (dcts.length === 0) throw new Error('no DCT table found in the page markup');
      mkdirSync(dirname(DCTS_PATH), { recursive: true });
      writeFileSync(
        DCTS_PATH,
        JSON.stringify({ sourceUrl: DCT_URL, fetchedAt: new Date().toISOString(), dcts }, null, 2) + '\n',
        'utf8',
      );
      console.log(`[dct] ${dcts.length} DCTs scraped from ${DCT_URL} → data/dcts.json`);
      return dcts;
    } catch (err) {
      console.warn(`[dct] could not scrape ${DCT_URL} (${err.message}); using data/dcts.json`);
    }
  }
  if (existsSync(DCTS_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(DCTS_PATH, 'utf8'));
      dcts = Array.isArray(parsed?.dcts) ? parsed.dcts : [];
      console.log(`[dct] ${dcts.length} DCTs loaded from data/dcts.json (fetched ${parsed.fetchedAt ?? 'unknown'})`);
    } catch (err) {
      console.warn(`[dct] could not parse data/dcts.json — no DCT grouping (${err.message}).`);
    }
  } else {
    console.warn('[dct] data/dcts.json not found — no DCT grouping this run.');
  }
  return dcts;
}

/** `{ token → [extra dashboard agency names] }` from data/dct-aliases.json. */
function loadDctAliases() {
  if (!existsSync(DCT_ALIASES_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(DCT_ALIASES_PATH, 'utf8'));
    return parsed?.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {};
  } catch (err) {
    console.warn(`[dct] could not parse dct-aliases.json — ignoring it (${err.message}).`);
    return {};
  }
}

/**
 * `{ DCT name → [dashboard agency names] }` from data/dct-portfolio-additions.json:
 * portfolio members the public page doesn't list, gathered from the DCTs.
 */
function loadDctAdditions() {
  if (!existsSync(DCT_ADDITIONS_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(DCT_ADDITIONS_PATH, 'utf8'));
    return parsed?.additions && typeof parsed.additions === 'object' ? parsed.additions : {};
  } catch (err) {
    console.warn(`[dct] could not parse dct-portfolio-additions.json — ignoring it (${err.message}).`);
    return {};
  }
}

/**
 * Build `agency name (lowercased) → DCT name` in two passes.
 *
 *  1. The public page. A page token matches a dashboard agency of the same
 *     name (case-insensitive) plus every extra name listed for it in
 *     dct-aliases.json. Logs tokens that match no site (portfolio agencies
 *     with nothing scanned yet) and any agency two DCTs both claim (first DCT
 *     on the page wins).
 *  2. Our additions (dct-portfolio-additions.json) fill in agencies the page
 *     left out. The page always wins: an agency it already assigned is never
 *     moved, and the conflict is logged so the two lists can be reconciled.
 *     An additions entry for a DCT no longer on the page is logged and
 *     ignored rather than inventing a portfolio.
 */
function buildDctIndex(dcts, aliases, additions, knownAgencies) {
  const known = new Map([...knownAgencies].map((a) => [a.toLowerCase(), a]));
  const index = new Map(); // agency lower → dct name
  const unmatchedTokens = [];
  const contested = [];

  // Pass 1 — the public page.
  for (const dct of dcts) {
    for (const token of dct.agencies) {
      const names = [token, ...(Array.isArray(aliases[token]) ? aliases[token] : [])];
      let hit = false;
      for (const name of names) {
        const key = String(name).toLowerCase();
        if (!known.has(key)) continue;
        hit = true;
        const existing = index.get(key);
        if (existing && existing !== dct.name) {
          contested.push(`${known.get(key)}: ${existing} vs ${dct.name}`);
          continue;
        }
        index.set(key, dct.name);
      }
      if (!hit) unmatchedTokens.push(`${token} (${dct.name})`);
    }
  }
  if (unmatchedTokens.length) {
    console.log(
      `[dct] ${unmatchedTokens.length} portfolio agency token(s) match no scanned site ` +
        `(add an alias in data/dct-aliases.json if the name differs): ${unmatchedTokens.join(', ')}`,
    );
  }
  if (contested.length) {
    console.warn(`[dct] agency claimed by two DCTs on the page (first wins): ${contested.join('; ')}`);
  }

  // Pass 2 — our additions, page wins on any overlap.
  const pageDcts = new Set(dcts.map((d) => d.name));
  const overridden = [];
  const noSites = [];
  let added = 0;
  for (const [dctName, agencies] of Object.entries(additions)) {
    if (!pageDcts.has(dctName)) {
      console.warn(
        `[dct] additions for "${dctName}" ignored — no DCT of that name on ${DCT_URL} ` +
          '(update the key in data/dct-portfolio-additions.json).',
      );
      continue;
    }
    for (const name of Array.isArray(agencies) ? agencies : []) {
      const key = String(name).toLowerCase();
      if (!known.has(key)) {
        noSites.push(String(name));
        continue;
      }
      const existing = index.get(key);
      if (existing && existing !== dctName) {
        overridden.push(`${known.get(key)}: page says ${existing}, additions say ${dctName}`);
        continue;
      }
      if (!existing) added += 1;
      index.set(key, dctName);
    }
  }
  if (added) console.log(`[dct] ${added} agency(ies) assigned from data/dct-portfolio-additions.json.`);
  if (noSites.length) {
    console.log(`[dct] ${noSites.length} addition(s) match no scanned site yet: ${noSites.join(', ')}`);
  }
  if (overridden.length) {
    console.warn(`[dct] additions contradict the page (page wins): ${overridden.join('; ')}`);
  }
  return index;
}

/** Set `site.dct` on every site (null = no DCT covers its agency). */
function applyDcts(sites, dctIndex) {
  let assigned = 0;
  const uncovered = new Set();
  for (const site of sites) {
    const dct = dctIndex.get(String(site.agency).toLowerCase()) ?? null;
    site.dct = dct;
    if (dct) assigned += 1;
    else uncovered.add(site.agency);
  }
  console.log(
    `[dct] ${assigned}/${sites.length} sites assigned to a DCT; ` +
      `${uncovered.size} agency bucket(s) have no DCT: ${[...uncovered].sort().join(', ')}`,
  );
}

// ------------------------------------------------------------------------
// 4c. History snapshots (monthly trend)
//     Every run of this script writes `data/history/<YYYY-MM>.json` — the
//     snapshot of record for that month (all sources, official inputs). Those
//     files are the ONLY thing the trend chart reads; the dashboard never
//     calls an API. Months with no snapshot are backfilled from axe Monitor's
//     run history (automated score only) so the line starts as early as the
//     data allows. A dashboard snapshot always wins over a backfilled month.
// ------------------------------------------------------------------------

const SNAPSHOT_SOURCE = 'dashboard';
const BACKFILL_SOURCE = 'axe-monitor-run-history';

/** The per-site fields a snapshot keeps (deliberately small and stable). */
function snapshotSite(site) {
  return {
    domain: site.domain,
    agency: site.agency,
    axeMonitorScore: site.axeMonitorScore ?? null,
    siteImproveScore: site.siteImproveScore ?? null,
    auditorScore: site.auditorScore ?? null,
    teamScore: site.teamScore ?? null,
    blocked: !!site.blocked,
  };
}

function snapshotPath(month) {
  return join(HISTORY_DIR, `${month}.json`);
}

function readSnapshot(month) {
  const file = snapshotPath(month);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[history] could not parse ${file} — skipping it (${err.message}).`);
    return null;
  }
}

function writeSnapshot(snapshot) {
  mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(snapshotPath(snapshot.month), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}

/** Write this run's snapshot of record for the current month. */
function writeDashboardSnapshot(sites, generatedAt) {
  const month = generatedAt.slice(0, 7);
  writeSnapshot({
    capturedAt: generatedAt,
    month,
    source: SNAPSHOT_SOURCE,
    sites: sites.map(snapshotSite),
  });
  console.log(`[history] wrote data/history/${month}.json (${sites.length} sites, snapshot of record).`);
}

/**
 * Backfill months that have no dashboard snapshot from axe Monitor's run
 * history: for each site, the latest completed run in each month. Applies the
 * same agency overrides and exclusions as the live data so grouping matches.
 * Re-written on every run (the run history is authoritative for them); never
 * touches a month that has a dashboard snapshot.
 */
function backfillHistoryFromAxeRuns(axeRecords, overrides, isExcluded) {
  const byMonth = new Map(); // month → Map(domain → {completedAt, score})
  for (const rec of axeRecords) {
    if (!rec.domain || isExcluded(rec.domain)) continue;
    for (const run of rec.runHistory ?? []) {
      const month = String(run.completedAt).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      const sites = byMonth.get(month) ?? new Map();
      const prev = sites.get(rec.domain);
      if (!prev || run.completedAt > prev.completedAt) {
        sites.set(rec.domain, { ...run, agency: overrides.get(rec.domain) ?? rec.agency });
      }
      byMonth.set(month, sites);
    }
  }
  const written = [];
  for (const [month, sites] of [...byMonth].sort()) {
    const existing = readSnapshot(month);
    if (existing && existing.source !== BACKFILL_SOURCE) continue; // dashboard snapshot wins
    const capturedAt = [...sites.values()].map((r) => r.completedAt).sort().at(-1);
    writeSnapshot({
      capturedAt,
      month,
      source: BACKFILL_SOURCE,
      sites: [...sites.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([domain, r]) =>
          snapshotSite({ domain, agency: r.agency, axeMonitorScore: r.score }),
        ),
    });
    written.push(`${month} (${sites.size})`);
  }
  if (written.length) console.log(`[history] backfilled from axe Monitor runs: ${written.join(', ')}`);
}

/**
 * Compile every `data/history/*.json` into the compact `history` block the
 * client renders: one row per site with its automated score per snapshot
 * (axe Monitor, else SiteImprove — the same fallback the official score uses)
 * and the list of manual audits (a point whenever an auditor score first
 * appears or changes; `auditor_date` in manual-data.json pins the month when
 * the team records one). Agency/DCT come from the CURRENT data when the site
 * still exists so grouping is consistent across the whole series; excluded
 * sites are dropped from history too.
 */
function compileHistory(currentSites, dctIndex, manualData, isExcluded) {
  if (!existsSync(HISTORY_DIR)) return { snapshots: [], sites: [] };
  const snapshots = readdirSync(HISTORY_DIR)
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => readSnapshot(f.replace(/\.json$/, '')))
    .filter((s) => s && Array.isArray(s.sites));

  const current = new Map(currentSites.map((s) => [s.domain, s]));
  const rows = new Map(); // domain → row
  snapshots.forEach((snap, i) => {
    for (const s of snap.sites) {
      if (!s?.domain || isExcluded(s.domain)) continue;
      let row = rows.get(s.domain);
      if (!row) {
        row = { domain: s.domain, agency: s.agency ?? UNATTRIBUTED, dct: null, automated: new Array(snapshots.length).fill(null), audits: [], _lastAudit: null };
        rows.set(s.domain, row);
      }
      // Latest snapshot's agency wins unless the site is in the current data.
      row.agency = s.agency ?? row.agency;
      row.automated[i] = s.axeMonitorScore ?? s.siteImproveScore ?? null;
      if (s.auditorScore !== null && s.auditorScore !== undefined && s.auditorScore !== row._lastAudit) {
        row.audits.push({ month: snap.month, score: s.auditorScore });
        row._lastAudit = s.auditorScore;
      }
    }
  });

  const sites = [...rows.values()].map(({ _lastAudit, ...row }) => {
    const live = current.get(row.domain);
    const agency = live?.agency ?? row.agency;
    const manual = manualData[row.domain];
    const pinned = typeof manual?.auditor_date === 'string' && /^\d{4}-\d{2}/.test(manual.auditor_date);
    let audits = row.audits;
    if (pinned && live?.auditorScore !== null && live?.auditorScore !== undefined) {
      // The team dated the current audit: place it in that month and drop the
      // first-seen point for the same score.
      audits = [
        ...audits.filter((a) => a.score !== live.auditorScore),
        { month: manual.auditor_date.slice(0, 7), score: live.auditorScore },
      ].sort((a, b) => a.month.localeCompare(b.month));
    }
    return {
      domain: row.domain,
      agency,
      dct: dctIndex.get(String(agency).toLowerCase()) ?? null,
      automated: row.automated,
      audits,
    };
  });
  sites.sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    snapshots: snapshots.map((s) => ({ month: s.month, capturedAt: s.capturedAt, source: s.source })),
    sites,
  };
}

// ------------------------------------------------------------------------
// 5. Main orchestration
// ------------------------------------------------------------------------

/**
 * Diagnostic: print which expected env vars are present (booleans only — never
 * values). Run with `node scripts/generate.mjs --check-env`. Safe to share.
 */
function checkEnv(env) {
  // Each entry lists the accepted names for that value (first is canonical).
  const expected = [
    ['axe Monitor base URL', ['AXE_MONITOR_API_BASE', 'AXE_MONITOR_API_URL']],
    ['axe Monitor API key', ['AXE_MONITOR_API_KEY']],
    ['SiteImprove base URL (optional — defaults to US host)', ['SITEIMPROVE_API_BASE', 'SITEIMPROVE_API_URL']],
    ['SiteImprove account email', ['SITEIMPROVE_API_USER']],
    ['SiteImprove API key', ['SITEIMPROVE_API_KEY']],
  ];
  console.log('\nExpected credentials (✓ = set & non-empty, ✗ = missing/empty):');
  for (const [label, names] of expected) {
    const hit = names.find((n) => typeof env[n] === 'string' && env[n].trim() !== '');
    console.log(`  ${hit ? '✓' : '✗'}  ${label}${hit ? `  (via ${hit})` : `  (set one of: ${names.join(' / ')})`}`);
  }
  // Surface any AXE_*/SITEIMPROVE_* names the user DID set, so a typo'd or
  // differently-named var is obvious. Names only — values are never printed.
  const found = Object.keys(env)
    .filter((k) => /^(AXE_|SITEIMPROVE_)/.test(k))
    .sort();
  console.log(
    `\n  Names present in your env matching AXE_*/SITEIMPROVE_*: ${
      found.length ? found.join(', ') : '(none)'
    }\n`
  );
}

/** `meta.generatedAt` of the current public/dashboard-data.json, if any. */
function previousGeneratedAt() {
  if (!existsSync(OUTPUT_PATH)) return null;
  try {
    const prev = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
    return typeof prev?.meta?.generatedAt === 'string' ? prev.meta.generatedAt : null;
  } catch {
    return null;
  }
}

async function main() {
  const env = loadEnv();

  if (process.argv.includes('--check-env')) {
    checkEnv(env);
    return;
  }

  // Refresh only the DCT list (no API pull): `npm run generate:dcts`.
  if (CLI.has('--dcts-only')) {
    await fetchDcts();
    return;
  }

  // Fetch both sources. Each guards its own missing-credential case and
  // returns [] rather than throwing, so dev runs never crash (PRD §9).
  const [axeRecords, siteImproveRecords, dcts] = await Promise.all([
    fetchAxeMonitor(env),
    fetchSiteImprove(env),
    fetchDcts(),
  ]);

  // Guard: both sources empty. Don't clobber good sample/committed data with
  // an empty file. If no output exists yet, we still write an empty dataset
  // so the site has something valid to load.
  if (axeRecords.length === 0 && siteImproveRecords.length === 0) {
    if (existsSync(OUTPUT_PATH)) {
      console.warn(
        '\nBoth automated sources returned 0 records AND public/dashboard-data.json already ' +
          'exists.\nRefusing to overwrite existing data with an empty dataset — exiting 0.\n' +
          '(Set the axe Monitor / SiteImprove credentials in .env to pull live data.)'
      );
      process.exit(0);
    }
    console.warn(
      '\nBoth automated sources returned 0 records and no existing output found.\n' +
        'Writing an empty dataset (manual layer will still be merged for known domains).'
    );
  }

  const manualData = loadManualData();
  const allSites = buildSites(axeRecords, siteImproveRecords, manualData);

  // Apply team agency attribution overrides. axe Monitor is the only automated
  // source of agency and it leaves many sites Unattributed (or, rarely, wrong);
  // this hand-maintained layer fills/corrects them. Explicit entries win.
  const agencyOverrides = loadAgencyOverrides();
  applyAgencyOverrides(allSites, agencyOverrides);

  // Drop team-excluded sites (dev/QA/demo hosts) entirely — from the data and
  // therefore from every count/chart downstream.
  const { patterns: excludePatterns, isExcluded } = loadExcludeList();
  const sites = allSites.filter((s) => !isExcluded(s.domain));
  const excludedCount = allSites.length - sites.length;
  if (excludePatterns.length) {
    console.log(
      `[exclude] ${excludedCount} site(s) removed via ${excludePatterns.length} ` +
        `exclude_list.json pattern(s).`,
    );
  }

  // Group by DCT: map each site's agency to the DCT whose portfolio covers it.
  const dctIndex = buildDctIndex(
    dcts,
    loadDctAliases(),
    loadDctAdditions(),
    new Set(sites.map((s) => s.agency)),
  );
  applyDcts(sites, dctIndex);

  // An --offline run re-serves cached responses, so its data is no fresher
  // than the last real capture: keep the previous output's timestamp rather
  // than stamping today's date on old numbers.
  const generatedAt = (CACHE_OFFLINE && previousGeneratedAt()) || new Date().toISOString();

  // History: this run's snapshot of record, then backfill any month with no
  // snapshot from axe Monitor's run history, then compile the whole series
  // for the client. The snapshot of record is only written for a COMPLETE
  // live capture — not for --offline dev runs, and not when a source returned
  // nothing (an outage or a missing key must not become the month's record).
  if (CACHE_OFFLINE) {
    console.log('[history] --offline run: not writing a monthly snapshot (cached data is not a fresh capture).');
  } else if (axeRecords.length === 0 || siteImproveRecords.length === 0) {
    console.warn(
      `[history] NOT writing a monthly snapshot: ${axeRecords.length === 0 ? 'axe Monitor' : 'SiteImprove'} ` +
        'returned 0 records. Re-run once both sources respond so the month is captured in full.',
    );
  } else {
    writeDashboardSnapshot(sites, generatedAt);
  }
  backfillHistoryFromAxeRuns(axeRecords, agencyOverrides, isExcluded);
  const history = compileHistory(sites, dctIndex, manualData, isExcluded);

  // Assemble the final DashboardData (matches src/types.ts exactly).
  const data = {
    meta: {
      generatedAt,
      automatedCoveragePct: 30, // PRD §5.4 — the mandatory 30% caveat headline.
      rubric: {
        // Inclusive [min, max] ranges, PRD §5.1.
        red: [0, 40],
        yellow: [41, 79],
        green: [80, 100],
      },
      sources: ['axe Monitor', 'SiteImprove', 'Axe Auditor (manual)'],
      dcts: dcts.map((d) => ({ name: d.name, agencies: d.agencies })),
    },
    sites,
    history,
  };

  // Ensure public/ exists, then write pretty-printed JSON (no secrets).
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');

  printSummary({ axeRecords, siteImproveRecords, sites, dcts, history });
}

/** Concise stdout summary (PRD §6 statewide-summary style counts). */
function printSummary({ axeRecords, siteImproveRecords, sites, dcts, history }) {
  const conflicts = sites.filter((s) => s.conflict).length;
  const unattributed = sites.filter((s) => s.agency === UNATTRIBUTED).length;
  const blocked = sites.filter((s) => s.blocked).length;
  const noDct = sites.filter((s) => !s.dct).length;

  console.log('\n─── dashboard-data.json generated ───');
  console.log(`  axe Monitor records : ${axeRecords.length}`);
  console.log(`  SiteImprove records : ${siteImproveRecords.length}`);
  console.log(`  total sites         : ${sites.length}`);
  console.log(`  conflicts flagged   : ${conflicts}`);
  console.log(`  unattributed        : ${unattributed}`);
  console.log(`  blocked             : ${blocked}`);
  console.log(`  DCTs                : ${dcts.length} (${noDct} sites with no DCT)`);
  console.log(
    `  history             : ${history.snapshots.length} month(s) — ` +
      history.snapshots.map((s) => `${s.month}${s.source === BACKFILL_SOURCE ? '*' : ''}`).join(', ') +
      (history.snapshots.some((s) => s.source === BACKFILL_SOURCE) ? '  (* backfilled from axe runs)' : ''),
  );
  console.log(`  output              : ${OUTPUT_PATH}`);
  console.log(
    `  cache               : ${CACHE_STATS.hits} hit / ${CACHE_STATS.misses} fetched` +
      `${CACHE_REFRESH ? ' (--refresh)' : ''}${CACHE_OFFLINE ? ' (--offline)' : ''}`
  );
  console.log('─────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('\n[generate] Fatal error:', err);
  process.exit(1);
});
