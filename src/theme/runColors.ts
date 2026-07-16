import { cssVar } from './theme';

const PALETTE_SIZE = 8;

/** Fallback if a --chart-series-N var is somehow unset (matches theme-light.css). */
const FALLBACK: readonly string[] = [
  '#1b5e20',
  '#1565c0',
  '#c62828',
  '#ef6c00',
  '#6a1b9a',
  '#00838f',
  '#558b2f',
  '#ad1457',
];

/**
 * Resolve a run's color from the active theme's --chart-series-N custom
 * properties (theme-light.css / theme-dark.css), cycling through the palette.
 * Single source of truth for run colors — avoids the light-mode-only hardcoded
 * hexes clashing with dark backgrounds.
 */
export function runColorForIndex(index: number): string {
  const n = ((index % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return cssVar(`--chart-series-${n + 1}`) || FALLBACK[n]!;
}
