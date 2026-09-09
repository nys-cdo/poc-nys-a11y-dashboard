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

/**
 * Categorical series palette for the trend chart (NYSDS ships no data-viz
 * palette). Eight hues in a FIXED order, validated as a set for adjacent-pair
 * color-vision-deficiency separation and normal-vision distinctness on a
 * white surface — assign by slot, never cycle past eight (extra series fold
 * into the neutral `SERIES_OTHER`). Slot 1 (blue) is the single-series
 * automated line; `AUDIT_COLOR` (orange, slot 2) marks manual audits.
 */
export const SERIES_PALETTE = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
] as const;
export const SERIES_OTHER = '#b5b5b1';
export const AUTOMATED_COLOR = SERIES_PALETTE[0];
export const AUDIT_COLOR = SERIES_PALETTE[1];
