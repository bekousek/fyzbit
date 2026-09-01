import { describe, it, expect } from 'vitest';
import { Deriver, planDerivedChannels } from '../src/state/derive';
import type { Channel } from '../src/state/AppState';

const DISTANCE: Channel = { id: 'd', nameKey: 'channel.distance', unit: 'cm' };
const FIRMWARE_SPEED: Channel = { id: 'v', nameKey: 'channel.speed', unit: 'm/s' };
const TEMPERATURE: Channel = { id: 't', nameKey: 'channel.temperature', unit: '°C' };

describe('planDerivedChannels', () => {
  it('adds speed and acceleration to a distance channel', () => {
    const plan = planDerivedChannels([DISTANCE]);
    expect(plan.channels.map((c) => c.id)).toEqual(['d', 'v', 'a']);
    expect(plan.hiddenIds).toEqual(['v', 'a']);
  });

  it('replaces a speed the firmware already reports, rather than duplicating it', () => {
    const plan = planDerivedChannels([DISTANCE, FIRMWARE_SPEED]);
    expect(plan.channels.map((c) => c.id)).toEqual(['d', 'v', 'a']);
    expect(plan.channels.find((c) => c.id === 'v')?.unit).toBe('m/s');
  });

  it('leaves sensors without a position alone', () => {
    const plan = planDerivedChannels([TEMPERATURE]);
    expect(plan.channels).toEqual([TEMPERATURE]);
    expect(plan.specs).toEqual([]);
    expect(plan.hiddenIds).toEqual([]);
  });
});

/** Feeds a motion through the deriver the way App.handleLine does. */
function run(
  hz: number,
  seconds: number,
  position: (t: number) => number,
  quantiseCm = 1,
): { t: number[]; v: number[]; a: number[] } {
  const plan = planDerivedChannels([DISTANCE]);
  const deriver = new Deriver(plan.specs, DISTANCE);
  const out = { t: [] as number[], v: [] as number[], a: [] as number[] };
  const n = Math.round(hz * seconds);
  for (let i = 0; i <= n; i++) {
    const tSec = i / hz;
    const cm = position(tSec) * 100;
    const reported = quantiseCm > 0 ? Math.round(cm / quantiseCm) * quantiseCm : cm;
    const derived = deriver.push(tSec, { d: reported });
    out.t.push(tSec);
    out.v.push(derived.v!);
    out.a.push(derived.a!);
  }
  return out;
}

/** Compares only where the fit has a full window (the longest is 0.8 s). */
function settled(t: number[], values: number[]): { t: number[]; v: number[] } {
  const out = { t: [] as number[], v: [] as number[] };
  for (let i = 0; i < t.length; i++) {
    if (t[i]! >= 1.5 && Number.isFinite(values[i]!)) {
      out.t.push(t[i]!);
      out.v.push(values[i]!);
    }
  }
  return out;
}

function maxAbsError(actual: number[], expected: number[]): number {
  let worst = 0;
  for (let i = 0; i < actual.length; i++) {
    worst = Math.max(worst, Math.abs(actual[i]! - expected[i]!));
  }
  return worst;
}

describe('Deriver', () => {
  it('recovers speed and acceleration of a clean linear motion', () => {
    // x = 0.4 + 0.25·t metres → v = 0.25 m/s, a = 0.
    const r = run(50, 4, (t) => 0.4 + 0.25 * t, 0);
    const v = settled(r.t, r.v);
    const a = settled(r.t, r.a);
    expect(maxAbsError(v.v, v.t.map(() => 0.25))).toBeLessThan(1e-6);
    expect(maxAbsError(a.v, a.t.map(() => 0))).toBeLessThan(1e-6);
  });

  it('recovers constant acceleration', () => {
    // x = 0.3 + 0.1·t + 0.5·1.2·t² → v = 0.1 + 1.2t, a = 1.2 m/s².
    const r = run(50, 3, (t) => 0.3 + 0.1 * t + 0.6 * t * t, 0);
    const a = settled(r.t, r.a);
    expect(maxAbsError(a.v, a.t.map(() => 1.2))).toBeLessThan(1e-6);
  });

  it('tracks a swing without the half-window lag a plain fit would add', () => {
    // A hand swinging ±20 cm at 1.5 rad/s, reported exactly:
    // v = 0.30·cos(wt), a = -0.45·sin(wt), both compared at the sample's own
    // timestamp — a lagging estimator fails this by ~20% however clean the input.
    const A = 0.2;
    const w = 1.5;
    const r = run(50, 10, (t) => 0.5 + A * Math.sin(w * t), 0);
    const v = settled(r.t, r.v);
    const a = settled(r.t, r.a);
    expect(maxAbsError(v.v, v.t.map((t) => A * w * Math.cos(w * t)))).toBeLessThan(0.01);
    expect(maxAbsError(a.v, a.t.map((t) => -A * w * w * Math.sin(w * t)))).toBeLessThan(0.08);
  });

  it('survives the firmware quantising distance to whole centimetres', () => {
    const A = 0.2;
    const w = 1.5;
    const r = run(50, 10, (t) => 0.5 + A * Math.sin(w * t), 1);
    const v = settled(r.t, r.v);
    const a = settled(r.t, r.a);
    const vExpected = v.t.map((t) => A * w * Math.cos(w * t));
    const aExpected = a.t.map((t) => -A * w * w * Math.sin(w * t));
    // Peaks are 0.30 m/s and 0.45 m/s². The two-point difference the firmware
    // used to send has a quantisation step of 0.5 m/s at this rate — larger
    // than the signal — so these bounds are what makes the curve readable.
    expect(maxAbsError(v.v, vExpected)).toBeLessThan(0.1);
    expect(maxAbsError(a.v, aExpected)).toBeLessThan(0.3);
  });

  it('gets markedly better once the firmware reports millimetres', () => {
    const A = 0.2;
    const w = 1.5;
    const coarse = run(50, 10, (t) => 0.5 + A * Math.sin(w * t), 1);
    const fine = run(50, 10, (t) => 0.5 + A * Math.sin(w * t), 0.1);
    const expected = (t: number[]) => t.map((x) => -A * w * w * Math.sin(w * x));
    const coarseA = settled(coarse.t, coarse.a);
    const fineA = settled(fine.t, fine.a);
    expect(maxAbsError(fineA.v, expected(fineA.t))).toBeLessThan(
      maxAbsError(coarseA.v, expected(coarseA.t)),
    );
    expect(maxAbsError(fineA.v, expected(fineA.t))).toBeLessThan(0.15);
  });

  it('reports nothing until the window has real baseline, not just enough points', () => {
    // A cubic fitted to six samples a tenth of a second apart follows the
    // noise exactly and reports absurd acceleration; the guard must suppress
    // those first values rather than draw a spike.
    const A = 0.2;
    const w = 1.5;
    const r = run(50, 10, (t) => 0.5 + A * Math.sin(w * t), 0.1);
    const finite = r.a.filter(Number.isFinite);
    expect(finite.length).toBeGreaterThan(300);
    // Peak acceleration is 0.45 m/s²; nothing anywhere in the run may exceed
    // it by more than the noise budget, start of recording included.
    expect(Math.max(...finite.map(Math.abs))).toBeLessThan(0.75);
  });

  it('waits for a full window before reporting anything', () => {
    const r = run(50, 2, (t) => 0.5 + 0.1 * t, 0);
    expect(Number.isNaN(r.v[0]!)).toBe(true);
    expect(Number.isNaN(r.a[0]!)).toBe(true);
    expect(Number.isFinite(r.v.at(-1)!)).toBe(true);
    expect(Number.isFinite(r.a.at(-1)!)).toBe(true);
  });

  it('reports NaN — a gap, not a wrong number — for a missing reading', () => {
    const plan = planDerivedChannels([DISTANCE]);
    const deriver = new Deriver(plan.specs, DISTANCE);
    for (let i = 0; i < 30; i++) deriver.push(i / 50, { d: 50 + i });
    const gap = deriver.push(30 / 50, {});
    expect(Number.isNaN(gap.v!)).toBe(true);
    expect(Number.isNaN(gap.a!)).toBe(true);
  });

  it('starts the window over when the clock is re-anchored by a new run', () => {
    const plan = planDerivedChannels([DISTANCE]);
    const deriver = new Deriver(plan.specs, DISTANCE);
    // A first run: steady 1 m/s away from the sensor.
    for (let i = 0; i <= 100; i++) deriver.push(i / 50, { d: 100 * (0.5 + 1.0 * (i / 50)) });
    // The next run restarts protocol time at zero, close to the sensor again.
    // Differentiating across that seam would read as a huge negative speed.
    const first = deriver.push(0, { d: 50 });
    expect(Number.isNaN(first.v!)).toBe(true);
    for (let i = 1; i <= 100; i++) deriver.push(i / 50, { d: 100 * (0.5 + 0.25 * (i / 50)) });
    const after = deriver.push(101 / 50, { d: 100 * (0.5 + 0.25 * (101 / 50)) });
    expect(after.v!).toBeCloseTo(0.25, 6);
  });

  it('converts the source unit, so metres in give m/s out', () => {
    const plan = planDerivedChannels([DISTANCE]);
    const inCm = new Deriver(plan.specs, DISTANCE);
    const inMetres = new Deriver(plan.specs, { ...DISTANCE, unit: 'm' });
    let cmResult = NaN;
    let mResult = NaN;
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      cmResult = inCm.push(t, { d: 100 * (0.5 + 0.25 * t) })!.v!;
      mResult = inMetres.push(t, { d: 0.5 + 0.25 * t })!.v!;
    }
    expect(cmResult).toBeCloseTo(0.25, 6);
    expect(mResult).toBeCloseTo(0.25, 6);
  });

  it('keeps working when the rate is low enough to barely fill the window', () => {
    const r = run(10, 4, (t) => 0.5 + 0.2 * Math.sin(1.5 * t), 1);
    const v = settled(r.t, r.v);
    expect(v.v.length).toBeGreaterThan(10);
    expect(v.v.every(Number.isFinite)).toBe(true);
  });
});
