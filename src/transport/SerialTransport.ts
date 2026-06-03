import type { Transport } from './Transport';

/**
 * SerialTransport — connects to a micro:bit via Web Serial API (USB CDC).
 *
 * Flow:
 *   1. await connect() → prompts user to pick a port (filtered to micro:bit USB IDs).
 *   2. Opens the port at 115200 baud (matches MakeCode/CODAL default).
 *   3. Spawns an async reader loop that decodes UTF-8 chunks and feeds them
 *      to the registered line handler.
 *   4. send() writes UTF-8 encoded data (commands already include trailing \n).
 *
 * Disconnect is triggered by:
 *   - explicit disconnect() (cancels reader, closes port);
 *   - the 'disconnect' event on the port (cable unplug);
 *   - a read/write failure (e.g., NetworkError).
 */

const MICROBIT_FILTERS = [
  { usbVendorId: 0x0d28, usbProductId: 0x0204 }, // BBC micro:bit (DAPLink CMSIS-DAP)
];

const BAUD_RATE = 115200;

export class SerialTransport implements Transport {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private connected = false;
  private closingDeliberately = false;

  private lineHandlers = new Set<(line: string) => void>();
  private disconnectHandlers = new Set<() => void>();

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (!SerialTransport.isSupported()) {
      throw new Error('Web Serial API not available in this browser.');
    }
    const serial = navigator.serial;
    if (!serial) throw new Error('navigator.serial unavailable');

    this.port = await serial.requestPort({ filters: MICROBIT_FILTERS });
    await this.port.open({ baudRate: BAUD_RATE });

    this.port.addEventListener('disconnect', this.handleDeviceDisconnect);

    if (!this.port.writable) throw new Error('Serial port not writable.');
    this.writer = this.port.writable.getWriter();

    if (!this.port.readable) throw new Error('Serial port not readable.');
    this.reader = this.port.readable.getReader();
    this.connected = true;
    this.closingDeliberately = false;

    // Reader loop runs detached; we don't await it. Errors are caught inside.
    void this.readLoop();
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.closingDeliberately = true;
    this.connected = false;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    try {
      this.reader?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.writer?.close();
    } catch {
      /* ignore */
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }

    if (this.port) {
      this.port.removeEventListener('disconnect', this.handleDeviceDisconnect);
    }
    this.reader = null;
    this.writer = null;
    this.port = null;
    this.fireDisconnect();
  }

  async send(data: string): Promise<void> {
    if (!this.connected || !this.writer) return;
    const bytes = new TextEncoder().encode(data);
    await this.writer.write(bytes);
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

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    try {
      while (this.connected && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        const chunk = decoder.decode(value, { stream: true });
        this.emit(chunk);
      }
    } catch (err) {
      if (!this.closingDeliberately) {
        console.error('[SerialTransport] read loop error:', err);
      }
    } finally {
      // Loop ended for any reason → ensure disconnect cleanup if not already done.
      if (this.connected) {
        this.connected = false;
        this.fireDisconnect();
      }
    }
  }

  private handleDeviceDisconnect = () => {
    if (this.connected) {
      this.connected = false;
      this.fireDisconnect();
    }
  };

  private emit(chunk: string): void {
    this.lineHandlers.forEach((h) => {
      try {
        h(chunk);
      } catch (err) {
        console.error('[SerialTransport] line handler threw:', err);
      }
    });
  }

  private fireDisconnect(): void {
    this.disconnectHandlers.forEach((h) => {
      try {
        h();
      } catch (err) {
        console.error('[SerialTransport] disconnect handler threw:', err);
      }
    });
  }
}
