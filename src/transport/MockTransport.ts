import type { Transport } from './Transport';

/**
 * MockTransport — simulates a micro:bit V1 reporting temperature (DS18B20).
 *
 * On connect, after a short delay emits a valid FyzBit protocol handshake:
 *   #HELLO;v1;board=V1
 *   #CH;t;Temperature;°C;-40;125
 *   #READY
 * Then streams data lines `t:<value>\n` at 10 Hz with a sinusoidal value around 24 °C.
 *
 * Used for development and demos before any micro:bit firmware is flashed,
 * and will also serve as the protocol parser's primary test fixture (M2).
 */
export class MockTransport implements Transport {
  private connected = false;
  private lineHandlers = new Set<(line: string) => void>();
  private disconnectHandlers = new Set<() => void>();
  private dataTimer: number | null = null;
  private streaming = true;
  private startMs = 0;

  async connect(): Promise<void> {
    if (this.connected) return;
    // Simulate handshake delay.
    await sleep(200);
    this.connected = true;
    this.startMs = performance.now();

    // Handshake messages.
    this.emit('#HELLO;v1;board=V1');
    this.emit('#CH;t;Temperature;°C;-40;125');
    this.emit('#READY');

    // Begin streaming.
    this.dataTimer = window.setInterval(() => {
      if (!this.connected || !this.streaming) return;
      const tSec = (performance.now() - this.startMs) / 1000;
      const temp = 24 + 1.5 * Math.sin(tSec / 4) + (Math.random() - 0.5) * 0.1;
      this.emit(`t:${temp.toFixed(2)}`);
    }, 100);
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
    else if (line.startsWith('#CAL;')) {
      const parts = line.split(';');
      this.emit(`#CAL;${parts[1] ?? 't'};ok;1.0`);
    } else if (line === '#HELLO?') {
      this.emit('#HELLO;v1;board=V1');
      this.emit('#CH;t;Temperature;°C;-40;125');
      this.emit('#READY');
    }
  }

  onLine(callback: (line: string) => void): void {
    this.lineHandlers.add(callback);
  }

  onDisconnect(callback: () => void): void {
    this.disconnectHandlers.add(callback);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private emit(line: string): void {
    this.lineHandlers.forEach((h) => {
      try {
        h(line);
      } catch (err) {
        console.error('[MockTransport] line handler threw:', err);
      }
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
