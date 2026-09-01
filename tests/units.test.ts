import { describe, it, expect, beforeEach } from 'vitest';
import {
  convert,
  displayUnit,
  initUnits,
  normalizeUnit,
  setDisplayUnit,
  unitDecimals,
  unitOptionsFor,
} from '../src/units/units';
import { parseLine } from '../src/protocol/Parser';

describe('normalizeUnit', () => {
  it('repairs the degree sign MakeCode mangles into "?"', () => {
    // The firmware literal "°C" reaches us as "?C" — see src/units/units.ts.
    expect(normalizeUnit('?C')).toBe('°C');
    expect(normalizeUnit('�C')).toBe('°C');
  });

  it('accepts the ASCII spelling the firmware now sends', () => {
    expect(normalizeUnit('degC')).toBe('°C');
  });

  it('leaves already-correct units alone', () => {
    expect(normalizeUnit('°C')).toBe('°C');
    expect(normalizeUnit('cm')).toBe('cm');
    expect(normalizeUnit(' m/s ')).toBe('m/s');
    expect(normalizeUnit('%')).toBe('%');
  });

  it('canonicalises ASCII acceleration spellings', () => {
    expect(normalizeUnit('m/s2')).toBe('m/s²');
    expect(normalizeUnit('m/s^2')).toBe('m/s²');
  });
});

describe('parseLine + normalizeUnit', () => {
  it('gives the channel a real degree sign whichever spelling arrives', () => {
    for (const wire of ['degC', '?C', '°C']) {
      const msg = parseLine(`#CH;t;Temperature;${wire};-40;125`);
      expect(msg.type).toBe('channel');
      if (msg.type === 'channel') expect(msg.channel.unit).toBe('°C');
    }
  });
});

describe('convert', () => {
  it('scales within the length family', () => {
    expect(convert(250, 'cm', 'm')).toBeCloseTo(2.5, 10);
    expect(convert(250, 'cm', 'mm')).toBeCloseTo(2500, 10);
    expect(convert(2.5, 'm', 'cm')).toBeCloseTo(250, 10);
  });

  it('scales within the speed family', () => {
    expect(convert(10, 'm/s', 'km/h')).toBeCloseTo(36, 10);
    expect(convert(36, 'km/h', 'm/s')).toBeCloseTo(10, 10);
  });

  it('applies temperature offsets, not just factors', () => {
    expect(convert(0, '°C', 'K')).toBeCloseTo(273.15, 10);
    expect(convert(100, '°C', '°F')).toBeCloseTo(212, 10);
    expect(convert(-40, '°C', '°F')).toBeCloseTo(-40, 10);
    expect(convert(212, '°F', '°C')).toBeCloseTo(100, 10);
  });

  it('round-trips', () => {
    for (const [from, to, v] of [
      ['cm', 'mm', 37.5],
      ['m/s', 'km/h', -2.4],
      ['Pa', 'kPa', 101325],
      ['N', 'mN', 0.25],
      ['°C', 'K', 21.5],
    ] as const) {
      expect(convert(convert(v, from, to), to, from)).toBeCloseTo(v, 8);
    }
  });

  it('passes through unknown units and cross-family pairs untouched', () => {
    expect(convert(5, '%', 'cm')).toBe(5);
    expect(convert(5, 'cm', 'm/s')).toBe(5);
    expect(convert(5, 'blorp', 'cm')).toBe(5);
  });

  it('leaves NaN alone rather than turning it into a number', () => {
    expect(convert(NaN, 'cm', 'm')).toBeNaN();
  });
});

describe('unit options', () => {
  it('offers alternatives only where they exist', () => {
    expect(unitOptionsFor('cm').map((u) => u.id)).toEqual(['mm', 'cm', 'm']);
    expect(unitOptionsFor('%')).toEqual([]);
  });

  it('suggests fewer decimals for coarser units', () => {
    expect(unitDecimals('mm')).toBeLessThan(unitDecimals('m'));
  });
});

describe('display-unit preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    initUnits();
  });

  it('defaults to the unit the firmware reported', () => {
    expect(displayUnit('cm')).toBe('cm');
  });

  it('applies to the whole family, not one channel', () => {
    setDisplayUnit('cm', 'm');
    expect(displayUnit('cm')).toBe('m');
    expect(displayUnit('mm')).toBe('m');
    expect(displayUnit('m/s')).toBe('m/s');
  });

  it('survives a reload', () => {
    setDisplayUnit('m/s', 'km/h');
    initUnits();
    expect(displayUnit('m/s')).toBe('km/h');
  });

  it('ignores a unit from another family', () => {
    setDisplayUnit('cm', 'km/h');
    expect(displayUnit('cm')).toBe('cm');
  });

  it('falls back to base units when the stored value is corrupt', () => {
    localStorage.setItem('fyzbit.units', '{not json');
    initUnits();
    expect(displayUnit('cm')).toBe('cm');
  });
});
