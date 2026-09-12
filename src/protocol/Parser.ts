/**
 * Protocol parser — converts the line-delimited FyzBit protocol (spec §7)
 * into structured events. Pure functions, fully unit-testable.
 *
 *   #HELLO;v1;board=V1
 *   #CH;ID;NAZEV;JEDNOTKA;MIN;MAX
 *   #READY
 *   #TARE;ok | #TARE;err
 *   #CAL;ID;ok;FAKTOR
 *   #ERR;text
 *
 *   t:24.5;h:62.3            (data row — semicolon-separated key:value pairs)
 */

import type { Channel } from '../state/AppState';
import { normalizeUnit } from '../units/units';

export type HelloMessage = {
  type: 'hello';
  protocolVersion: string;
  board: 'V1' | 'V2' | string;
  /** Currently active physical sensor, if the firmware reports one (optional field). */
  sensor?: string;
};

export type ChannelMessage = {
  type: 'channel';
  channel: Channel;
};

export type ReadyMessage = { type: 'ready' };

export type TareMessage = { type: 'tare'; ok: boolean; error?: string };

export type CalibrationMessage = {
  type: 'calibration';
  channelId: string;
  ok: boolean;
  factor?: number;
  /**
   * The scale the firmware held before this calibration, when it reports one.
   * The only honest yardstick for the new factor: the scale is in converter
   * counts per newton or pascal, so what counts as sane is a property of the
   * sensor, not a number near 1.
   */
  previousFactor?: number;
};

export type ErrorMessage = { type: 'error'; message: string };

/**
 * A data row the firmware answered with but could not actually read.
 *
 * The DS18B20 driver returns -Infinity on any failure and older firmware passes
 * it through untouched, so `t:-Infinity` is a sensor fault reported in the only
 * way a data row can report one. Treating it as a malformed line made a probe
 * that never reads look exactly like a working one with nothing to say.
 *
 * Only an infinite value counts. A value that is merely unparseable is a
 * protocol fault, not a sensor one, and stays `unknown`.
 */
export type SensorErrorMessage = {
  type: 'sensor-error';
  /** Channel ids the firmware answered for but could not read. */
  channelIds: string[];
};

export type DataMessage = {
  type: 'data';
  values: Record<string, number>;
};

export type UnknownMessage = { type: 'unknown'; raw: string };

export type ParsedMessage =
  | HelloMessage
  | ChannelMessage
  | ReadyMessage
  | TareMessage
  | CalibrationMessage
  | ErrorMessage
  | DataMessage
  | SensorErrorMessage
  | UnknownMessage;

/** Channel ID → i18n nameKey. Falls back to lowercased English from the wire. */
const CHANNEL_NAME_TO_KEY: Record<string, string> = {
  Temperature: 'channel.temperature',
  Humidity: 'channel.humidity',
  Force: 'channel.force',
  Distance: 'channel.distance',
  Speed: 'channel.speed',
  Pressure: 'channel.pressure',
};

export function parseLine(rawLine: string): ParsedMessage {
  const line = rawLine.trim();
  if (line === '') return { type: 'unknown', raw: rawLine };

  if (line.startsWith('#')) return parseControl(line);
  return parseData(line);
}

function parseControl(line: string): ParsedMessage {
  const parts = line.split(';');
  const head = parts[0] ?? '';

  switch (head) {
    case '#HELLO': {
      // #HELLO;v1;board=V1[;sensor=DS18B20]
      const proto = parts[1] ?? '';
      const boardPart = parts[2] ?? '';
      const board = boardPart.startsWith('board=') ? boardPart.slice('board='.length) : '';
      const sensorPart = parts[3] ?? '';
      const msg: HelloMessage = { type: 'hello', protocolVersion: proto, board };
      if (sensorPart.startsWith('sensor=')) msg.sensor = sensorPart.slice('sensor='.length);
      return msg;
    }
    case '#CH': {
      // #CH;ID;NAZEV;JEDNOTKA;MIN;MAX  (min/max optional)
      const id = parts[1] ?? '';
      const wireName = parts[2] ?? '';
      const unit = normalizeUnit(parts[3] ?? '');
      const min = parseOptionalFloat(parts[4]);
      const max = parseOptionalFloat(parts[5]);
      if (!id || !wireName) return { type: 'unknown', raw: line };
      const nameKey =
        CHANNEL_NAME_TO_KEY[wireName] ?? `channel.${wireName.toLowerCase()}`;
      const channel: Channel = { id, nameKey, unit };
      if (min !== undefined) channel.min = min;
      if (max !== undefined) channel.max = max;
      return { type: 'channel', channel };
    }
    case '#READY':
      return { type: 'ready' };
    case '#TARE': {
      const status = parts[1] ?? '';
      if (status === 'ok') return { type: 'tare', ok: true };
      return { type: 'tare', ok: false, error: parts[2] };
    }
    case '#CAL': {
      // #CAL;ID;ok;FAKTOR[;PREDCHOZI]  or  #CAL;ID;err;msg
      const channelId = parts[1] ?? '';
      const status = parts[2] ?? '';
      if (status === 'ok') {
        const factor = parseOptionalFloat(parts[3]);
        const previousFactor = parseOptionalFloat(parts[4]);
        const msg: CalibrationMessage = { type: 'calibration', channelId, ok: true };
        if (factor !== undefined) msg.factor = factor;
        if (previousFactor !== undefined) msg.previousFactor = previousFactor;
        return msg;
      }
      return { type: 'calibration', channelId, ok: false };
    }
    case '#ERR':
      return { type: 'error', message: parts.slice(1).join(';') };
    default:
      return { type: 'unknown', raw: line };
  }
}

function parseData(line: string): ParsedMessage {
  const values: Record<string, number> = {};
  const unreadable: string[] = [];
  let hasAny = false;
  for (const pair of line.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim();
    if (!key) continue;
    const raw = trimmed.slice(colon + 1).trim();
    const value = Number(raw);
    if (Number.isFinite(value)) {
      values[key] = value;
      hasAny = true;
      continue;
    }
    // Infinity specifically, and not merely "not a number": that is the
    // driver's -Infinity sentinel arriving as MakeCode renders it. NaN means a
    // malformed number — a decimal comma, say — which is a protocol fault and
    // says nothing about the probe.
    if (value === Infinity || value === -Infinity) unreadable.push(key);
  }
  // One real reading is enough to call the row data: no sensor reports a
  // readable and an unreadable channel in the same row, and if one ever did,
  // the number is worth more than the complaint.
  if (hasAny) return { type: 'data', values };
  if (unreadable.length > 0) return { type: 'sensor-error', channelIds: unreadable };
  return { type: 'unknown', raw: line };
}

function parseOptionalFloat(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * LineBuffer — accumulates raw bytes/strings from a transport and emits
 * complete `\n`-terminated lines via a callback. Handles \r\n.
 */
export class LineBuffer {
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.onLine(line);
    }
  }

  reset(): void {
    this.buffer = '';
  }
}
