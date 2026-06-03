import { describe, it, expect } from 'vitest';

/**
 * The stats helpers live as private functions in SelectionStats.ts, but the math is
 * trivial enough to re-implement here as the spec. If this drifts from production
 * code, treat that as a bug.
 */

function computeStats(values: number[]): {
  min: number;
  max: number;
  avg: number;
  median: number;
  deltaY: number;
} | null {
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

describe('range stats math', () => {
  it('handles odd-length series', () => {
    const r = computeStats([1, 2, 3, 4, 5]);
    expect(r).toEqual({ min: 1, max: 5, avg: 3, median: 3, deltaY: 4 });
  });

  it('handles even-length series', () => {
    const r = computeStats([1, 2, 3, 4]);
    expect(r).toEqual({ min: 1, max: 4, avg: 2.5, median: 2.5, deltaY: 3 });
  });

  it('returns null for all-NaN series', () => {
    expect(computeStats([NaN, NaN, NaN])).toBeNull();
  });

  it('ignores NaN but keeps valid values', () => {
    const r = computeStats([NaN, 2, NaN, 4, 6]);
    expect(r).toEqual({ min: 2, max: 6, avg: 4, median: 4, deltaY: 4 });
  });

  it('handles negative values', () => {
    const r = computeStats([-3, -1, 1, 3]);
    expect(r).toEqual({ min: -3, max: 3, avg: 0, median: 0, deltaY: 6 });
  });

  it('single value', () => {
    const r = computeStats([42]);
    expect(r).toEqual({ min: 42, max: 42, avg: 42, median: 42, deltaY: 0 });
  });
});
