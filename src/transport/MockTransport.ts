import type { Transport } from './Transport';
import { SENSOR_NAMES, type SensorName } from '../protocol/Commands';

const CHANNELS: Record<SensorName, string[]> = {
  DS18B20: ['#CH;t;Temperature;°C;-40;125'],
  HX711: ['#CH;F;Force;N;-200;200'],
  // Distance only — speed and acceleration are the app's job now (see
  // state/derive.ts), exactly as with the real firmware.
  HCSR04: ['#CH;d;Distance;cm;0;400'],
  HX710B: ['#CH;p;Pressure;Pa;0;200000'],
  DHT11: ['#CH;t;Temperature;°C;-20;60', '#CH;h;Humidity;%;0;100'],
};

/**
 * MockTransport — simulates a micro:bit V1 with a switchable sensor.
 *
 * On connect (and after #SELECT), emits a valid FyzBit protocol handshake:
 *   #HELLO;v1;board=V1;sensor=<name>
 *   #CH;...  (one or more, depending on sensor)
 *   #READY
 * Then streams simulated data lines for the active sensor at 10 Hz.
 *
 * Used for development and demos before any micro:bit firmware is flashed,
 * and will also serve as the protocol parser's primary test fixture (M2).
 */
export class MockTransport implements Transport {
  private connected = false;
  private chunkHandlers = new Set<(chunk: string) => void>();
  private disconnectHandlers = new Set<() => void>();
  private dataTimer: number | null = null;
  private streaming = true;
  private startMs = 0;
  private currentSensor: SensorName = 'DS18B20';
  private sampleHz = 10;

  async connect(): Promise<void> {
    if (this.connected) return;
    // Simulate handshake delay.
    await sleep(200);
    this.connected = true;
    this.startMs = performance.now();

    this.sendHandshake();
    this.startStreaming();
  }

  private startStreaming(): void {
    if (this.dataTimer !== null) clearInterval(this.dataTimer);
    this.dataTimer = window.setInterval(
      () => {
        if (!this.connected || !this.streaming) return;
        this.emitData();
      },
      Math.round(1000 / this.sampleHz),
    );
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    if (this.dataTimer !== null) {
      clearInterval(this.dataTimer);
      this.dataTimer = null;
    }
    this.disconnectHandlers.forEach((h) => {
      try {
        h();
      } catch (err) {
        console.error('[MockTransport] disconnect handler threw:', err);
      }
    });
  }

  async send(data: string): Promise<void> {
    if (!this.connected) return;
    // Recognize a minimal subset of commands so dev can exercise UI.
    const line = data.trim();
    if (line === '#STOP') this.streaming = false;
    else if (line === '#START') this.streaming = true;
    else if (line === '#TARE') this.emit('#TARE;ok');
    else if (line.startsWith('#RATE;')) {
      const hz = Number(line.slice('#RATE;'.length));
      if ([1, 5, 10, 25, 50].includes(hz)) {
        this.sampleHz = hz;
        if (this.connected) this.startStreaming();
      }
    }
    else if (line.startsWith('#CAL;')) {
      const parts = line.split(';');
      this.emit(`#CAL;${parts[1] ?? 't'};ok;1.0`);
    } else if (line === '#HELLO?') {
      this.sendHandshake();
    } else if (line.startsWith('#SELECT;')) {
      const name = line.slice('#SELECT;'.length) as SensorName;
      if (SENSOR_NAMES.includes(name) && name !== this.currentSensor) {
        this.currentSensor = name;
        this.sendHandshake();
      }
    }
  }

  onChunk(callback: (chunk: string) => void): void {
    this.chunkHandlers.add(callback);
  }

  onDisconnect(callback: () => void): void {
    this.disconnectHandlers.add(callback);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private sendHandshake(): void {
    this.emit(`#HELLO;v1;board=V1;sensor=${this.currentSensor}`);
    for (const ch of CHANNELS[this.currentSensor]) this.emit(ch);
    this.emit('#READY');
  }

  private emitData(): void {
    const tSec = (performance.now() - this.startMs) / 1000;
    switch (this.currentSensor) {
      case 'DS18B20': {
        const temp = 24 + 1.5 * Math.sin(tSec / 4) + (Math.random() - 0.5) * 0.1;
        this.emit(`t:${temp.toFixed(2)}`);
        break;
      }
      case 'HX711': {
        const force = 5 + 2 * Math.sin(tSec / 3) + (Math.random() - 0.5) * 0.2;
        this.emit(`F:${force.toFixed(1)}`);
        break;
      }
      case 'HCSR04': {
        // Roughly a hand swinging back and forth: ±20 cm at ~0.24 Hz, so peak
        // speed ~0.3 m/s. Rounded to whole centimetres and jittered like the
        // real thing, so the app's smoothing is exercised, not flattered.
        const dist = 50 + 20 * Math.sin(tSec * 1.5) + (Math.random() - 0.5) * 0.6;
        this.emit(`d:${dist.toFixed(0)}`);
        break;
      }
      case 'HX710B': {
        const pressure = 101325 + 500 * Math.sin(tSec / 6);
        this.emit(`p:${pressure.toFixed(0)}`);
        break;
      }
      case 'DHT11': {
        const temp = 22 + 1.5 * Math.sin(tSec / 4);
        const humidity = 55 + 10 * Math.sin(tSec / 7);
        this.emit(`t:${temp.toFixed(1)};h:${humidity.toFixed(1)}`);
        break;
      }
    }
  }

  /** Emits one complete protocol line, terminated with \n as a real transport would. */
  private emit(line: string): void {
    const chunk = `${line}\n`;
    this.chunkHandlers.forEach((h) => {
      try {
        h(chunk);
      } catch (err) {
        console.error('[MockTransport] chunk handler threw:', err);
      }
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
