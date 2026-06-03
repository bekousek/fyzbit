/// <reference lib="dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { buildRunsCsv, buildAnnotationsCsv } from '../src/export/csv';
import type { Run, Channel } from '../src/state/AppState';
import { initI18n, setLanguage } from '../src/i18n/i18n';

const TEMP_CH: Channel = { id: 't', nameKey: 'channel.temperature', unit: '°C' };

function makeRun(name: string, points: Array<[number, number]>): Run {
  return {
    id: name,
    name,
    startedAt: 0,
    active: false,
    visible: true,
    color: '#000',
    channels: [TEMP_CH],
    samplingHz: 10,
    times: points.map((p) => p[0]),
    values: { t: points.map((p) => p[1]) },
    annotations: [],
  };
}

beforeEach(() => {
  // jsdom provides localStorage; reset and init.
  localStorage.clear();
  initI18n();
});

describe('buildRunsCsv', () => {
  it('starts with BOM and sep=;', () => {
    const csv = buildRunsCsv({ runs: [], channels: [TEMP_CH] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).startsWith('sep=;')).toBe(true);
  });

  it('uses comma decimals in CZ', () => {
    setLanguage('cs');
    const run = makeRun('Měření 1', [
      [0, 24.5],
      [1, 24.7],
    ]);
    const csv = buildRunsCsv({ runs: [run], channels: [TEMP_CH] });
    expect(csv).toContain('0,000;24,500');
    expect(csv).toContain('1,000;24,700');
    expect(csv).toContain('Měření 1');
  });

  it('uses dot decimals in EN', () => {
    setLanguage('en');
    const run = makeRun('Run 1', [
      [0, 24.5],
      [1, 24.7],
    ]);
    const csv = buildRunsCsv({ runs: [run], channels: [TEMP_CH] });
    expect(csv).toContain('0.000;24.500');
    expect(csv).toContain('1.000;24.700');
  });

  it('merges multiple runs side by side, NaN where missing', () => {
    setLanguage('en');
    const r1 = makeRun('Run 1', [
      [0, 20],
      [1, 21],
    ]);
    const r2 = makeRun('Run 2', [
      [0, 30],
      [2, 32],
    ]);
    const csv = buildRunsCsv({ runs: [r1, r2], channels: [TEMP_CH] });
    // Header should mention both runs.
    expect(csv).toMatch(/Run 1 - Temperature/);
    expect(csv).toMatch(/Run 2 - Temperature/);
    // At t=1, only Run 1 has value → Run 2 column empty.
    const lines = csv.split('\n');
    const dataLines = lines.slice(2).filter((l) => l && !l.startsWith('Time'));
    const line1 = dataLines.find((l) => l.startsWith('1.000'));
    expect(line1).toBeTruthy();
    expect(line1!).toBe('1.000;21.000;');
  });

  it('produces only header + BOM + sep when no runs', () => {
    const csv = buildRunsCsv({ runs: [], channels: [TEMP_CH] });
    expect(csv.split('\n').filter((l) => l).length).toBeLessThanOrEqual(2);
  });
});

describe('buildAnnotationsCsv', () => {
  it('emits header even when no annotations', () => {
    const csv = buildAnnotationsCsv({ runs: [], channels: [TEMP_CH] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // Strip BOM, then filter out empty + sep=; lines. Should leave one header row.
    const body = csv.slice(1).split('\n').filter((l) => l && !l.startsWith('sep='));
    expect(body.length).toBe(1);
  });

  it('emits annotations from each run with run name', () => {
    setLanguage('cs');
    const r1 = makeRun('M1', []);
    r1.annotations.push({ t: 12.3, label: 'Začal jsem ohřívat' });
    const r2 = makeRun('M2', []);
    r2.annotations.push({ t: 5, label: 'Voda začala vřít' });
    const csv = buildAnnotationsCsv({ runs: [r1, r2], channels: [TEMP_CH] });
    expect(csv).toMatch(/12,300;M1;Začal jsem ohřívat/);
    expect(csv).toMatch(/5,000;M2;Voda začala vřít/);
  });

  it('escapes fields containing separators', () => {
    setLanguage('en');
    const r = makeRun('R', []);
    r.annotations.push({ t: 1, label: 'A; B' });
    const csv = buildAnnotationsCsv({ runs: [r], channels: [TEMP_CH] });
    expect(csv).toContain('"A; B"');
  });
});
