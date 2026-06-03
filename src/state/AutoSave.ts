import { storage, buildSession, type StoredSession } from './Storage';
import type { AppState } from './AppState';

const SAVE_INTERVAL_MS = 5000;

/**
 * Auto-save controller. Listens to AppState mutations and persists a session
 * snapshot every SAVE_INTERVAL_MS while data is dirty. Snapshots are only taken
 * when there's something to save (channels + runs/activeRun non-empty) — that
 * way an unused tab doesn't churn IndexedDB.
 *
 * Session id stays stable across saves (reuse from a recovered session if any),
 * which makes the "Restore last session" UX consistent across reloads.
 */
export class AutoSave {
  private dirty = false;
  private timer: number | null = null;
  private sessionId: string | undefined;

  constructor(private readonly state: AppState) {
    state.bus.on('runs-changed', () => this.markDirty());
    state.bus.on('active-run-changed', () => this.markDirty());
    state.bus.on('channels-changed', () => this.markDirty());
    state.bus.on('sensor-name', () => this.markDirty());
    state.bus.on('data-point', () => {
      // Don't flag dirty on every sample — too noisy. The active-run-changed
      // event fires on start/stop, and we save explicitly on save/stop anyway.
    });
  }

  /** Adopt the id of a recovered session so subsequent saves keep it stable. */
  adoptSessionId(id: string): void {
    this.sessionId = id;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), SAVE_INTERVAL_MS);
    window.addEventListener('beforeunload', this.flushOnUnload);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    window.removeEventListener('beforeunload', this.flushOnUnload);
  }

  /** Force-save right now (e.g., before reset). Returns when persisted. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    await this.saveNow();
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private async tick(): Promise<void> {
    if (!this.dirty) return;
    await this.saveNow();
  }

  private async saveNow(): Promise<void> {
    const channels = [...this.state.channels];
    const runs = [...this.state.runs];
    const active = this.state.activeRun;
    const sensorName = this.state.sensorName;
    if (channels.length === 0 && runs.length === 0 && !active) {
      // Nothing worth saving — also wipe any stale snapshot so the recovery
      // prompt doesn't surface empty data.
      this.dirty = false;
      await storage.clearSession();
      return;
    }
    const allRuns = active ? [...runs, active] : runs;
    const session = buildSession(channels, allRuns, sensorName, this.sessionId);
    this.sessionId = session.id;
    await storage.saveSession(session);
    this.dirty = false;
  }

  private flushOnUnload = (): void => {
    // Best-effort sync save during unload. IndexedDB is async, so this may not
    // complete — but the periodic save will have captured the recent state.
    if (this.dirty) void this.saveNow();
  };
}

export type { StoredSession };
