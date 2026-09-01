/**
 * Unit families + display-unit preferences.
 *
 * The firmware always reports a channel in one fixed *base* unit (`#CH;d;
 * Distance;cm;…`), and everything in AppState / storage / runs stays in that
 * base unit. Only the presentation layer (chart, big value, selection stats,
 * CSV/PDF headers) converts to the unit the user picked — so switching cm → m
 * mid-experiment can never corrupt already-recorded data.
 *
 * Preferences are stored per *family*, not per channel: a teacher who wants
 * millimetres wants them for every length on screen.
 */

export type UnitDef = {
  /** Stable key, also the label shown to the user. */
  id: string;
  /** value_in_SI = value_in_this_unit * factor + offset */
  factor: number;
  offset: number;
  /** Sensible number of decimals when showing a value in this unit. */
  decimals: number;
};

export type UnitFamily = {
  id: string;
  units: UnitDef[];
};

const u = (id: string, factor: number, decimals: number, offset = 0): UnitDef => ({
  id,
  factor,
  offset,
  decimals,
});

export const UNIT_FAMILIES: readonly UnitFamily[] = [
  { id: 'length', units: [u('mm', 0.001, 0), u('cm', 0.01, 1), u('m', 1, 3)] },
  { id: 'speed', units: [u('m/s', 1, 2), u('km/h', 1 / 3.6, 1), u('cm/s', 0.01, 1)] },
  { id: 'acceleration', units: [u('m/s²', 1, 2), u('g', 9.80665, 3)] },
  {
    id: 'temperature',
    // SI reference for this family is °C (not kelvin) — it is the unit the
    // firmware sends, so the identity conversion is the common path.
    units: [u('°C', 1, 1), u('K', 1, 1, -273.15), u('°F', 5 / 9, 1, -160 / 9)],
  },
  { id: 'force', units: [u('N', 1, 1), u('mN', 0.001, 0), u('kN', 1000, 3)] },
  {
    id: 'pressure',
    units: [u('Pa', 1, 0), u('hPa', 100, 1), u('kPa', 1000, 2), u('bar', 100000, 4)],
  },
];

const FAMILY_BY_UNIT = new Map<string, UnitFamily>();
const UNIT_BY_ID = new Map<string, UnitDef>();
for (const family of UNIT_FAMILIES) {
  for (const unit of family.units) {
    FAMILY_BY_UNIT.set(unit.id, family);
    UNIT_BY_ID.set(unit.id, unit);
  }
}

/**
 * Repairs and canonicalises a unit string coming off the wire.
 *
 * MakeCode's compiler substitutes '?' for non-ASCII characters in string
 * literals, so a firmware that means to send "°C" puts "?C" on the serial
 * line. The firmware now sends the ASCII-safe "degC" instead, but boards
 * flashed with an older build are still out there — map every spelling we
 * have ever emitted onto the real symbol.
 */
export function normalizeUnit(raw: string): string {
  const trimmed = raw.trim();
  switch (trimmed) {
    case 'degC':
    case 'C':
    case '?C':
    case '�C':
      return '°C';
    case 'degF':
    case '?F':
      return '°F';
    case 'm/s2':
    case 'm/s^2':
      return 'm/s²';
    default:
      return trimmed;
  }
}

/** The family a unit belongs to, or undefined for one-off units like "%". */
export function unitFamilyFor(unit: string): UnitFamily | undefined {
  return FAMILY_BY_UNIT.get(unit);
}

/**
 * Units the user may pick for a channel reported in `baseUnit`.
 * Empty when the unit has no alternatives worth offering (e.g. "%").
 */
export function unitOptionsFor(baseUnit: string): readonly UnitDef[] {
  return unitFamilyFor(baseUnit)?.units ?? [];
}

/** Decimals to render a value in `unit` with; falls back to 2. */
export function unitDecimals(unit: string): number {
  return UNIT_BY_ID.get(unit)?.decimals ?? 2;
}

/** Convert between two units of the same family. Unknown pairs pass through. */
export function convert(value: number, from: string, to: string): number {
  if (from === to || !Number.isFinite(value)) return value;
  const a = UNIT_BY_ID.get(from);
  const b = UNIT_BY_ID.get(to);
  if (!a || !b || FAMILY_BY_UNIT.get(from) !== FAMILY_BY_UNIT.get(to)) return value;
  const si = value * a.factor + a.offset;
  return (si - b.offset) / b.factor;
}

// ── Preferences ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'fyzbit.units';
const CHANGE_EVENT = 'fyzbit:units-changed';

let preferences: Record<string, string> = {};

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* private mode / full storage — preferences just don't survive a reload */
  }
}

export function initUnits(): void {
  preferences = {};
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    for (const [familyId, unitId] of Object.entries(parsed as Record<string, unknown>)) {
      const family = UNIT_FAMILIES.find((f) => f.id === familyId);
      if (family && typeof unitId === 'string' && family.units.some((x) => x.id === unitId)) {
        preferences[familyId] = unitId;
      }
    }
  } catch {
    /* corrupt value — fall back to base units */
  }
}

/** The unit a channel reported in `baseUnit` should currently be shown in. */
export function displayUnit(baseUnit: string): string {
  const family = unitFamilyFor(baseUnit);
  if (!family) return baseUnit;
  const chosen = preferences[family.id];
  return chosen && family.units.some((x) => x.id === chosen) ? chosen : baseUnit;
}

/** Pick the display unit for the whole family `baseUnit` belongs to. */
export function setDisplayUnit(baseUnit: string, unitId: string): void {
  const family = unitFamilyFor(baseUnit);
  if (!family || !family.units.some((x) => x.id === unitId)) return;
  if (preferences[family.id] === unitId) return;
  preferences[family.id] = unitId;
  persist();
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function onUnitsChange(handler: () => void): () => void {
  const listener = () => handler();
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
