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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// --- Paths --------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_PATH = join(ROOT, '.env');
const MANUAL_DATA_PATH = join(ROOT, 'data', 'manual-data.json');
const OUTPUT_DIR = join(ROOT, 'public');
const OUTPUT_PATH = join(OUTPUT_DIR, 'dashboard-data.json');
const CACHE_DIR = join(ROOT, 'scripts', '.cache');

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
    try {
      const runsBody = await fetchJson(joinUrl(apiBase, `/scans/${scanId}/runs`), {
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
    return { domain, url: httpUrl(pageUrl || domainUrl, domain), agency, score, pagesTested };
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
async function fetchJson(url, init = {}, { retries = 5 } = {}) {
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

    const retryable = res.status === 429 || (res.status >= 502 && res.status <= 504);
    if (retryable && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** attempt, 15000);
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
  // Defensive: any missing key → null/false (the team hand-edits this file).
  for (const site of sites.values()) {
    const manual = manualData[site.domain];
    if (!manual) continue;
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

async function main() {
  const env = loadEnv();

  if (process.argv.includes('--check-env')) {
    checkEnv(env);
    return;
  }

  // Fetch both sources. Each guards its own missing-credential case and
  // returns [] rather than throwing, so dev runs never crash (PRD §9).
  const [axeRecords, siteImproveRecords] = await Promise.all([
    fetchAxeMonitor(env),
    fetchSiteImprove(env),
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
  const sites = buildSites(axeRecords, siteImproveRecords, manualData);

  // Assemble the final DashboardData (matches src/types.ts exactly).
  const data = {
    meta: {
      generatedAt: new Date().toISOString(),
      automatedCoveragePct: 30, // PRD §5.4 — the mandatory 30% caveat headline.
      rubric: {
        // Inclusive [min, max] ranges, PRD §5.1.
        red: [0, 40],
        yellow: [41, 79],
        green: [80, 100],
      },
      sources: ['axe Monitor', 'SiteImprove', 'Axe Auditor (manual)'],
    },
    sites,
  };

  // Ensure public/ exists, then write pretty-printed JSON (no secrets).
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');

  printSummary({ axeRecords, siteImproveRecords, sites });
}

/** Concise stdout summary (PRD §6 statewide-summary style counts). */
function printSummary({ axeRecords, siteImproveRecords, sites }) {
  const conflicts = sites.filter((s) => s.conflict).length;
  const unattributed = sites.filter((s) => s.agency === UNATTRIBUTED).length;
  const blocked = sites.filter((s) => s.blocked).length;

  console.log('\n─── dashboard-data.json generated ───');
  console.log(`  axe Monitor records : ${axeRecords.length}`);
  console.log(`  SiteImprove records : ${siteImproveRecords.length}`);
  console.log(`  total sites         : ${sites.length}`);
  console.log(`  conflicts flagged   : ${conflicts}`);
  console.log(`  unattributed        : ${unattributed}`);
  console.log(`  blocked             : ${blocked}`);
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
