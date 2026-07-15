import type { DashboardData } from './types';

/**
 * Load the generated snapshot. Uses a relative path so it works under a
 * GitHub Pages subpath (base './'). The file is produced by
 * scripts/generate.mjs and served from /public.
 */
export async function loadDashboardData(): Promise<DashboardData> {
  const res = await fetch('./dashboard-data.json', { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(
      `Could not load dashboard-data.json (HTTP ${res.status}). Run \`npm run generate\` first.`,
    );
  }
  return (await res.json()) as DashboardData;
}
