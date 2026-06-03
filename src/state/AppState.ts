/**
 * Minimal typed event bus + reactive state holder for FyzBit.
 *
 * Design: no framework, no proxy magic. Components subscribe via `on(event, fn)`
 * and unsubscribe via the returned disposer.
 */

export type Channel = {
  /** Short protocol ID, e.g. "t", "h", "F". */
  id: string;
  /** i18n key for display name, e.g. "channel.temperature". */
  nameKey: string;
  /** Display unit, e.g. "°C", "N", "Pa". Not translated. */
  unit: string;
  min?: number;
  max?: number;
};

export type DataPoint = {
  /** Time since session start, seconds. */
  t: number;
  /** Map of channel.id → value. */
  values: Record<string, number>;
};

export type Annotation = {
  /** Time (seconds) within the run. */
  t: number;
  /** Optional channel id this annotation refers to. */
  channelId?: string;
  label: string;
};

export type Run = {
  id: string;
  name: string;
  startedAt: number;            // performance.now() at start
  /** True until the user calls saveRun or discards; helps the UI mark "active". */
  active: boolean;
  /** Whether the run is visible on the chart. */
  visible: boolean;
  color: string;
  channels: Channel[];
  samplingHz: number;
  /** Time-axis (seconds since run start), aligned with each channel array below. */
  times: number[];
  /** values[channelId] = array of values (NaN-padded to times.length where missing). */
  values: Record<string, number[]>;
  annotations: Annotation[];
};

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'handshake'
  | 'connected'
  | 'measuring'
  | 'calibrating'
  | 'error';

export type AppStateEvents = {
  'connection-status': ConnectionStatus;
  'channels-changed': Channel[];
  'data-point': DataPoint;
  'current-values': Record<string, number>;
  'sensor-name': string;
  'recording-changed': boolean;
  'runs-changed': Run[];
  'active-run-changed': Run | null;
  error: { message: string };
  reset: void;
};

const RUN_COLORS = [
  '#1B5E20', // FyzBit green
  '#1565C0', // blue
  '#C62828', // red
  '#EF6C00', // orange
  '#6A1B9A', // purple
  '#00838F', // teal
  '#558B2F', // light green
  '#AD1457', // pink
];

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

type Listener<T> = (value: T) => void;

class TypedEventBus<E extends Record<string, unknown>> {
  private listeners = new Map<keyof E, Set<Listener<unknown>>>();

  on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<unknown>);
    return () => this.off(event, fn);
  }

  off<K extends keyof E>(event: K, fn: Listener<E[K]>): void {
    this.listeners.get(event)?.delete(fn as Listener<unknown>);
  }

  emit<K extends keyof E>(event: K, value: E[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Snapshot to avoid mutation-during-iteration issues.
    [...set].forEach((fn) => {
      try {
        (fn as Listener<E[K]>)(value);
      } catch (err) {
        console.error(`[AppState] listener for "${String(event)}" threw:`, err);
      }
    });
  }
}

export class AppState {
  readonly bus = new TypedEventBus<AppStateEvents>();

  private _status: ConnectionStatus = 'disconnected';
  private _channels: Channel[] = [];
  private _currentValues: Record<string, number> = {};
  private _sensorName = '';
  private _activeRun: Run | null = null;
  private _runs: Run[] = [];
  private _recording = false;
  private _runCounter = 0;

  get status(): ConnectionStatus {
    return this._status;
  }

  setStatus(s: ConnectionStatus): void {
    if (s === this._status) return;
    this._status = s;
    this.bus.emit('connection-status', s);
  }

  get channels(): readonly Channel[] {
    return this._channels;
  }

  setChannels(channels: Channel[]): void {
    this._channels = [...channels];
    this._currentValues = {};
    this.bus.emit('channels-changed', this._channels);
  }

  get currentValues(): Readonly<Record<string, number>> {
    return this._currentValues;
  }

  pushDataPoint(point: DataPoint): void {
    this._currentValues = { ...this._currentValues, ...point.values };
    if (this._recording && this._activeRun) {
      this._activeRun.times.push(point.t);
      for (const ch of this._activeRun.channels) {
        const arr = this._activeRun.values[ch.id];
        if (!arr) continue;
        const v = point.values[ch.id];
        arr.push(Number.isFinite(v) ? (v as number) : NaN);
      }
    }
    this.bus.emit('data-point', point);
    this.bus.emit('current-values', this._currentValues);
  }

  get activeRun(): Run | null {
    return this._activeRun;
  }

  get runs(): readonly Run[] {
    return this._runs;
  }

  get recording(): boolean {
    return this._recording;
  }

  /**
   * Begin a new active run, drawing channels from current AppState.
   * If a previous active run exists and was never saved, it's overwritten.
   */
  startRun(samplingHz: number, defaultNameFn: (n: number) => string): Run {
    this._runCounter += 1;
    const color = RUN_COLORS[(this._runs.length + (this._activeRun ? 1 : 0)) % RUN_COLORS.length]!;
    const run: Run = {
      id: makeId(),
      name: defaultNameFn(this._runCounter),
      startedAt: performance.now(),
      active: true,
      visible: true,
      color,
      channels: this._channels.map((c) => ({ ...c })),
      samplingHz,
      times: [],
      values: Object.fromEntries(this._channels.map((c) => [c.id, [] as number[]])),
      annotations: [],
    };
    this._activeRun = run;
    this._recording = true;
    this.bus.emit('active-run-changed', run);
    this.bus.emit('recording-changed', true);
    return run;
  }

  /** Pause recording but keep the active run buffer intact. */
  stopRecording(): void {
    if (!this._recording) return;
    this._recording = false;
    this.bus.emit('recording-changed', false);
  }

  /** Resume recording into the existing active run. */
  resumeRecording(): void {
    if (!this._activeRun) return;
    this._recording = true;
    this.bus.emit('recording-changed', true);
  }

  /** Commit the active run to the saved list. Returns the saved run. */
  saveActiveRun(): Run | null {
    if (!this._activeRun) return null;
    this._activeRun.active = false;
    this._recording = false;
    const saved = this._activeRun;
    this._runs = [...this._runs, saved];
    this._activeRun = null;
    this.bus.emit('runs-changed', this._runs);
    this.bus.emit('active-run-changed', null);
    this.bus.emit('recording-changed', false);
    return saved;
  }

  /** Discard the active run buffer without saving. */
  discardActiveRun(): void {
    this._activeRun = null;
    this._recording = false;
    this.bus.emit('active-run-changed', null);
    this.bus.emit('recording-changed', false);
  }

  setRunVisible(runId: string, visible: boolean): void {
    const r = this._runs.find((x) => x.id === runId);
    if (!r || r.visible === visible) return;
    r.visible = visible;
    this.bus.emit('runs-changed', this._runs);
  }

  renameRun(runId: string, name: string): void {
    const r = this._runs.find((x) => x.id === runId);
    if (!r) return;
    r.name = name;
    this.bus.emit('runs-changed', this._runs);
  }

  deleteRun(runId: string): void {
    const before = this._runs.length;
    this._runs = this._runs.filter((x) => x.id !== runId);
    if (this._runs.length !== before) this.bus.emit('runs-changed', this._runs);
  }

  addAnnotation(a: Annotation, runId?: string): void {
    const target = runId ? this._runs.find((x) => x.id === runId) : this._activeRun;
    if (!target) return;
    target.annotations.push(a);
    if (target === this._activeRun) this.bus.emit('active-run-changed', target);
    else this.bus.emit('runs-changed', this._runs);
  }

  get sensorName(): string {
    return this._sensorName;
  }

  setSensorName(name: string): void {
    if (name === this._sensorName) return;
    this._sensorName = name;
    this.bus.emit('sensor-name', name);
  }

  reset(): void {
    this._status = 'disconnected';
    this._channels = [];
    this._currentValues = {};
    this._sensorName = '';
    this._activeRun = null;
    this._runs = [];
    this._recording = false;
    this._runCounter = 0;
    this.bus.emit('reset', undefined);
    this.bus.emit('connection-status', 'disconnected');
    this.bus.emit('channels-changed', []);
    this.bus.emit('runs-changed', []);
    this.bus.emit('active-run-changed', null);
    this.bus.emit('recording-changed', false);
  }

  /**
   * Replace state with the contents of a previously saved session. Used by the
   * recovery flow. Does not change connection status or sensor name (those come
   * from the current transport handshake).
   */
  hydrateRuns(channels: Channel[], runs: Run[]): void {
    this._channels = [...channels];
    this._runs = [...runs];
    this._runCounter = runs.length;
    this._activeRun = null;
    this._recording = false;
    this.bus.emit('channels-changed', this._channels);
    this.bus.emit('runs-changed', this._runs);
    this.bus.emit('active-run-changed', null);
    this.bus.emit('recording-changed', false);
  }
}

export const appState = new AppState();
