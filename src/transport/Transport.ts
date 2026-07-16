/**
 * Transport — unified interface shared by Serial / Bluetooth / Mock.
 * Spec §5.
 *
 * Implementations emit raw chunks via the registered onChunk handler — a chunk
 * may be a partial line, a full line, or several lines; it carries no framing
 * guarantee. Callers must run chunks through LineBuffer to recover lines.
 * onDisconnect fires for both user-initiated disconnects and abnormal failures.
 */
export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(data: string): Promise<void>;
  onChunk(callback: (chunk: string) => void): void;
  onDisconnect(callback: () => void): void;
  isConnected(): boolean;
}

export type TransportKind = 'mock' | 'serial' | 'bluetooth';
