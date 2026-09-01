import type { Channel } from './AppState';
import { convert, unitFamilyFor } from '../units/units';

/**
 * Speed and acceleration derived from a measured position.
 *
 * The sonar firmware does send a `v`, but it is a two-point difference of a
 * signal quantised to whole centimetres — at 30 Hz that is a ±0.3 m/s stair
 * pattern, which hides exactly the position↔speed relationship the channel
 * exists to show. So the app derives both here instead, by fitting a
 * polynomial to a short sliding window (the standard trick in motion
 * detectors): the fit averages the quantisation away without the phase shift
 * a moving-average filter would add.
 *
 * Two details matter more than they look:
 *
 * 1. The fit is one degree higher than the derivative wanted (quadratic for
 *    speed, cubic for acceleration) and is evaluated at the newest sample.
 *    Fitting exactly to order would make the derivative constant across the
 *    window, i.e. the value at its *centre* — half a window late. On a 0.5 s
 *    window that is a fifth of a swing, and a velocity curve shifted against
 *    the position curve is precisely the misreading this feature exists to
 *    prevent.
 * 2. Acceleration gets the longer window. A second derivative amplifies noise
 *    by roughly 1/T², so it needs the baseline; velocity does not. Past about
 *    a second the cubic stops following real motion and starts flattening the
 *    peaks instead, so the window cannot simply grow until the noise is gone.
 *
 * Acceleration stays the noisiest of the three by some way, and how noisy
 * depends mostly on the resolution of the incoming distance: a firmware
 * reporting whole centimetres roughly doubles the error of one reporting
 * millimetres.
 */
const VELOCITY_WINDOW_S = 0.3;
const ACCELERATION_WINDOW_S = 0.8;
const MIN_VELOCITY_POINTS = 4;
const MIN_ACCELERATION_POINTS = 6;
/** Fraction of the window that must actually be covered before fitting. */
const MIN_WINDOW_FILL = 0.6;
/** Guards the window against a firmware streaming far faster than we expect. */
const MAX_WINDOW_POINTS = 256;

export type DerivedSpec = {
  channel: Channel;
  /** Channel the value is computed from. */
  sourceId: string;
  /** 1 = first derivative (speed), 2 = second (acceleration). */
  order: 1 | 2;
};

const SPEED_CHANNEL: Channel = { id: 'v', nameKey: 'channel.speed', unit: 'm/s' };
const ACCELERATION_CHANNEL: Channel = {
  id: 'a',
  nameKey: 'channel.acceleration',
  unit: 'm/s²',
};

/**
 * Works out which channels the app adds on top of what the firmware announced.
 *
 * Any firmware channel whose id a derived one takes over is dropped, so a
 * board still running an older build doesn't end up with two "Rychlost" rows.
 */
export function planDerivedChannels(channels: readonly Channel[]): {
  channels: Channel[];
  specs: DerivedSpec[];
  /** Derived ids, which start switched off — the measured quantity is the point. */
  hiddenIds: string[];
} {
  const position = channels.find((c) => unitFamilyFor(c.unit)?.id === 'length');
  if (!position) return { channels: [...channels], specs: [], hiddenIds: [] };

  const specs: DerivedSpec[] = [
    { channel: SPEED_CHANNEL, sourceId: position.id, order: 1 },
    { channel: ACCELERATION_CHANNEL, sourceId: position.id, order: 2 },
  ];
  const derivedIds = new Set(specs.map((s) => s.channel.id));
  return {
    channels: [
      ...channels.filter((c) => !derivedIds.has(c.id)),
      ...specs.map((s) => s.channel),
    ],
    specs,
    hiddenIds: [...derivedIds],
  };
}

/** Rolling-window differentiator fed one sample at a time. */
export class Deriver {
  private times: number[] = [];
  private values: number[] = [];
  private readonly sourceId: string;
  private readonly sourceUnit: string;

  constructor(
    private readonly specs: readonly DerivedSpec[],
    sourceChannel: Channel,
  ) {
    this.sourceId = sourceChannel.id;
    this.sourceUnit = sourceChannel.unit;
  }

  reset(): void {
    this.times = [];
    this.values = [];
  }

  /**
   * Feed one sample; returns the derived values for it. Missing or
   * non-finite source readings yield NaN, which the chart draws as a gap
   * rather than a line through nowhere.
   */
  push(tSec: number, values: Readonly<Record<string, number>>): Record<string, number> {
    const raw = values[this.sourceId];
    const out: Record<string, number> = {};
    if (raw === undefined || !Number.isFinite(raw)) {
      for (const spec of this.specs) out[spec.channel.id] = NaN;
      return out;
    }

    // A timestamp older than the last one means the clock was re-anchored
    // under us (a new run). Differentiating across that seam would produce a
    // spike of essentially unbounded size, so start the window over.
    const previous = this.times[this.times.length - 1];
    if (previous !== undefined && tSec <= previous) this.reset();

    // Everything is differentiated in metres, so the results land in the
    // m/s and m/s² base units the derived channels declare.
    this.times.push(tSec);
    this.values.push(convert(raw, this.sourceUnit, 'm'));
    const longest = Math.max(VELOCITY_WINDOW_S, ACCELERATION_WINDOW_S);
    while (
      this.times.length > MAX_WINDOW_POINTS ||
      (this.times.length > 2 && tSec - this.times[0]! > longest)
    ) {
      this.times.shift();
      this.values.shift();
    }

    for (const spec of this.specs) {
      out[spec.channel.id] =
        spec.order === 1
          ? this.fit(VELOCITY_WINDOW_S, MIN_VELOCITY_POINTS, 1)
          : this.fit(ACCELERATION_WINDOW_S, MIN_ACCELERATION_POINTS, 2);
    }
    return out;
  }

  /**
   * Least-squares fit over the trailing `windowS` seconds, differentiated at
   * the newest sample. See the note at the top of the file for why the fit is
   * one degree above the derivative asked for.
   */
  private fit(windowS: number, minPoints: number, order: 1 | 2): number {
    const n = this.times.length;
    const tLast = this.times[n - 1]!;
    let start = n;
    while (start > 0 && tLast - this.times[start - 1]! <= windowS) start--;
    // Enough points *and* enough baseline. A cubic through six samples spanning
    // a tenth of a second is a perfect fit to the noise and nothing else — that
    // is where the wild spike at the start of a recording came from.
    if (n - start < minPoints) return NaN;
    if (tLast - this.times[start]! < windowS * MIN_WINDOW_FILL) return NaN;

    // Scale time to u ∈ [-1, 0] with the newest sample at u = 0: the
    // derivative then falls straight out of the coefficients, and the normal
    // equations stay well conditioned however long the recording has run.
    const u: number[] = [];
    const y: number[] = [];
    for (let i = start; i < n; i++) {
      u.push((this.times[i]! - tLast) / windowS);
      y.push(this.values[i]!);
    }
    const coefficients = polyFit(u, y, order + 1);
    if (!coefficients) return NaN;
    // d/dt = (d/du)/windowS, applied `order` times.
    return order === 1
      ? coefficients[1]! / windowS
      : (2 * coefficients[2]!) / (windowS * windowS);
  }
}

/**
 * Least-squares polynomial coefficients c₀…c_degree for y ≈ Σ cₖuᵏ, via the
 * normal equations. Degrees here are 2 or 3, so a direct solve is both the
 * simplest and the fastest option. Returns null if the system is singular
 * (fewer distinct u values than coefficients).
 */
function polyFit(u: number[], y: number[], degree: number): number[] | null {
  const size = degree + 1;
  const powerSums = new Array<number>(2 * degree + 1).fill(0);
  const moments = new Array<number>(size).fill(0);
  for (let i = 0; i < u.length; i++) {
    let p = 1;
    for (let k = 0; k <= 2 * degree; k++) {
      powerSums[k]! += p;
      if (k < size) moments[k]! += p * y[i]!;
      p *= u[i]!;
    }
  }
  const matrix: number[][] = [];
  for (let row = 0; row < size; row++) {
    const line = new Array<number>(size + 1);
    for (let col = 0; col < size; col++) line[col] = powerSums[row + col]!;
    line[size] = moments[row]!;
    matrix.push(line);
  }
  return solveInPlace(matrix, size);
}

/** Gauss-Jordan with partial pivoting on an augmented matrix; null if singular. */
function solveInPlace(m: number[][], size: number): number[] | null {
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-14) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const pivotValue = m[col]![col]!;
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const factor = m[row]![col]! / pivotValue;
      if (factor === 0) continue;
      for (let k = col; k <= size; k++) m[row]![k]! -= factor * m[col]![k]!;
    }
  }
  return Array.from({ length: size }, (_, i) => m[i]![size]! / m[i]![i]!);
}
