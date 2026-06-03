import type { Run, Channel } from '../state/AppState';
import { csvDecimal, getLanguage, t } from '../i18n/i18n';

const BOM = '﻿';

export type CsvOptions = {
  /** When set, exports only this subset of runs (e.g., visible). Defaults to all. */
  runs?: readonly Run[];
  /** Channels — used to determine columns and translated headers. */
  channels: readonly Channel[];
};

/**
 * Build the main measurements CSV.
 *
 * Format (CZ example):
 *   sep=;\n
 *   Cas (s);Mereni 1 - Teplota (°C);Mereni 2 - Teplota (°C)\n
 *   0,0;24,5;22,1\n
 *   ...
 *
 * - BOM `﻿` for Excel UTF-8 detection.
 * - First row `sep=;` instructs Excel to use semicolon delimiter regardless of locale.
 * - Decimal: comma in CZ, dot in EN.
 * - Header text translated via i18n.
 * - Multi-run merge: union of all t values across selected runs; per (run × channel) column.
 */
export function buildRunsCsv(opts: CsvOptions): string {
  const runs = opts.runs ?? [];
  const channels = opts.channels;
  if (runs.length === 0 || channels.length === 0) {
    return BOM + 'sep=;\n' + t('chart.time') + '\n';
  }

  // Union of all time values across runs.
  const tKeys = new Set<number>();
  for (const r of runs) for (const tv of r.times) tKeys.add(Math.round(tv * 1000) / 1000);
  const xs = [...tKeys].sort((a, b) => a - b);

  // Build header.
  const headers: string[] = [t('chart.time')];
  for (const r of runs) {
    for (const ch of channels) {
      headers.push(`${r.name} - ${t(ch.nameKey)} (${ch.unit})`);
    }
  }

  // Build row index lookups for each run.
  const runIdx = runs.map((r) => {
    const m = new Map<number, number>();
    r.times.forEach((tv, i) => m.set(Math.round(tv * 1000) / 1000, i));
    return m;
  });

  const lines: string[] = [];
  for (const x of xs) {
    const cells: string[] = [csvDecimal(x, 3)];
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r]!;
      const lookup = runIdx[r]!;
      const srcIdx = lookup.get(x);
      for (const ch of channels) {
        if (srcIdx === undefined) {
          cells.push('');
        } else {
          const v = run.values[ch.id]?.[srcIdx];
          cells.push(v === undefined || !Number.isFinite(v) ? '' : csvDecimal(v, 3));
        }
      }
    }
    lines.push(cells.join(';'));
  }

  return BOM + 'sep=;\n' + headers.join(';') + '\n' + lines.join('\n') + '\n';
}

/**
 * Build the annotations CSV (separate file).
 *
 *   Cas (s);Mereni;Popis
 *   12,3;Mereni 1;Začal jsem ohřívat
 */
export function buildAnnotationsCsv(opts: CsvOptions): string {
  const runs = opts.runs ?? [];
  const header = [
    t('chart.time'),
    t('panel.runs'),
    t('annotation.defaultLabel'),
  ].join(';');
  const rows: string[] = [];
  for (const r of runs) {
    for (const a of r.annotations) {
      rows.push(
        [csvDecimal(a.t, 3), escapeCsvField(r.name), escapeCsvField(a.label)].join(';'),
      );
    }
  }
  if (rows.length === 0) return BOM + 'sep=;\n' + header + '\n';
  return BOM + 'sep=;\n' + header + '\n' + rows.join('\n') + '\n';
}

function escapeCsvField(s: string): string {
  // Wrap in quotes if it contains a separator, newline, or quote; double internal quotes.
  if (/[;\n\r"]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Trigger a browser download for a string-typed CSV blob. */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename);
}

export function timestampedFilename(prefix: string, ext: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${prefix}_${stamp}.${ext}`;
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Re-export language for callers that want to vary filename by locale.
export { getLanguage };
