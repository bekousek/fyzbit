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

export const SENSOR_NAMES: readonly SensorName[] = [
  'DS18B20',
  'HX711',
  'HCSR04',
  'HX710B',
  'DHT11',
];

/**
 * How fast it is worth asking each sensor to stream, used when the sampling
 * rate is left on "auto" (the default).
 *
 * These are properties of the hardware, not preferences. A DS18B20 spends
 * ~750 ms on a single 12-bit conversion and a DHT11 refuses to be read more
 * than about twice a second, so asking either for 10 Hz just returns the same
 * number ten times. An HC-SR04 ping, by contrast, is over in a few
 * milliseconds — and motion is exactly the thing you cannot reconstruct from
 * slow samples, so it gets everything the firmware can deliver.
 */
export const RECOMMENDED_RATE_HZ: Record<SensorName, SamplingHz> = {
  DS18B20: 1,
  DHT11: 1,
  HX711: 10,
  HX710B: 10,
  HCSR04: 50,
};

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
