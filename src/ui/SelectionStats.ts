import type { AppState, Run } from '../state/AppState';
import type { SelectionRange } from './Chart';
import { formatNumber, onLanguageChange, t } from '../i18n/i18n';

/**
 * Statistics panel for the currently selected x range (drag-select in chart).
 *
 * Renders into #selection-stats. Hidden when no selection.
 * Computes per-channel min/max/avg/median and the Δt of the selection plus
 * Δy of the active (or first visible) run.
 */
export class SelectionStats {
  private host: HTMLElement;
  private range: SelectionRange = null;
  private disposers: Array<() => void> = [];

  constructor(private readonly state: AppState) {
    this.host = required<HTMLElement>('#selection-stats');
    this.disposers.push(
      onLanguageChange(() => this.render()),
      this.state.bus.on('runs-changed', () => this.render()),
      this.state.bus.on('active-run-changed', () => this.render()),
    );
    this.render();
  }

  destroy(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }

  setRange(range: SelectionRange): void {
    this.range = range;
    this.render();
  }

  private render(): void {
    if (!this.range) {
      this.host.hidden = true;
      this.host.innerHTML = '';
      return;
    }
    const { tMin, tMax } = this.range;
    const dt = tMax - tMin;

    const visibleRuns: Run[] = [
      ...this.state.runs.filter((r) => r.visible),
      ...(this.state.activeRun ? [this.state.activeRun] : []),
    ];
    if (visibleRuns.length === 0 || this.state.channels.length === 0) {
      this.host.hidden = true;
      return;
    }
    this.host.hidden = false;

    const rows: string[] = [];
    for (const r of visibleRuns) {
      for (const ch of this.state.channels) {
        const stats = computeStats(r, ch.id, tMin, tMax);
        if (!stats) continue;
        rows.push(
          `<tr>
             <td class="sel-stats__run"><span class="run-row__dot" style="background:${r.color}"></span>${escapeHtml(r.name)}</td>
             <td>${escapeHtml(t(ch.nameKey))} (${escapeHtml(ch.unit)})</td>
             <td>${formatNumber(stats.min, 2)}</td>
             <td>${formatNumber(stats.max, 2)}</td>
             <td>${formatNumber(stats.avg, 2)}</td>
             <td>${formatNumber(stats.median, 2)}</td>
             <td>${formatNumber(stats.deltaY, 2)}</td>
           </tr>`,
        );
      }
    }

    this.host.innerHTML = `
      <div class="sel-stats__header">
        <strong>${escapeHtml(t('selection.title'))}</strong>
        <span class="sel-stats__range">Δt = ${formatNumber(dt, 2)} s · ${formatNumber(tMin, 2)} → ${formatNumber(tMax, 2)} s</span>
      </div>
      <table class="sel-stats__table">
        <thead>
          <tr>
            <th>${escapeHtml(t('panel.runs'))}</th>
            <th></th>
            <th>${escapeHtml(t('stats.min'))}</th>
            <th>${escapeHtml(t('stats.max'))}</th>
            <th>${escapeHtml(t('stats.avg'))}</th>
            <th>${escapeHtml(t('stats.median'))}</th>
            <th>${escapeHtml(t('stats.deltaY'))}</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;
  }
}

function computeStats(
  run: Run,
  channelId: string,
  tMin: number,
  tMax: number,
): { min: number; max: number; avg: number; median: number; deltaY: number } | null {
  const col = run.values[channelId];
  if (!col) return null;
  const values: number[] = [];
  for (let i = 0; i < run.times.length; i++) {
    const t = run.times[i];
    if (t === undefined || t < tMin || t > tMax) continue;
    const v = col[i];
    if (v === undefined || !Number.isFinite(v)) continue;
    values.push(v);
  }
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  const deltaY = max - min;
  return { min, max, avg, median, deltaY };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function required<T extends HTMLElement = HTMLElement>(
  selector: string,
  scope: ParentNode = document,
): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`SelectionStats: missing element ${selector}`);
  return el;
}
