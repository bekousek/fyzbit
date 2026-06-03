/**
 * Transport — unified interface shared by Serial / Bluetooth / Mock.
 * Spec §5.
 *
 * Implementations emit line-delimited strings via the registered onLine handler.
 * onDisconnect fires for both user-initiated disconnects and abnormal failures.
 */
export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(data: string): Promise<void>;
  onLine(callback: (line: string) => void): void;
  onDisconnect(callback: () => void): void;
  isConnected(): boolean;
}

export type TransportKind = 'mock' | 'serial' | 'bluetooth';
