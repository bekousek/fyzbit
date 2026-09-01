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
 * Resolve a color from the active theme's --chart-series-N custom properties
 * (theme-light.css / theme-dark.css), cycling through the palette. Single
 * source of truth for chart colors — avoids the light-mode-only hardcoded
 * hexes clashing with dark backgrounds.
 */
function paletteColor(index: number): string {
  const n = ((index % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return cssVar(`--chart-series-${n + 1}`) || FALLBACK[n]!;
}

/** Color identifying a run (its dot in the runs list, its lines on the chart). */
export function runColorForIndex(index: number): string {
  return paletteColor(index);
}

/**
 * Color identifying a measured quantity (distance vs. speed vs. …). Shares the
 * palette with runs on purpose: only one of the two schemes is ever on the
 * chart at a time — see Chart.buildAlignedData().
 */
export function channelColorForIndex(index: number): string {
  return paletteColor(index);
}
