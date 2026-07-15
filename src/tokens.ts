import type { Status } from './types';

/**
 * Single source of truth for status → NYSDS semantic color token.
 * ECharts and NYSDS components stay visually locked to the rubric via these
 * tokens (PRD §7, §8) — never hardcode hex.
 */
export const STATUS_TOKENS: Record<Status | 'unknown', string> = {
  red: '--nys-color-danger',
  yellow: '--nys-color-warning',
  green: '--nys-color-success',
  unknown: '--nys-color-base',
};

export const STATUS_TOKENS_WEAK: Record<Status | 'unknown', string> = {
  red: '--nys-color-danger-weak',
  yellow: '--nys-color-warning-weak',
  green: '--nys-color-success-weak',
  unknown: '--nys-color-base-weak',
};

/**
 * Resolve a CSS custom property to its computed value, for handing concrete
 * colors to ECharts (which cannot read CSS variables itself).
 */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** Resolved hex for a status color, for ECharts series. */
export function statusColor(status: Status | 'unknown'): string {
  return cssVar(STATUS_TOKENS[status]);
}
