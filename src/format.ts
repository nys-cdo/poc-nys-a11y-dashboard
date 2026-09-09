import type { Status } from './types';

/** Human label for a status (used in text, aria-labels, chart tooltips). */
export function statusLabel(status: Status | 'unknown'): string {
  switch (status) {
    case 'red':
      return 'Needs urgent attention';
    case 'yellow':
      return 'Needs review';
    case 'green':
      return 'No automated blockers';
    case 'unknown':
      return 'Not scored';
  }
}

/** Short label for compact chips. */
export function statusShort(status: Status | 'unknown'): string {
  switch (status) {
    case 'red':
      return 'Red';
    case 'yellow':
      return 'Yellow';
    case 'green':
      return 'Green';
    case 'unknown':
      return 'Not scored';
  }
}

/** Maps our status to a nys-badge `intent` (`danger` replaced the deprecated `error` in NYSDS 1.21). */
export function statusIntent(
  status: Status | 'unknown',
): 'danger' | 'warning' | 'success' | 'base' {
  switch (status) {
    case 'red':
      return 'danger';
    case 'yellow':
      return 'warning';
    case 'green':
      return 'success';
    case 'unknown':
      return 'base';
  }
}

/** Format an ISO date as a readable "last refreshed" string. */
export function formatRefreshed(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Render a score as a percent, or an em dash placeholder for null. */
export function formatScore(score: number | null): string {
  return score === null ? '—' : `${score}%`;
}

/** Integer count with thousands separators, or an em dash when absent. */
export function formatCount(count: number | null): string {
  return count === null ? '—' : count.toLocaleString('en-US');
}

/** A signed change ("+3.5", "−12", "0") for month-over-month readouts. */
export function formatDelta(delta: number, unit = ''): string {
  if (delta === 0) return `0${unit}`;
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta).toLocaleString('en-US')}${unit}`;
}

/** "Jul 2026" from "2026-07". */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Capitalized impact label ("Critical"). */
export function impactLabel(impact: string): string {
  return impact.charAt(0).toUpperCase() + impact.slice(1);
}

/**
 * Normalize a URL to an absolute, linkable href. A bare host ("my.ny.gov")
 * would otherwise resolve as a relative path and break; prepend https://.
 */
export function safeHref(url: string | null): string {
  const s = (url ?? '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  return s ? `https://${s.replace(/^\/+/, '')}` : '#';
}

/** Escape a string for safe interpolation into innerHTML. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
