/**
 * Outgoing commands sent by FyzBit → micro:bit firmware (spec §7.3).
 * All commands are terminated with a single `\n`; protocol is ASCII only.
 */

import type { SamplingHz } from '../state/Settings';

export type SensorName =
  | 'DS18B20'
  | 'HX711'
  | 'HCSR04'
  | 'HX710B'
  | 'DHT11';

export const Commands = {
  /** Re-handshake — micro:bit responds with #HELLO + #CH... + #READY. */
  rehello(): string {
    return '#HELLO?\n';
  },

  /** Zero out the active sensor. */
  tare(): string {
    return '#TARE\n';
  },

  /**
   * Calibrate a channel against a known reference value.
   * `value` uses dot decimal (protocol is locale-independent).
   */
  calibrate(channelId: string, value: number): string {
    if (!channelId) throw new Error('Commands.calibrate: channelId required');
    if (!Number.isFinite(value)) throw new Error('Commands.calibrate: value must be finite');
    return `#CAL;${channelId};${formatNumber(value)}\n`;
  },

  /** Set sampling rate. */
  rate(hz: SamplingHz): string {
    return `#RATE;${hz}\n`;
  },

  /** Force-select a specific sensor. */
  selectSensor(name: SensorName): string {
    return `#SELECT;${name}\n`;
  },

  start(): string {
    return '#START\n';
  },

  stop(): string {
    return '#STOP\n';
  },
} as const;

function formatNumber(n: number): string {
  // Avoid scientific notation for typical calibration ranges; trim trailing zeros.
  const fixed = n.toFixed(6);
  return fixed.replace(/\.?0+$/, '');
}
