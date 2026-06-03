import { describe, it, expect } from 'vitest';
import { Commands } from '../src/protocol/Commands';

describe('Commands', () => {
  it('rehello', () => {
    expect(Commands.rehello()).toBe('#HELLO?\n');
  });

  it('tare', () => {
    expect(Commands.tare()).toBe('#TARE\n');
  });

  it('start/stop', () => {
    expect(Commands.start()).toBe('#START\n');
    expect(Commands.stop()).toBe('#STOP\n');
  });

  it('rate', () => {
    expect(Commands.rate(10)).toBe('#RATE;10\n');
    expect(Commands.rate(50)).toBe('#RATE;50\n');
  });

  it('selectSensor', () => {
    expect(Commands.selectSensor('DS18B20')).toBe('#SELECT;DS18B20\n');
    expect(Commands.selectSensor('HX711')).toBe('#SELECT;HX711\n');
  });

  it('calibrate uses dot decimal regardless of locale', () => {
    expect(Commands.calibrate('t', 1.05)).toBe('#CAL;t;1.05\n');
    expect(Commands.calibrate('p', 101325)).toBe('#CAL;p;101325\n');
    expect(Commands.calibrate('F', -0.5)).toBe('#CAL;F;-0.5\n');
  });

  it('calibrate trims trailing zeros', () => {
    expect(Commands.calibrate('t', 1.5)).toBe('#CAL;t;1.5\n');
    expect(Commands.calibrate('t', 1)).toBe('#CAL;t;1\n');
  });

  it('calibrate rejects empty channelId', () => {
    expect(() => Commands.calibrate('', 1)).toThrow();
  });

  it('calibrate rejects non-finite values', () => {
    expect(() => Commands.calibrate('t', NaN)).toThrow();
    expect(() => Commands.calibrate('t', Infinity)).toThrow();
  });
});
