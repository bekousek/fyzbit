import type { Transport } from './Transport';
import { ConnectionStatus, DeviceError } from '@microbit/microbit-connection';
import {
  createBluetoothConnection,
  type MicrobitBluetoothConnection,
} from '@microbit/microbit-connection/bluetooth';

/**
 * BluetoothTransport — connects to a micro:bit V2 running the fyzbit-ble
 * firmware over Web Bluetooth (Nordic UART Service), via
 * @microbit/microbit-connection (MIT, official micro:bit Foundation
 * library — also used for WebUSB flashing in src/flash/Flasher.ts).
 *
 * BLE notifications don't line up with protocol lines (MTU-limited, ~20+
 * bytes per packet) — chunks are handed to the caller's LineBuffer exactly
 * like SerialTransport's, no re-framing needed here.
 */
export class BluetoothTransport implements Transport {
  private connection: MicrobitBluetoothConnection | null = null;
  private chunkHandlers = new Set<(chunk: string) => void>();
  private disconnectHandlers = new Set<() => void>();
  // One decoder for the whole connection (not per-notification): BLE MTU
  // packets can split a multi-byte UTF-8 character (e.g. °C) across two
  // notifications, and only a stateful decoder with {stream: true} recombines
  // the split bytes instead of emitting a replacement character.
  private decoder = new TextDecoder('utf-8', { fatal: false });

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async connect(): Promise<void> {
    if (this.connection) return;
    if (!BluetoothTransport.isSupported()) {
      throw new Error('Web Bluetooth API not available in this browser.');
    }

    const conn = createBluetoothConnection();
    conn.addEventListener('uartdata', (data) => {
      this.emit(this.decoder.decode(data.value, { stream: true }));
    });
    conn.addEventListener('status', (change) => {
      if (
        change.status === ConnectionStatus.Disconnected &&
        change.previousStatus === ConnectionStatus.Connected
      ) {
        this.fireDisconnect();
      }
    });

    try {
      await conn.connect();
    } catch (err) {
      conn.dispose();
      throw err;
    }
    this.connection = conn;
  }

  async disconnect(): Promise<void> {
    const conn = this.connection;
    if (!conn) return;
    this.connection = null;
    try {
      await conn.disconnect();
    } finally {
      conn.dispose();
    }
  }

  async send(data: string): Promise<void> {
    const conn = this.connection;
    if (!conn || conn.status !== ConnectionStatus.Connected) return;
    try {
      await conn.uartWrite(new TextEncoder().encode(data));
    } catch (err) {
      // The device disconnected between the isConnected check and the write —
      // the status/disconnect handler already deals with cleanup.
      if (err instanceof DeviceError && err.code === 'not-connected') return;
      throw err;
    }
  }

  onChunk(callback: (chunk: string) => void): void {
    this.chunkHandlers.add(callback);
  }

  onDisconnect(callback: () => void): void {
    this.disconnectHandlers.add(callback);
  }

  isConnected(): boolean {
    return this.connection?.status === ConnectionStatus.Connected;
  }

  private emit(chunk: string): void {
    this.chunkHandlers.forEach((h) => {
      try {
        h(chunk);
      } catch (err) {
        console.error('[BluetoothTransport] chunk handler threw:', err);
      }
    });
  }

  private fireDisconnect(): void {
    this.disconnectHandlers.forEach((h) => {
      try {
        h();
      } catch (err) {
        console.error('[BluetoothTransport] disconnect handler threw:', err);
      }
    });
  }
}
