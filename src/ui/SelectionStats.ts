import type { AppState, Run } from '../state/AppState';
import type { SelectionRange } from './Chart';
import { formatNumber, onLanguageChange, t } from '../i18n/i18n';
import { convert, displayUnit, onUnitsChange, unitDecimals } from '../units/units';
import { computeRangeStats } from '../utils/stats';
import { escapeHtml, required } from '../utils/dom';

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
      onUnitsChange(() => this.render()),
      this.state.bus.on('channel-visibility-changed', () => this.render()),
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
    const channels = this.state.visibleChannels;
    if (visibleRuns.length === 0 || channels.length === 0) {
      this.host.hidden = true;
      return;
    }
    this.host.hidden = false;

    const rows: string[] = [];
    for (const r of visibleRuns) {
      for (const ch of channels) {
        const stats = computeRangeStats(r, ch.id, tMin, tMax);
        if (!stats) continue;
        const unit = displayUnit(ch.unit);
        const decimals = unitDecimals(unit);
        // Stats are computed on the stored base-unit samples and only then
        // converted — mixing the two would make Δ and average disagree.
        const show = (v: number): string =>
          formatNumber(convert(v, ch.unit, unit), decimals);
        // A difference converts without the offset: 10 K colder is 10 °C colder.
        const showDelta = (v: number): string =>
          formatNumber(convert(v, ch.unit, unit) - convert(0, ch.unit, unit), decimals);
        rows.push(
          `<tr>
             <td class="sel-stats__run"><span class="run-row__dot" style="background:${r.color}"></span>${escapeHtml(r.name)}</td>
             <td>${escapeHtml(t(ch.nameKey))} (${escapeHtml(unit)})</td>
             <td>${show(stats.min)}</td>
             <td>${show(stats.max)}</td>
             <td>${show(stats.avg)}</td>
             <td>${show(stats.median)}</td>
             <td>${showDelta(stats.deltaY)}</td>
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

