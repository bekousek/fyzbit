import uPlot from 'uplot';
import type { Options, Series, AlignedData } from 'uplot';
import 'uplot/dist/uPlot.min.css';

import type { Channel, Run } from '../state/AppState';
import { cssVar, onThemeChange } from '../theme/theme';
import { onLanguageChange, t } from '../i18n/i18n';

const REDRAW_FPS = 30;
const MAX_ACTIVE_POINTS = 6000;

export type SelectionRange = { tMin: number; tMax: number } | null;

export type ChartCallbacks = {
  onSelection?: (range: SelectionRange) => void;
  /** Returns label entered by user, or null if cancelled. */
  promptAnnotation?: () => string | null;
  /** A held? Asked at the moment of click. */
  isAnnotationModifierHeld?: () => boolean;
  /** Called when user clicks chart while annotation modifier is held. */
  onAnnotationClick?: (tSec: number, label: string) => void;
};

/**
 * Multi-run uPlot wrapper with selection callback and annotation painting.
 *
 * Each visible run contributes one series per channel. Runs share a common
 * X axis (seconds since each run's own start); we build a union of all time
 * points across visible runs and pad missing samples with NaN.
 *
 * Annotations are painted on top via uPlot's `hooks.draw`. Adding a new one
 * is triggered by chart click when the caller's modifier callback returns
 * true (typically: A held on keyboard).
 */
export class Chart {
  private plot: uPlot | null = null;
  private resizeObs: ResizeObserver | null = null;
  private channels: Channel[] = [];
  private runs: Run[] = [];
  private activeRun: Run | null = null;
  private autoscale = true;
  private pendingRedraw = false;
  private lastRedrawTs = 0;
  private disposers: Array<() => void> = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: ChartCallbacks = {},
  ) {
    this.disposers.push(onThemeChange(() => this.rebuild()));
    this.disposers.push(onLanguageChange(() => this.rebuild()));

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

  setRuns(saved: readonly Run[], active: Run | null): void {
    this.runs = [...saved];
    this.activeRun = active;
    this.scheduleRedraw(true);
  }

  notifyActivePointAppended(): void {
    if (this.activeRun && this.activeRun.times.length > MAX_ACTIVE_POINTS) {
      this.activeRun.times.shift();
      for (const ch of this.activeRun.channels) {
        this.activeRun.values[ch.id]?.shift();
      }
    }
    this.scheduleRedraw();
  }

  setAutoscale(on: boolean): void {
    this.autoscale = on;
    if (on) this.scheduleRedraw(true);
  }

  resetZoom(): void {
    this.scheduleRedraw(true);
    this.callbacks.onSelection?.(null);
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
    const label = this.callbacks.promptAnnotation?.() ?? null;
    if (!label) return;
    this.callbacks.onAnnotationClick?.(tSec, label);
  };

  private handleResize(): void {
    if (!this.plot) return;
    const rect = this.container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.plot.setSize({ width: rect.width, height: rect.height });
    }
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

  /** All tracks (saved visible runs + active run) merged into AlignedData. */
  private buildAlignedData(): { data: AlignedData; series: Series[] } {
    const visibleRuns: Run[] = [
      ...this.runs.filter((r) => r.visible),
      ...(this.activeRun ? [this.activeRun] : []),
    ];

    if (visibleRuns.length === 0 || this.channels.length === 0) {
      const series: Series[] = [
        { label: t('chart.time') },
        { label: '—', stroke: 'transparent', spanGaps: false, points: { show: false } },
      ];
      return { data: [[0, 1], [NaN, NaN]] as AlignedData, series };
    }

    const timeKeys = new Set<number>();
    for (const r of visibleRuns) {
      for (const tv of r.times) timeKeys.add(Math.round(tv * 1000) / 1000);
    }
    const x = [...timeKeys].sort((a, b) => a - b);

    const series: Series[] = [{ label: t('chart.time') }];
    const ys: number[][] = [];

    for (let runIdx = 0; runIdx < visibleRuns.length; runIdx++) {
      const r = visibleRuns[runIdx];
      if (!r) continue;
      const runTimeIdx = new Map<number, number>();
      r.times.forEach((tv, i) => runTimeIdx.set(Math.round(tv * 1000) / 1000, i));

      for (let chIdx = 0; chIdx < this.channels.length; chIdx++) {
        const ch = this.channels[chIdx];
        if (!ch) continue;
        const yArr = new Array<number>(x.length);
        const sourceCol = r.values[ch.id] ?? [];
        for (let i = 0; i < x.length; i++) {
          const xv = x[i]!;
          const sourceIdx = runTimeIdx.get(xv);
          yArr[i] = sourceIdx === undefined ? NaN : (sourceCol[sourceIdx] ?? NaN);
        }
        ys.push(yArr);

        const isActive = r === this.activeRun;
        const stroke = r.color;
        const label =
          visibleRuns.length > 1
            ? `${r.name} — ${t(ch.nameKey)} (${ch.unit})`
            : `${t(ch.nameKey)} (${ch.unit})`;
        const s: Series = {
          label,
          scale: ch.id,
          stroke,
          width: isActive ? 2 : 1.5,
          dash: isActive ? undefined : [4, 3],
          spanGaps: false,
          points: { show: false },
        };
        series.push(s);
      }
    }

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

    const { data, series } = this.buildAlignedData();

    const scales: Options['scales'] = {
      x: { time: false },
    };
    for (const ch of this.channels) {
      scales[ch.id] = { auto: this.autoscale };
    }

    const callbacks = this.callbacks;
    const visibleRuns: Run[] = [
      ...this.runs.filter((r) => r.visible),
      ...(this.activeRun ? [this.activeRun] : []),
    ];

    const opts: Options = {
      width,
      height,
      series,
      scales,
      axes: [
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: axisColor, width: 1 },
        },
        ...this.channels.map((ch, idx) => ({
          scale: ch.id,
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: axisColor, width: 1 },
          side: (idx === 0 ? 3 : 1) as 1 | 3,
        })),
      ],
      legend: { show: true, live: true },
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
            // Paint annotation markers as vertical lines + label across all visible runs.
            const ctx = u.ctx;
            ctx.save();
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
  }
}
