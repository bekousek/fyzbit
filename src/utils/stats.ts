import type { Run } from '../state/AppState';

export type BasicStats = {
  min: number;
  max: number;
  avg: number;
  median: number;
  deltaY: number;
};

/** Core min/max/avg/median math shared by the selection panel and PDF export. */
export function computeStats(values: readonly number[]): BasicStats | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const avg = finite.reduce((a, b) => a + b, 0) / finite.length;
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return { min, max, avg, median, deltaY: max - min };
}

/** Stats over an entire run's channel (used by the PDF report). */
export function computeRunChannelStats(run: Run, channelId: string): BasicStats | null {
  const col = run.values[channelId];
  if (!col) return null;
  return computeStats(col);
}

/** Stats over a run's channel restricted to a [tMin, tMax] time window (chart selection). */
export function computeRangeStats(
  run: Run,
  channelId: string,
  tMin: number,
  tMax: number,
): BasicStats | null {
  const col = run.values[channelId];
  if (!col) return null;
  const values: number[] = [];
  for (let i = 0; i < run.times.length; i++) {
    const t = run.times[i];
    if (t === undefined || t < tMin || t > tMax) continue;
    const v = col[i];
    if (v !== undefined) values.push(v);
  }
  return computeStats(values);
}
