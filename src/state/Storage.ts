import { get, set, del, clear } from 'idb-keyval';
import type { Channel, Run, Annotation } from './AppState';

/**
 * On-disk representation of a recoverable session. Keep it strictly JSON-friendly
 * (no Maps, no Dates as objects — store epoch ms instead, no Functions). idb-keyval
 * uses the structured clone algorithm so most types are fine, but explicit
 * serialization keeps the shape readable and forwards-compatible with hand-editing.
 */
export type StoredSession = {
  schemaVersion: 1;
  id: string;
  createdAt: number;
  updatedAt: number;
  sensorName: string;
  channels: Channel[];
  runs: StoredRun[];
};

export type StoredRun = {
  id: string;
  name: string;
  startedAt: number;
  visible: boolean;
  color: string;
  samplingHz: number;
  channels: Channel[];
  times: number[];
  values: Record<string, number[]>;
  annotations: Annotation[];
};

const KEY_SESSION = 'fyzbit.session';

export const storage = {
  async loadSession(): Promise<StoredSession | null> {
    try {
      const raw = await get<StoredSession>(KEY_SESSION);
      if (!raw) return null;
      if (raw.schemaVersion !== 1) {
        console.warn('[storage] unknown schema version, ignoring:', raw.schemaVersion);
        return null;
      }
      return raw;
    } catch (err) {
      console.error('[storage] loadSession failed:', err);
      return null;
    }
  },

  async saveSession(session: StoredSession): Promise<void> {
    try {
      await set(KEY_SESSION, session);
    } catch (err) {
      console.error('[storage] saveSession failed:', err);
    }
  },

  async clearSession(): Promise<void> {
    try {
      await del(KEY_SESSION);
    } catch (err) {
      console.error('[storage] clearSession failed:', err);
    }
  },

  /** Nuclear option used by Settings → Smazat všechna data. */
  async clearAll(): Promise<void> {
    try {
      await clear();
    } catch (err) {
      console.error('[storage] clearAll failed:', err);
    }
  },
};

/** Convert an in-memory Run into the StoredRun shape (drop the `active` flag). */
export function runToStored(run: Run): StoredRun {
  return {
    id: run.id,
    name: run.name,
    startedAt: run.startedAt,
    visible: run.visible,
    color: run.color,
    samplingHz: run.samplingHz,
    channels: run.channels.map((c) => ({ ...c })),
    times: [...run.times],
    values: Object.fromEntries(
      Object.entries(run.values).map(([k, v]) => [k, [...v]]),
    ),
    annotations: run.annotations.map((a) => ({ ...a })),
  };
}

/** Inverse: turn a StoredRun back into a Run that AppState can host. */
export function storedToRun(stored: StoredRun): Run {
  return {
    id: stored.id,
    name: stored.name,
    startedAt: stored.startedAt,
    active: false,
    visible: stored.visible,
    color: stored.color,
    samplingHz: stored.samplingHz,
    channels: stored.channels.map((c) => ({ ...c })),
    times: [...stored.times],
    values: Object.fromEntries(
      Object.entries(stored.values).map(([k, v]) => [k, [...v]]),
    ),
    annotations: stored.annotations.map((a) => ({ ...a })),
  };
}

export function buildSession(
  channels: readonly Channel[],
  runs: readonly Run[],
  sensorName: string,
  existingId?: string,
): StoredSession {
  const now = Date.now();
  return {
    schemaVersion: 1,
    id: existingId ?? `session-${now.toString(36)}`,
    createdAt: now,
    updatedAt: now,
    sensorName,
    channels: channels.map((c) => ({ ...c })),
    runs: runs.map(runToStored),
  };
}
