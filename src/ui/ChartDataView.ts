import type { AppState, Channel, Run } from '../state/AppState';
import { formatNumber, onLanguageChange, t } from '../i18n/i18n';
import { convert, displayUnit, onUnitsChange, unitDecimals } from '../units/units';
import { computeStats } from '../utils/stats';
import { escapeHtml, required } from '../utils/dom';

/** Rows the table renders at most; longer runs are sampled every n-th row. */
const MAX_TABLE_ROWS = 300;
/** A live recording changes constantly — rebuilding the DOM at 50 Hz is absurd. */
const REFRESH_INTERVAL_MS = 1000;
/**
 * Below this relative slope the trend is called flat. The comparison is
 * (last − first) against the run's own value range, so it is unit-agnostic.
 */
const FLAT_TREND_THRESHOLD = 0.1;

/**
 * The chart's text alternative, in two forms.
 *
 * A canvas is opaque to a screen reader and to anyone who reads the numbers
 * rather than the shape, so everything the plot shows is also published as:
 *
 *   - a one-paragraph summary (per run × quantity: how many samples, min, max,
 *     mean, and which way the values are going), permanently in the DOM and
 *     wired to the canvas via aria-describedby, and
 *   - a real <table> of the samples, toggled by the "Tabulka" button.
 *
 * The table is decimated to MAX_TABLE_ROWS: a 10-minute sonar run is 30 000
 * samples, which is neither renderable nor readable. The footnote says so and
 * points at the CSV export for the complete data.
 */
export class ChartDataView {
  private summaryEl: HTMLElement;
  private tableEl: HTMLElement;
  private toggleBtn: HTMLButtonElement;
  private disposers: Array<() => void> = [];
  private tableShown = false;
  private refreshTimer = 0;
  private dirty = false;

  constructor(
    private readonly state: AppState,
    private readonly announce: (message: string) => void,
  ) {
    this.summaryEl = required('#chart-summary');
    this.tableEl = required('#chart-table');
    this.toggleBtn = required<HTMLButtonElement>('#btn-toggle-table');

    this.toggleBtn.addEventListener('click', () => this.toggleTable());

    const rerender = () => this.render();
    this.disposers.push(
      this.state.bus.on('runs-changed', rerender),
      this.state.bus.on('active-run-changed', rerender),
      this.state.bus.on('channels-changed', rerender),
      this.state.bus.on('channel-visibility-changed', rerender),
      this.state.bus.on('recording-changed', rerender),
      onLanguageChange(() => {
        this.syncToggleLabel();
        this.render();
      }),
      onUnitsChange(rerender),
      // Samples arrive far too fast to rebuild on each one; coalesce.
      this.state.bus.on('data-point', () => this.scheduleRefresh()),
    );

    this.syncToggleLabel();
    this.render();
  }

  destroy(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
  }

  private toggleTable(): void {
    this.tableShown = !this.tableShown;
    this.tableEl.hidden = !this.tableShown;
    this.syncToggleLabel();
    this.render();
    this.announce(t(this.tableShown ? 'a11y.liveTableShown' : 'a11y.liveTableHidden'));
  }

  private syncToggleLabel(): void {
    this.toggleBtn.setAttribute('aria-pressed', String(this.tableShown));
    const label = this.toggleBtn.querySelector('.btn__label');
    if (label) {
      // The global re-scan would otherwise put "Tabulka" back on a button that
      // currently hides one.
      label.removeAttribute('data-i18n');
      label.textContent = t(this.tableShown ? 'chart.hideTable' : 'chart.showTable');
    }
  }

  private scheduleRefresh(): void {
    this.dirty = true;
    if (this.refreshTimer) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      if (this.dirty) {
        this.dirty = false;
        this.render();
      }
    }, REFRESH_INTERVAL_MS);
  }

  private visibleRuns(): Run[] {
    return [
      ...this.state.runs.filter((r) => r.visible),
      ...(this.state.activeRun ? [this.state.activeRun] : []),
    ];
  }

  private render(): void {
    const runs = this.visibleRuns();
    const channels = this.state.visibleChannels;
    this.summaryEl.removeAttribute('data-i18n');
    this.summaryEl.textContent = describeChart(runs, channels);
    if (this.tableShown) this.renderTable(runs, channels);
  }

  private renderTable(runs: readonly Run[], channels: readonly Channel[]): void {
    if (runs.length === 0 || channels.length === 0) {
      this.tableEl.innerHTML = `<p class="chart-table__empty">${escapeHtml(t('chart.tableEmpty'))}</p>`;
      return;
    }
    this.tableEl.innerHTML = runs
      .map((run) => renderRunTable(run, channels))
      .join('');
  }
}

function renderRunTable(run: Run, channels: readonly Channel[]): string {
  const total = run.times.length;
  if (total === 0) {
    return `<p class="chart-table__empty">${escapeHtml(t('chart.tableEmpty'))}</p>`;
  }
  const step = Math.max(1, Math.ceil(total / MAX_TABLE_ROWS));
  const rows: string[] = [];
  for (let i = 0; i < total; i += step) {
    const cells = channels.map((ch) => {
      const unit = displayUnit(ch.unit);
      const raw = run.values[ch.id]?.[i];
      const text =
        raw === undefined || !Number.isFinite(raw)
          ? '—'
          : formatNumber(convert(raw, ch.unit, unit), unitDecimals(unit));
      return `<td>${escapeHtml(text)}</td>`;
    });
    rows.push(`<tr><th scope="row">${formatNumber(run.times[i]!, 2)}</th>${cells.join('')}</tr>`);
  }
  const heads = channels
    .map(
      (ch) =>
        `<th scope="col">${escapeHtml(t(ch.nameKey))} (${escapeHtml(displayUnit(ch.unit))})</th>`,
    )
    .join('');
  const shown = rows.length;
  const note =
    step > 1
      ? `<p class="chart-table__note">${escapeHtml(
          t('chart.tableTruncated', { shown, total, step }),
        )}</p>`
      : '';
  return `
    <div class="chart-table__scroll">
      <table class="chart-table__table">
        <caption>${escapeHtml(t('chart.tableCaption', { run: run.name }))}</caption>
        <thead><tr><th scope="col">${escapeHtml(t('chart.time'))}</th>${heads}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
    ${note}`;
}

/**
 * Plain-language summary of everything on the chart. Exported for the tests
 * and kept free of DOM access so it can be unit-tested as a pure function.
 */
export function describeChart(
  runs: readonly Run[],
  channels: readonly Channel[],
): string {
  const withData = runs.filter((r) => r.times.length > 0);
  if (withData.length === 0 || channels.length === 0) return t('chart.noData');

  const duration = Math.max(...withData.map((r) => r.times[r.times.length - 1] ?? 0));
  const parts = [
    t('chart.summaryIntro', {
      runs: withData.length,
      channels: channels.length,
      duration: formatNumber(duration, 1),
    }),
  ];

  for (const run of withData) {
    for (const ch of channels) {
      const col = run.values[ch.id];
      if (!col) continue;
      const stats = computeStats(col);
      if (!stats) continue;
      const unit = displayUnit(ch.unit);
      const decimals = unitDecimals(unit);
      const show = (v: number) => formatNumber(convert(v, ch.unit, unit), decimals);
      const finite = col.filter((v) => Number.isFinite(v));
      parts.push(
        t('chart.summarySeries', {
          run: run.name,
          channel: t(ch.nameKey),
          count: finite.length,
          min: show(stats.min),
          max: show(stats.max),
          avg: show(stats.avg),
          unit,
          trend: t(trendKey(finite, stats.deltaY)),
        }),
      );
    }
  }
  return parts.join(' ');
}

/**
 * Which way the values went, judged on the first and last tenth of the run
 * rather than on single endpoint samples — one noisy reading at either end
 * should not flip the verdict.
 */
function trendKey(values: readonly number[], range: number): string {
  if (values.length < 4 || range === 0) return 'chart.trendFlat';
  const window = Math.max(1, Math.floor(values.length / 10));
  const mean = (from: number, to: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += values[i]!;
    return sum / (to - from);
  };
  const delta = mean(values.length - window, values.length) - mean(0, window);
  if (Math.abs(delta) < range * FLAT_TREND_THRESHOLD) return 'chart.trendFlat';
  return delta > 0 ? 'chart.trendUp' : 'chart.trendDown';
}
