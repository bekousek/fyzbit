import { describe, it, expect } from 'vitest';
import { parseLine, LineBuffer } from '../src/protocol/Parser';

describe('parseLine — control messages', () => {
  it('parses #HELLO with V1 board', () => {
    expect(parseLine('#HELLO;v1;board=V1')).toEqual({
      type: 'hello',
      protocolVersion: 'v1',
      board: 'V1',
    });
  });

  it('parses #HELLO with V2 board', () => {
    expect(parseLine('#HELLO;v1;board=V2')).toEqual({
      type: 'hello',
      protocolVersion: 'v1',
      board: 'V2',
    });
  });

  it('parses #CH with min/max and maps name to i18n key', () => {
    expect(parseLine('#CH;t;Temperature;°C;-40;125')).toEqual({
      type: 'channel',
      channel: {
        id: 't',
        nameKey: 'channel.temperature',
        unit: '°C',
        min: -40,
        max: 125,
      },
    });
  });

  it('parses #CH without min/max', () => {
    expect(parseLine('#CH;h;Humidity;%')).toEqual({
      type: 'channel',
      channel: { id: 'h', nameKey: 'channel.humidity', unit: '%' },
    });
  });

  it('falls back to lowercased channel name for unknown channels', () => {
    expect(parseLine('#CH;x;Brightness;lx')).toEqual({
      type: 'channel',
      channel: { id: 'x', nameKey: 'channel.brightness', unit: 'lx' },
    });
  });

  it('rejects #CH missing required parts', () => {
    expect(parseLine('#CH;t').type).toBe('unknown');
    expect(parseLine('#CH;;Temperature;°C').type).toBe('unknown');
  });

  it('parses #READY', () => {
    expect(parseLine('#READY')).toEqual({ type: 'ready' });
  });

  it('parses #TARE;ok', () => {
    expect(parseLine('#TARE;ok')).toEqual({ type: 'tare', ok: true });
  });

  it('parses #TARE;err with optional message', () => {
    expect(parseLine('#TARE;err;noise')).toEqual({
      type: 'tare',
      ok: false,
      error: 'noise',
    });
  });

  it('parses #CAL;ID;ok;FAKTOR', () => {
    expect(parseLine('#CAL;t;ok;1.05')).toEqual({
      type: 'calibration',
      channelId: 't',
      ok: true,
      factor: 1.05,
    });
  });

  it('parses #CAL failure without factor', () => {
    expect(parseLine('#CAL;t;err;timeout')).toEqual({
      type: 'calibration',
      channelId: 't',
      ok: false,
    });
  });

  it('parses #ERR with message', () => {
    expect(parseLine('#ERR;Sensor not detected')).toEqual({
      type: 'error',
      message: 'Sensor not detected',
    });
  });

  it('returns unknown for unrecognized control words', () => {
    expect(parseLine('#WAT;hello').type).toBe('unknown');
  });
});

describe('parseLine — data rows', () => {
  it('parses single-channel data', () => {
    expect(parseLine('t:24.5')).toEqual({
      type: 'data',
      values: { t: 24.5 },
    });
  });

  it('parses multi-channel data', () => {
    expect(parseLine('t:24.5;h:62.3')).toEqual({
      type: 'data',
      values: { t: 24.5, h: 62.3 },
    });
  });

  it('parses negative and decimal values', () => {
    expect(parseLine('F:-1.25;p:101325')).toEqual({
      type: 'data',
      values: { F: -1.25, p: 101325 },
    });
  });

  it('tolerates trailing semicolon', () => {
    expect(parseLine('t:24.5;')).toEqual({
      type: 'data',
      values: { t: 24.5 },
    });
  });

  it('skips NaN-producing tokens but keeps valid ones', () => {
    expect(parseLine('t:24.5;h:NaN;p:101325')).toEqual({
      type: 'data',
      values: { t: 24.5, p: 101325 },
    });
  });

  it('returns unknown for empty data row', () => {
    expect(parseLine('').type).toBe('unknown');
    expect(parseLine(';;;;').type).toBe('unknown');
  });

  it('returns unknown for data row with no colons', () => {
    expect(parseLine('garbage').type).toBe('unknown');
  });

  it('treats decimal comma as invalid (protocol uses dot)', () => {
    // "24,5" parses as NaN via Number('24,5') → no values → unknown
    expect(parseLine('t:24,5').type).toBe('unknown');
  });
});

describe('LineBuffer', () => {
  it('emits lines split by \\n', () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.push('hello\nworld\n');
    expect(lines).toEqual(['hello', 'world']);
  });

  it('handles CRLF line endings', () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.push('a\r\nb\r\n');
    expect(lines).toEqual(['a', 'b']);
  });

  it('buffers partial chunks until \\n arrives', () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.push('hel');
    buf.push('lo\nwor');
    expect(lines).toEqual(['hello']);
    buf.push('ld\n');
    expect(lines).toEqual(['hello', 'world']);
  });

  it('handles many lines in a single chunk', () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.push('#HELLO;v1;board=V1\n#CH;t;Temperature;°C;-40;125\n#READY\nt:24.5\n');
    expect(lines).toEqual([
      '#HELLO;v1;board=V1',
      '#CH;t;Temperature;°C;-40;125',
      '#READY',
      't:24.5',
    ]);
  });

  it('reset() clears the buffer', () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.push('partial');
    buf.reset();
    buf.push('done\n');
    expect(lines).toEqual(['done']);
  });
});
