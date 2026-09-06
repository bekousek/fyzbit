import uPlot from 'uplot';
import type { Options, Series, Axis, AlignedData } from 'uplot';
import 'uplot/dist/uPlot.min.css';

import type { Channel, Run } from '../state/AppState';
import { cssVar, onThemeChange } from '../theme/theme';
import { channelColorForIndex } from '../theme/runColors';
import { onLanguageChange, t } from '../i18n/i18n';
import { convert, displayUnit, onUnitsChange } from '../units/units';
import { dashForChannel, drawMarker, shapeForRun, type MarkerShape } from '../theme/seriesStyles';

const REDRAW_FPS = 30;
/** ~10 minutes at the sonar's 50 Hz; longer runs drop their oldest samples. */
const MAX_ACTIVE_POINTS = 30000;
/** Trim in one slice rather than per sample — shift() on a 30k array is a memmove. */
const TRIM_CHUNK = 2000;
/** Below this container width the legend eats the plot — the channel chips
 *  above the chart already say which color is which, so drop it. */
const LEGEND_MIN_WIDTH = 560;

/** Roughly how far apart, in pixels, the run markers are spaced along a line. */
const MARKER_SPACING_PX = 72;
const MARKER_SIZE_PX = 9;

export type SelectionRange = { tMin: number; tMax: number } | null;

export type ChartCallbacks = {
  onSelection?: (range: SelectionRange) => void;
  /** Resolves to the label entered by the user, or null if cancelled. */
  promptAnnotation?: () => Promise<string | null>;
  /** A held? Asked at the moment of click. */
  isAnnotationModifierHeld?: () => boolean;
  /** Called when user clicks chart while annotation modifier is held. */
  onAnnotationClick?: (tSec: number, label: string) => void;
};

/**
 * Multi-run uPlot wrapper with selection callback and annotation painting.
 *
 * Each visible run contributes one series per *visible* channel, and every
 * channel gets its own y scale and its own labelled axis — two quantities
 * with wildly different ranges (cm and m/s) can't share one.
 *
 * Two things are being told apart at once, runs and quantities, and colour may
 * only ever own one of them:
 *   - one run on screen  → colour = quantity
 *   - several runs       → colour = run
 * On top of that both dimensions carry a second, colour-independent encoding
 * (see theme/seriesStyles.ts): the dash pattern always means the quantity and
 * the marker shape always means the run, so "which line is this?" has an
 * answer without seeing any hue at all. The axis labels carry the quantity's
 * colour in the first case and stay neutral in the second, so they never lie.
 *
 * Values are converted to the user's chosen display unit on the way in; runs
 * keep storing whatever base unit the firmware reported.
 *
 * Annotations are painted on top via uPlot's `hooks.draw`. Adding a new one
 * is triggered by chart click when the caller's modifier callback returns
 * true (typically: A held on keyboard).
 */
export class Chart {
  private plot: uPlot | null = null;
  private resizeObs: ResizeObserver | null = null;
  private channels: Channel[] = [];
  private hiddenChannelIds = new Set<string>();
  private runs: Run[] = [];
  private activeRun: Run | null = null;
  private autoscale = true;
  private pendingRedraw = false;
  private lastRedrawTs = 0;
  private pendingUpdate = false;
  private lastUpdateTs = 0;
  private disposers: Array<() => void> = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: ChartCallbacks = {},
  ) {
    this.disposers.push(onThemeChange(() => this.rebuild()));
    this.disposers.push(onLanguageChange(() => this.rebuild()));
    this.disposers.push(onUnitsChange(() => this.rebuild()));

    this.resizeObs = new ResizeObserver(() => this.handleResize());
    this.resizeObs.observe(this.container);

    document.addEventListener('keydown', this.handleKey);
    this.container.addEventListener('click', this.handleClick, true);
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKey);
    this.container.removeEventListener('click', this.handleClick, true);
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.plot?.destroy();
    this.plot = null;
  }

  setChannels(channels: Channel[]): void {
    this.channels = channels;
    this.rebuild();
  }

  /** Restrict drawing to these channel ids (see AppState.visibleChannels). */
  setVisibleChannels(ids: readonly string[]): void {
    const allowed = new Set(ids);
    this.hiddenChannelIds = new Set(
      this.channels.map((c) => c.id).filter((id) => !allowed.has(id)),
    );
    this.rebuild();
  }

  setRuns(saved: readonly Run[], active: Run | null): void {
    this.runs = [...saved];
    this.activeRun = active;
    this.scheduleRedraw(true);
  }

  notifyActivePointAppended(): void {
    const run = this.activeRun;
    if (run && run.times.length > MAX_ACTIVE_POINTS + TRIM_CHUNK) {
      run.times.splice(0, TRIM_CHUNK);
      for (const ch of run.channels) {
        run.values[ch.id]?.splice(0, TRIM_CHUNK);
      }
    }
    this.scheduleDataUpdate();
  }

  setAutoscale(on: boolean): void {
    this.autoscale = on;
    if (on) this.scheduleRedraw(true);
  }

  resetZoom(): void {
    this.scheduleRedraw(true);
    this.callbacks.onSelection?.(null);
  }

  /**
   * Re-measure and redraw. Needed when the container goes from `display: none`
   * back to visible (mobile section switch) — while hidden it has no size, so
   * the ResizeObserver's reading was 0×0 and got ignored.
   */
  refresh(): void {
    this.scheduleRedraw(true);
  }

  private get plottedChannels(): Channel[] {
    return this.channels.filter((c) => !this.hiddenChannelIds.has(c.id));
  }

  private get visibleRuns(): Run[] {
    return [
      ...this.runs.filter((r) => r.visible),
      ...(this.activeRun ? [this.activeRun] : []),
    ];
  }

  private handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.resetZoom();
  };

  private handleClick = (e: MouseEvent) => {
    if (!this.plot) return;
    if (!this.callbacks.isAnnotationModifierHeld?.()) return;
    if (!this.activeRun && this.runs.length === 0) return;
    const rect = this.plot.over.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < 0 || x > rect.width) return;
    const tSec = this.plot.posToVal(x, 'x');
    if (!Number.isFinite(tSec)) return;
    const pending = this.callbacks.promptAnnotation?.();
    if (!pending) return;
    void pending.then((label) => {
      if (!label) return;
      this.callbacks.onAnnotationClick?.(tSec, label);
    });
  };

  private handleResize(): void {
    if (!this.plot) return;
    const rect = this.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    // The legend appears/disappears with width, and that is structural — a
    // plain setSize() would leave the old legend in place.
    const legendShown = this.plot.root.querySelector('.u-legend') !== null;
    if (legendShown !== rect.width >= LEGEND_MIN_WIDTH) {
      this.scheduleRedraw(true);
      return;
    }
    this.fitToContainer();
  }

  /**
   * uPlot's `height` is the *plot* height and the legend is laid out below it,
   * so handing it the container's full height pushes the legend out of view.
   * Measure what the legend actually took and give the plot the rest.
   */
  private fitToContainer(): void {
    const plot = this.plot;
    if (!plot) return;
    const rect = this.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const legend = plot.root.querySelector('.u-legend');
    const legendHeight = legend ? legend.getBoundingClientRect().height : 0;
    const width = Math.floor(rect.width);
    const height = Math.max(120, Math.floor(rect.height - legendHeight));
    if (Math.abs(width - plot.width) < 1 && Math.abs(height - plot.height) < 1) return;
    plot.setSize({ width, height });
  }

  private scheduleRedraw(force = false): void {
    if (this.pendingRedraw) return;
    const now = performance.now();
    const minInterval = 1000 / REDRAW_FPS;
    const delay = force ? 0 : Math.max(0, minInterval - (now - this.lastRedrawTs));
    this.pendingRedraw = true;
    setTimeout(() => {
      this.pendingRedraw = false;
      this.lastRedrawTs = performance.now();
      this.rebuild();
    }, delay);
  }

  /**
   * Throttled data-only update for streaming samples into the active run.
   * Reuses the existing uPlot instance via setData() instead of a full
   * destroy()+recreate — channels/runs/theme haven't changed, only the
   * active run's arrays grew, so series/axes/legend stay valid as-is.
   */
  private scheduleDataUpdate(): void {
    if (this.pendingRedraw || this.pendingUpdate) return;
    const now = performance.now();
    const minInterval = 1000 / REDRAW_FPS;
    const delay = Math.max(0, minInterval - (now - this.lastUpdateTs));
    this.pendingUpdate = true;
    setTimeout(() => {
      this.pendingUpdate = false;
      this.lastUpdateTs = performance.now();
      this.updateData();
    }, delay);
  }

  private updateData(): void {
    if (!this.plot) {
      this.rebuild();
      return;
    }
    const { data } = this.buildAlignedData();
    this.plot.setData(data, true);
  }

  /**
   * Which run each drawn series belongs to, in uPlot series order (index 0 of
   * this array = uPlot series 1). The draw hook needs it to stamp the run's
   * marker shape along the right lines.
   */
  private seriesMeta: Array<{ shape: MarkerShape; color: string; scale: string }> = [];

  /** All tracks (saved visible runs + active run) merged into AlignedData. */
  private buildAlignedData(): { data: AlignedData; series: Series[] } {
    const visibleRuns = this.visibleRuns;
    const channels = this.plottedChannels;

    if (visibleRuns.length === 0 || channels.length === 0) {
      const series: Series[] = [
        { label: t('chart.time') },
        { label: '—', stroke: 'transparent', spanGaps: false, points: { show: false } },
      ];
      this.seriesMeta = [];
      return { data: [[0, 1], [null, null]] as AlignedData, series };
    }

    const timeKeys = new Set<number>();
    for (const r of visibleRuns) {
      for (const tv of r.times) timeKeys.add(Math.round(tv * 1000) / 1000);
    }
    const x = [...timeKeys].sort((a, b) => a - b);

    const series: Series[] = [{ label: t('chart.time') }];
    // uPlot wants gaps as null. NaN is *not* equivalent: it survives uPlot's
    // null check and then loses every comparison, so a series that opens with
    // NaN (a derived channel, before its window has filled) ends up with no
    // scale range at all and is silently never drawn.
    const ys: (number | null)[][] = [];
    const colorByRun = visibleRuns.length > 1;
    const meta: Array<{ shape: MarkerShape; color: string; scale: string }> = [];

    for (let runIdx = 0; runIdx < visibleRuns.length; runIdx++) {
      const r = visibleRuns[runIdx];
      if (!r) continue;
      const runTimeIdx = new Map<number, number>();
      r.times.forEach((tv, i) => runTimeIdx.set(Math.round(tv * 1000) / 1000, i));

      for (let chIdx = 0; chIdx < channels.length; chIdx++) {
        const ch = channels[chIdx];
        if (!ch) continue;
        const unit = displayUnit(ch.unit);
        const yArr = new Array<number | null>(x.length);
        const sourceCol = r.values[ch.id] ?? [];
        for (let i = 0; i < x.length; i++) {
          const xv = x[i]!;
          const sourceIdx = runTimeIdx.get(xv);
          const raw = sourceIdx === undefined ? NaN : (sourceCol[sourceIdx] ?? NaN);
          yArr[i] = Number.isFinite(raw) ? convert(raw, ch.unit, unit) : null;
        }
        ys.push(yArr);

        const isActive = r === this.activeRun;
        const label = colorByRun
          ? `${r.name} — ${t(ch.nameKey)} (${unit})`
          : `${t(ch.nameKey)} (${unit})`;
        // The dash always means the quantity — independently of which of the
        // two dimensions the colour happens to be carrying right now.
        const dash = dashForChannel(chIdx);
        const stroke = colorByRun ? r.color : channelColorForIndex(chIdx);
        const s: Series = {
          label,
          scale: ch.id,
          stroke,
          width: isActive ? 2 : 1.5,
          spanGaps: false,
          points: { show: false },
        };
        if (dash.length > 0) s.dash = [...dash];
        series.push(s);
        meta.push({ shape: shapeForRun(runIdx), color: stroke, scale: ch.id });
      }
    }

    this.seriesMeta = meta;
    return { data: [x, ...ys] as AlignedData, series };
  }

  private rebuild(): void {
    this.plot?.destroy();
    this.plot = null;

    const rect = this.container.getBoundingClientRect();
    const width = Math.max(200, Math.floor(rect.width));
    const height = Math.max(200, Math.floor(rect.height));

    const axisColor = cssVar('--chart-axis') || '#666';
    const gridColor = cssVar('--chart-grid') || '#ddd';
    const channels = this.plottedChannels;
    const colorByRun = this.visibleRuns.length > 1;

    const { data, series } = this.buildAlignedData();

    // X axis grows in fixed steps (default 10 s) so a live recording doesn't
    // re-scale on every sample. The max snaps to the next multiple of
    // X_STEP_SECONDS; the min is anchored at 0 (run-relative time).
    const X_STEP_SECONDS = 10;
    const scales: Options['scales'] = {
      x: {
        time: false,
        range: (_u, dataMin, dataMax) => {
          if (!Number.isFinite(dataMax)) return [0, X_STEP_SECONDS];
          const stepped = Math.max(
            X_STEP_SECONDS,
            Math.ceil(dataMax / X_STEP_SECONDS) * X_STEP_SECONDS,
          );
          const min = Number.isFinite(dataMin) ? Math.min(0, dataMin) : 0;
          return [min, stepped];
        },
      },
    };
    for (const ch of channels) {
      scales[ch.id] = { auto: this.autoscale };
    }

    const labelFont = '600 12px system-ui, sans-serif';
    const axes: Axis[] = [
      {
        stroke: axisColor,
        label: t('chart.time'),
        labelFont,
        labelSize: 22,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: axisColor, width: 1 },
      },
      ...channels.map((ch, idx): Axis => {
        // The axis carries the quantity's color only while the lines do too;
        // with several runs on screen the color means "run", so a colored
        // axis would claim a quantity belongs to one of them.
        const color = colorByRun ? axisColor : channelColorForIndex(idx);
        return {
          scale: ch.id,
          stroke: color,
          label: `${t(ch.nameKey)} (${displayUnit(ch.unit)})`,
          labelFont,
          labelSize: 20,
          // Only the first y axis draws grid lines: one grid per quantity
          // would overlay several inconsistent rasters on the same plot.
          grid: { show: idx === 0, stroke: gridColor, width: 1 },
          ticks: { stroke: color, width: 1 },
          side: (idx % 2 === 0 ? 3 : 1) as 1 | 3,
        };
      }),
    ];

    const callbacks = this.callbacks;
    const visibleRuns = this.visibleRuns;
    // Markers only earn their keep once there is more than one run to tell
    // apart; with a single run the dash already identifies every line.
    const drawMarkers = visibleRuns.length > 1;
    const chartBg = cssVar('--chart-bg') || '#ffffff';
    const seriesMeta = this.seriesMeta;
    // Each quantity has its own scale, so "y = 0" sits at a different height
    // for each of them. Mark the first one that actually crosses zero and
    // paint the line in that quantity's color, so it is obvious which axis
    // the zero belongs to instead of leaving the reader to guess.
    const zeroLine = channels
      .map((ch, idx) => ({ id: ch.id, color: colorByRun ? axisColor : channelColorForIndex(idx) }))
      .find(({ id }) => {
        const run = visibleRuns.find((r) => r.values[id]?.some((v) => v < 0));
        return run !== undefined;
      });

    const opts: Options = {
      width,
      height,
      series,
      scales,
      axes,
      legend: { show: width >= LEGEND_MIN_WIDTH, live: true },
      cursor: { drag: { x: true, y: false, uni: 50 } },
      hooks: {
        setSelect: [
          (u) => {
            if (!callbacks.onSelection) return;
            const sel = u.select;
            if (!sel || sel.width === 0) {
              callbacks.onSelection(null);
              return;
            }
            const xMin = u.posToVal(sel.left, 'x');
            const xMax = u.posToVal(sel.left + sel.width, 'x');
            if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) {
              callbacks.onSelection(null);
              return;
            }
            callbacks.onSelection({ tMin: xMin, tMax: xMax });
          },
        ],
        draw: [
          (u) => {
            const ctx = u.ctx;
            ctx.save();

            // Run markers: the colour-free way to see which run a line is.
            if (drawMarkers) {
              ctx.save();
              ctx.beginPath();
              ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
              ctx.clip();
              for (let si = 0; si < seriesMeta.length; si++) {
                const m = seriesMeta[si];
                if (!m) continue;
                const col = u.data[si + 1] as (number | null)[] | undefined;
                if (!col) continue;
                let lastX = -Infinity;
                for (let i = 0; i < col.length; i++) {
                  const v = col[i];
                  if (v === null || v === undefined || !Number.isFinite(v)) continue;
                  const xv = (u.data[0] as number[])[i];
                  if (xv === undefined) continue;
                  const xPx = u.valToPos(xv, 'x', true);
                  if (xPx < u.bbox.left || xPx > u.bbox.left + u.bbox.width) continue;
                  if (xPx - lastX < MARKER_SPACING_PX * devicePixelRatio) continue;
                  lastX = xPx;
                  const yPx = u.valToPos(v, m.scale, true);
                  if (!Number.isFinite(yPx)) continue;
                  drawMarker(
                    ctx,
                    m.shape,
                    xPx,
                    yPx,
                    MARKER_SIZE_PX * devicePixelRatio,
                    m.color,
                    chartBg,
                  );
                }
              }
              ctx.restore();
            }

            // Zero line of the first quantity's scale. With two scales the
            // two zeros sit at different heights, so mark the one the leftmost
            // (labelled) axis belongs to instead of leaving both implicit.
            if (zeroLine) {
              const scale = u.scales[zeroLine.id];
              if (
                scale &&
                scale.min !== undefined &&
                scale.max !== undefined &&
                scale.min < 0 &&
                scale.max > 0
              ) {
                const yPx = u.valToPos(0, zeroLine.id, true);
                ctx.strokeStyle = zeroLine.color;
                ctx.globalAlpha = 0.45;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(u.bbox.left, yPx);
                ctx.lineTo(u.bbox.left + u.bbox.width, yPx);
                ctx.stroke();
                ctx.globalAlpha = 1;
              }
            }

            // Annotation markers: vertical line + label across all visible runs.
            ctx.strokeStyle = cssVar('--accent') || '#1B5E20';
            ctx.fillStyle = cssVar('--accent') || '#1B5E20';
            ctx.lineWidth = 1.5;
            ctx.font = '11px system-ui, sans-serif';
            ctx.textBaseline = 'top';
            const yTop = u.bbox.top;
            const yBot = u.bbox.top + u.bbox.height;
            for (const r of visibleRuns) {
              for (const a of r.annotations) {
                const xPx = u.valToPos(a.t, 'x', true);
                if (xPx < u.bbox.left || xPx > u.bbox.left + u.bbox.width) continue;
                ctx.beginPath();
                ctx.setLineDash([3, 3]);
                ctx.moveTo(xPx, yTop);
                ctx.lineTo(xPx, yBot);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillText(`📍 ${a.label}`, xPx + 4, yTop + 4);
              }
            }
            ctx.restore();
          },
        ],
      },
    };

    this.container.innerHTML = '';
    this.plot = new uPlot(opts, data, this.container);
    this.fitToContainer();
  }
}
