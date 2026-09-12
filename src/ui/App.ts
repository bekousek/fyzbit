import type { Transport, TransportKind } from '../transport/Transport';
import { appState, type Channel } from '../state/AppState';
import { LineBuffer, parseLine } from '../protocol/Parser';
import {
  Commands,
  RECOMMENDED_RATE_HZ,
  SENSOR_NAMES,
  type SensorName,
} from '../protocol/Commands';
import { Deriver, planDerivedChannels, type DerivedSpec } from '../state/derive';
import { settings, type SamplingHz } from '../state/Settings';
import { t, onLanguageChange, applyTranslations } from '../i18n/i18n';
import { Chart, type ChartView, type SelectionRange } from './Chart';
import { TopBar } from './TopBar';
import { SensorSelect } from './SensorSelect';
import { WiringDiagram } from './WiringDiagram';
import { ChannelControls } from './ChannelControls';
import { ChartDataView } from './ChartDataView';
import { announce } from './LiveRegion';
import { MobileNav } from './MobileNav';
import { PanelExpand } from './PanelExpand';
import { SettingsModal } from './SettingsModal';
import { ConnectionModal } from './ConnectionModal';
import { RunsList } from './RunsList';
import { SelectionStats } from './SelectionStats';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { ShortcutsHelp } from './ShortcutsHelp';
import { PdfExportModal } from './PdfExportModal';
import { CalibrationModal } from './CalibrationModal';
import { RecoveryModal } from './RecoveryModal';
import { toast } from './Toast';
import { showAlert, showConfirm, showPrompt } from './Dialog';
import { AutoSave } from '../state/AutoSave';
import { storage } from '../state/Storage';
import {
  buildRunsCsv,
  buildAnnotationsCsv,
  downloadCsv,
  timestampedFilename,
} from '../export/csv';
import { exportChartPng, findChartCanvas } from '../export/png';

/** How long to wait for a board to answer #HELLO? before asking again. */
const HANDSHAKE_RETRY_MS = 700;
/** How many times to ask, before telling the user to press A+B themselves. */
const HANDSHAKE_ATTEMPTS = 8;
/**
 * Minimum gap between two "sensor unreadable" toasts. The board reports the
 * failure once per sample, and a toast a second is noise, not information.
 */
const SENSOR_ERROR_TOAST_MS = 15000;
/**
 * How long the stream may go quiet before the app says so. Generous on
 * purpose: the sonar sends nothing at all while its target is out of range,
 * and a slow sensor is allowed a second between samples.
 */
const DATA_GAP_MS = 5000;

/**
 * App — top-level orchestrator. Wires transport → parser → AppState → UI.
 */
export class App {
  private chart!: Chart;
  private sensorSelect!: SensorSelect;
  private mobileNav!: MobileNav;
  private panelExpand!: PanelExpand;
  private wiringDiagram!: WiringDiagram;
  private connectionModal!: ConnectionModal;
  private selectionStats!: SelectionStats;
  private shortcuts!: KeyboardShortcuts;
  private shortcutsHelp!: ShortcutsHelp;
  private pdfExportModal!: PdfExportModal;
  private calibrationModal!: CalibrationModal;
  private autoSave!: AutoSave;
  private recoveryModal!: RecoveryModal;
  private calibrationListeners = new Set<
    (msg: {
      channelId: string;
      ok: boolean;
      factor?: number;
      previousFactor?: number;
    }) => void
  >();

  private transport: Transport | null = null;
  private transportKind: TransportKind | null = null;
  private handshakeTimer: number | null = null;
  private lastSensorErrorMs = Number.NEGATIVE_INFINITY;
  private lastDataMs = 0;
  private dataGapTimer: number | null = null;
  private dataGapReported = false;
  private streamStartMs = 0;
  private currentSensor: SensorName | null = null;
  /** Channels announced by the firmware, before derived ones are added. */
  private reportedChannels: Channel[] = [];
  private deriver: Deriver | null = null;

  start(): void {
    const root = document.getElementById('app');
    if (!root) throw new Error('App: #app root not found');

    new TopBar(root, appState);
    this.sensorSelect = new SensorSelect(root, appState, (cmd) => this.sendCommand(cmd));
    this.wiringDiagram = new WiringDiagram(root);
    new ChannelControls(root, appState);
    new SettingsModal();
    new RunsList(appState);
    this.connectionModal = new ConnectionModal();
    this.shortcutsHelp = new ShortcutsHelp();
    this.selectionStats = new SelectionStats(appState);
    this.pdfExportModal = new PdfExportModal(appState);
    this.calibrationModal = new CalibrationModal({
      state: appState,
      send: (cmd) => this.sendCommand(cmd),
      onCalibrationReply: (handler) => {
        this.calibrationListeners.add(handler);
        return () => this.calibrationListeners.delete(handler);
      },
    });
    this.autoSave = new AutoSave(appState, () => toast.warn(t('error.storageSaveFailed'), 0));
    this.recoveryModal = new RecoveryModal(appState, this.autoSave);
    new ChartDataView(appState, announce);

    const chartHost = document.getElementById('chart-container');
    if (!chartHost) throw new Error('App: #chart-container not found');
    this.chart = new Chart(chartHost, {
      onSelection: (range: SelectionRange) => this.selectionStats.setRange(range),
      isAnnotationModifierHeld: () => this.shortcuts.isAnnotationModifierHeld(),
      promptAnnotation: () => this.promptAnnotationLabel(),
      onAnnotationClick: (tSec, label) => {
        appState.addAnnotation({ t: tSec, label });
      },
      onViewChange: (view) => this.renderChartView(view),
    });

    // Switching sections or expanding a panel hides/shows the chart container;
    // uPlot has to be told its new size once it is back on screen.
    this.mobileNav = new MobileNav(root, () => {
      this.panelExpand.reset();
      this.chart.refresh();
    });
    this.panelExpand = new PanelExpand(root, () => this.chart.refresh());

    this.shortcuts = new KeyboardShortcuts({
      start: () => {
        const startBtn = document.getElementById('btn-start') as HTMLButtonElement | null;
        if (startBtn && !startBtn.disabled) startBtn.click();
      },
      tare: () => {
        const tareBtn = document.getElementById('btn-tare') as HTMLButtonElement | null;
        if (tareBtn && !tareBtn.disabled) tareBtn.click();
      },
      save: () => {
        const saveBtn = document.getElementById('btn-save-run') as HTMLButtonElement | null;
        if (saveBtn && !saveBtn.disabled) saveBtn.click();
      },
      newRun: () => {
        const newBtn = document.getElementById('btn-new-run') as HTMLButtonElement | null;
        if (newBtn && !newBtn.disabled) newBtn.click();
      },
      annotation: () => void this.addAnnotationAtCursor(),
      zoomIn: () => this.chart.zoomIn(),
      zoomOut: () => this.chart.zoomOut(),
      panLeft: () => this.chart.panLeft(),
      panRight: () => this.chart.panRight(),
      exportCsv: () => this.exportCsv(),
      exportPdf: () => this.exportPdf(),
      help: () => this.shortcutsHelp.toggle(),
    });

    // Help button in chart toolbar.
    document.getElementById('btn-help')?.addEventListener('click', () =>
      this.shortcutsHelp.toggle(),
    );

    // Chart wiring: react to channels/runs changes and per-sample appends.
    appState.bus.on('channels-changed', (channels) => {
      this.chart.setChannels([...channels]);
      this.chart.setVisibleChannels(appState.visibleChannelIds);
    });
    appState.bus.on('channel-visibility-changed', (ids) => {
      this.chart.setVisibleChannels(ids);
    });
    appState.bus.on('runs-changed', (runs) => {
      this.chart.setRuns(runs, appState.activeRun);
    });
    appState.bus.on('active-run-changed', (run) => {
      this.chart.setRuns(appState.runs, run);
    });
    appState.bus.on('data-point', () => {
      if (appState.recording) this.chart.notifyActivePointAppended();
    });

    onLanguageChange(() => applyTranslations(document));

    this.wireAnnouncements();

    // About / version label.
    const versionEl = document.getElementById('about-version');
    const renderVersion = () => {
      if (versionEl) {
        versionEl.textContent = t('settings.version', { version: __APP_VERSION__ });
      }
    };
    renderVersion();
    onLanguageChange(renderVersion);

    this.wireConnectButton();
    this.wireRecordButtons();
    this.wireChartToolbar();
    this.wireRecordingStateButtons();

    // Defer browser-state-dependent buttons.
    this.updateButtonStates();
    appState.bus.on('connection-status', () => this.updateButtonStates());
    appState.bus.on('recording-changed', () => this.updateButtonStates());
    appState.bus.on('active-run-changed', () => this.updateButtonStates());
    appState.bus.on('runs-changed', () => this.updateButtonStates());

    settings.onSamplingChange(() => this.sendCommand(Commands.rate(this.effectiveRate())));

    // Storage: start auto-save and offer to recover any prior session.
    this.autoSave.start();
    void this.recoveryModal.maybeShow();
  }

  // ──────────────────────────────────────────────────────────
  // Wiring
  // ──────────────────────────────────────────────────────────

  private wireConnectButton(): void {
    const connectBtn = document.getElementById('btn-connect') as HTMLButtonElement | null;
    if (!connectBtn) return;
    connectBtn.addEventListener('click', () => void this.handleConnectClick());
    const updateLabel = () => {
      const mode = this.connectButtonMode();
      const span = connectBtn.querySelector('.btn__label');
      if (span) {
        span.removeAttribute('data-i18n');
        span.textContent = t(
          mode === 'cancel'
            ? 'connection.cancelConnect'
            : mode === 'disconnect'
              ? 'connection.disconnect'
              : 'button.connect',
        );
      }
      connectBtn.classList.toggle('btn--primary', mode === 'connect');
      connectBtn.classList.toggle('btn--danger', mode === 'cancel');
    };
    updateLabel();
    appState.bus.on('connection-status', updateLabel);
    onLanguageChange(updateLabel);
  }

  /**
   * What the top-bar button does right now. "connecting"/"handshake" mean the
   * browser picker is open or the board hasn't finished announcing itself —
   * both are states the user must be able to back out of, so the button offers
   * to cancel rather than pretending nothing is happening.
   */
  private connectButtonMode(): 'connect' | 'cancel' | 'disconnect' {
    const s = appState.status;
    if (s === 'connecting' || s === 'handshake') return 'cancel';
    if (this.isConnectedStatus(s)) return 'disconnect';
    return 'connect';
  }

  private wireRecordButtons(): void {
    const startBtn = document.getElementById('btn-start') as HTMLButtonElement | null;
    const tareBtn = document.getElementById('btn-tare') as HTMLButtonElement | null;
    const saveBtn = document.getElementById('btn-save-run') as HTMLButtonElement | null;
    const newBtn = document.getElementById('btn-new-run') as HTMLButtonElement | null;
    const calibrateBtn = document.getElementById('btn-calibrate') as HTMLButtonElement | null;

    startBtn?.addEventListener('click', () => this.toggleRecording());
    tareBtn?.addEventListener('click', () => this.sendCommand(Commands.tare()));
    saveBtn?.addEventListener('click', () => this.saveCurrentRun());
    newBtn?.addEventListener('click', () => this.newRun());
    calibrateBtn?.addEventListener('click', () => this.calibrationModal.open());

    const updateStartLabel = () => {
      if (!startBtn) return;
      const span = startBtn.querySelector('.btn__label');
      if (!span) return;
      span.removeAttribute('data-i18n');
      span.textContent = appState.recording ? t('button.stop') : t('button.start');
      const icon = startBtn.querySelector('.btn__icon');
      if (icon) icon.textContent = appState.recording ? '\u25A0' : '\u25B6';
      startBtn.classList.toggle('btn--primary', !appState.recording);
      startBtn.classList.toggle('btn--danger', appState.recording);
    };
    updateStartLabel();
    appState.bus.on('recording-changed', updateStartLabel);
    onLanguageChange(updateStartLabel);
  }

  private wireChartToolbar(): void {
    const autoBtn = document.getElementById('btn-autoscale') as HTMLButtonElement | null;
    if (autoBtn) {
      autoBtn.addEventListener('click', () => {
        const on = autoBtn.getAttribute('aria-pressed') !== 'true';
        autoBtn.setAttribute('aria-pressed', String(on));
        this.chart.setAutoscale(on);
      });
    }
    document.getElementById('btn-reset-zoom')?.addEventListener('click', () =>
      this.chart.resetZoom(),
    );
    document.getElementById('btn-zoom-in')?.addEventListener('click', () =>
      this.chart.zoomIn(),
    );
    document.getElementById('btn-zoom-out')?.addEventListener('click', () =>
      this.chart.zoomOut(),
    );

    const windowSelect = document.getElementById('select-time-window');
    if (windowSelect instanceof HTMLSelectElement) {
      windowSelect.addEventListener('change', () => {
        const raw = windowSelect.value;
        this.chart.setTimeWindow(raw === 'auto' ? null : Number(raw));
      });
    }
    this.renderChartView(this.chart.view());
  }

  /**
   * Mirror the chart's time view into the toolbar. A zoom drops the rolling
   * window, and during a recording it also stops the view from following the
   * newest sample — so both controls have to say what is actually going on,
   * or the chart just looks frozen.
   */
  private renderChartView(view: ChartView): void {
    const sel = document.getElementById('select-time-window');
    if (sel instanceof HTMLSelectElement) {
      sel.value = view.windowSeconds === null ? 'auto' : String(view.windowSeconds);
    }
    const resetBtn = document.getElementById('btn-reset-zoom');
    if (resetBtn instanceof HTMLButtonElement) resetBtn.disabled = !view.zoomed;
  }

  /** Export buttons (CSV/PNG immediate; PDF opens metadata modal first). */
  private wireRecordingStateButtons(): void {
    document
      .getElementById('btn-export-csv')
      ?.addEventListener('click', () => this.exportCsv());
    document
      .getElementById('btn-export-png')
      ?.addEventListener('click', () => this.exportPng());
    document
      .getElementById('btn-export-pdf')
      ?.addEventListener('click', () => this.exportPdf());
    document
      .getElementById('btn-reset-data')
      ?.addEventListener('click', () => void this.resetAllData());
  }

  private async resetAllData(): Promise<void> {
    const confirmed = await showConfirm(t('resetData.confirm'), {
      okLabel: t('settings.resetData'),
      danger: true,
    });
    if (!confirmed) return;
    if (this.transport && this.transport.isConnected()) {
      await this.transport.disconnect();
      this.transport = null;
    }
    this.autoSave.stop();
    const cleared = await storage.clearAll();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    appState.reset();
    this.autoSave.start();
    if (cleared) {
      await showAlert(t('resetData.done'));
    } else {
      await showAlert(t('resetData.failed'));
    }
  }

  private hasAnyData(): boolean {
    return appState.runs.length > 0 || appState.activeRun !== null;
  }

  private exportCsv(): void {
    if (!this.hasAnyData()) return;
    const runs = [
      ...appState.runs.filter((r) => r.visible),
      ...(appState.activeRun ? [appState.activeRun] : []),
    ];
    const channels = [...appState.channels];
    const main = buildRunsCsv({ runs, channels });
    downloadCsv(main, timestampedFilename('FyzBit_mereni', 'csv'));
    // If there are any annotations, also emit the annotations CSV.
    if (runs.some((r) => r.annotations.length > 0)) {
      const ann = buildAnnotationsCsv({ runs, channels });
      downloadCsv(ann, timestampedFilename('FyzBit_anotace', 'csv'));
    }
  }

  private exportPng(): void {
    if (!this.hasAnyData()) return;
    const canvas = findChartCanvas(document.getElementById('chart-container'));
    exportChartPng(canvas);
  }

  private exportPdf(): void {
    if (!this.hasAnyData()) return;
    this.pdfExportModal.open();
  }

  // ──────────────────────────────────────────────────────────
  // High-level actions
  // ──────────────────────────────────────────────────────────

  private async handleConnectClick(): Promise<void> {
    const mode = this.connectButtonMode();
    if (mode !== 'connect') {
      if (appState.recording) appState.stopRecording();
      // disconnect() drops the reference too, so a connect() still waiting on
      // the browser's device picker knows it has been abandoned.
      this.disconnect();
      appState.setStatus('disconnected');
      appState.setSensorName('');
      return;
    }
    const req = await this.connectionModal.open();
    if (!req) return;
    await this.connect(req.transport, req.label, req.kind);
  }

  /**
   * START/STOP is a decision about *recording*, not about the board: the
   * firmware streams from the moment it is connected (see the READY branch of
   * handleLine) and keeps streaming between runs. That is what keeps the live
   * value alive with nothing recording — and it is the only way TARE can work
   * before a measurement, because the firmware applies a pending tare inside
   * its sampling loop, so a board told to stop has nothing to zero.
   */
  private toggleRecording(): void {
    if (!this.isConnectedStatus(appState.status)) return;
    if (appState.recording) {
      appState.stopRecording();
      return;
    }
    if (appState.activeRun) {
      // Resume an existing buffer. Its samples are stamped in the time base
      // that has been running all along, so that base has to survive the
      // pause — restarting it would append times that run backwards.
      appState.resumeRecording();
    } else {
      appState.startRun(this.effectiveRate(), (n) => t('runs.runName', { n }));
      // A fresh run starts at t = 0, and the derivation window still holds
      // samples stamped in the old base.
      this.streamStartMs = 0;
      this.deriver?.reset();
    }
    this.mobileNav.show('chart');
  }

  private saveCurrentRun(): void {
    if (!appState.activeRun) return;
    if (appState.recording) appState.stopRecording();
    const saved = appState.saveActiveRun();
    if (saved) announce(t('a11y.liveRunSaved', { name: saved.name }));
  }

  private newRun(): void {
    if (appState.activeRun) appState.discardActiveRun();
    // The next START click will create a fresh active run.
  }

  private async promptAnnotationLabel(): Promise<string | null> {
    const label = await showPrompt(t('annotation.promptLabel'), '');
    return label && label.trim() ? label.trim() : null;
  }

  /** Keyboard-only annotation path (Shift+A): marks the active run's latest sample. */
  private async addAnnotationAtCursor(): Promise<void> {
    const run = appState.activeRun;
    if (!run || run.times.length === 0) return;
    const tSec = run.times[run.times.length - 1]!;
    const label = await this.promptAnnotationLabel();
    if (!label) return;
    appState.addAnnotation({ t: tSec, label });
  }

  /**
   * Everything a sighted user reads off the status badge and the START button,
   * spoken once per change. Deliberately excludes the streaming value — see
   * LiveRegion.ts.
   */
  private wireAnnouncements(): void {
    appState.bus.on('connection-status', (status) => {
      switch (status) {
        case 'connecting':
          announce(t('a11y.liveConnecting'));
          break;
        case 'connected':
        case 'measuring':
          announce(t('a11y.liveConnected', { sensor: appState.sensorName || '—' }));
          break;
        case 'disconnected':
          announce(t('a11y.liveDisconnected'));
          break;
        case 'error':
          announce(t('a11y.liveError'));
          break;
        default:
          break;
      }
    });
    appState.bus.on('recording-changed', (recording) => {
      if (recording) {
        announce(t('a11y.liveRecordingStarted'));
      } else {
        announce(
          t('a11y.liveRecordingStopped', { count: appState.activeRun?.times.length ?? 0 }),
        );
      }
    });
  }

  private updateButtonStates(): void {
    const connected = this.isConnectedStatus(appState.status);
    const hasActive = appState.activeRun !== null;
    const recording = appState.recording;

    const setEnabled = (id: string, enabled: boolean) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el) el.disabled = !enabled;
    };
    setEnabled('btn-start', connected);
    setEnabled('btn-tare', connected);
    setEnabled('btn-save-run', hasActive);
    setEnabled('btn-new-run', hasActive && !recording);
    setEnabled('btn-calibrate', connected && !recording);
    const hasData = this.hasAnyData();
    setEnabled('btn-export-csv', hasData);
    setEnabled('btn-export-pdf', hasData);
    setEnabled('btn-export-png', hasData);
  }

  // ──────────────────────────────────────────────────────────
  // Transport / protocol plumbing
  // ──────────────────────────────────────────────────────────

  async connect(transport: Transport, label: string, kind: TransportKind): Promise<void> {
    this.disconnect();
    this.transport = transport;
    this.transportKind = kind;
    this.reportedChannels = [];
    this.deriver = null;
    this.lastSensorErrorMs = Number.NEGATIVE_INFINITY;
    appState.setSensorName(label);
    appState.setStatus('connecting');

    // Held by the chunk closure alone: it dies with the transport that feeds it.
    const buffer = new LineBuffer((line) => this.handleLine(line));
    transport.onChunk((chunk) => {
      // Bytes from a transport the user has already cancelled or replaced are
      // not ours to parse.
      if (this.transport !== transport) return;
      buffer.push(chunk);
    });
    transport.onDisconnect(() => {
      // A transport the user already walked away from must not drag the UI
      // back to "disconnected" after a newer one has taken over.
      if (this.transport !== transport) return;
      const wasMeasuring = appState.recording;
      appState.stopRecording();
      appState.setStatus('disconnected');
      if (wasMeasuring) toast.error(t('error.connectionLost'));
    });

    try {
      await transport.connect();
      if (this.transport !== transport) {
        // Cancelled while the picker was open, yet the user still chose a
        // device — close it again rather than leaving the port held open.
        void transport.disconnect();
      } else {
        this.requestHandshake(transport);
        this.startDataGapWatch(transport);
      }
    } catch (err) {
      if (this.transport !== transport) return;
      const msg = (err as Error)?.message ?? String(err);
      // User-cancelled device/port pickers are not actual errors. Web Serial
      // says "no port selected"; Web Bluetooth (via @microbit/microbit-connection)
      // says "No device selected".
      if (/(canceled|cancelled|no (port|device) selected)/i.test(msg)) {
        appState.setStatus('disconnected');
        appState.setSensorName('');
      } else {
        console.error('[App] connect failed:', err);
        appState.setStatus('error');
        toast.error(msg);
      }
    }
  }

  disconnect(): void {
    this.clearHandshakeTimer();
    this.clearDataGapWatch();
    if (this.transport) {
      void this.transport.disconnect();
      this.transport = null;
    }
    this.transportKind = null;
    this.streamStartMs = 0;
    this.reportedChannels = [];
    this.deriver = null;
    this.currentSensor = null;
  }

  /**
   * Hand the firmware's channels to AppState, plus anything the app computes
   * from them (see state/derive.ts). Derived channels start switched off.
   */
  private publishChannels(): void {
    const plan = planDerivedChannels(this.reportedChannels);
    const source = plan.specs[0]
      ? this.reportedChannels.find((c) => c.id === plan.specs[0]!.sourceId)
      : undefined;
    this.deriver = source ? new Deriver(plan.specs as DerivedSpec[], source) : null;
    appState.setChannels(plan.channels, plan.hiddenIds);
  }

  /**
   * Ask the board to introduce itself, and keep asking until it does.
   *
   * The firmware volunteers its handshake twice: once ~200 ms after boot, and
   * once per Bluetooth connect. Both can be missed, and nothing else ever
   * triggers one. Over USB the interface chip happens to hold the boot-time
   * #HELLO until a host opens the port, which is why the cable looked reliable;
   * over Bluetooth the board announces itself the instant the GATT link is up,
   * well before the browser has subscribed to UART notifications, so the whole
   * handshake lands in the void. The app then sits on "connecting" forever with
   * a stream of data it has no channel definitions to label — which looks, to
   * the user, exactly like a board that sends nothing at all.
   *
   * The first #HELLO? can be lost the same way, so this keeps asking rather
   * than asking once.
   */
  private requestHandshake(transport: Transport): void {
    let attemptsLeft = HANDSHAKE_ATTEMPTS;
    const ask = (): void => {
      this.handshakeTimer = null;
      if (this.transport !== transport) return; // superseded or disconnected
      // 'handshake' means #HELLO arrived but #READY has not — worth one more
      // ask, since a truncated handshake leaves the app just as stuck.
      const status = appState.status;
      if (status !== 'connecting' && status !== 'handshake') return;
      if (attemptsLeft-- <= 0) {
        toast.error(t('error.noHandshake'));
        return;
      }
      this.sendCommand(Commands.rehello());
      this.handshakeTimer = window.setTimeout(ask, HANDSHAKE_RETRY_MS);
    };
    ask();
  }

  /**
   * Notice when the board stops sending, and say so.
   *
   * Nothing used to tell a quiet board from a dead one. A probe that cannot be
   * read, a converter timing out every sample, a firmware loop waiting on a bus
   * that never answers — all three looked exactly like a board with nothing to
   * report, because the last value simply stayed on screen. That is how a whole
   * workshop spent its time guessing at cables.
   */
  private startDataGapWatch(transport: Transport): void {
    this.clearDataGapWatch();
    this.dataGapTimer = window.setInterval(() => {
      if (this.transport !== transport) return;
      if (!this.isConnectedStatus(appState.status)) return;
      // The sonar sends nothing at all while its target is out of range, which
      // is a measurement, not a fault. It is the one sensor this cannot judge.
      if (this.currentSensor === 'HCSR04') return;
      // Nothing has arrived yet at all — that is the handshake's problem to
      // report, not this one's.
      if (this.lastDataMs === 0 || this.dataGapReported) return;
      if (performance.now() - this.lastDataMs < DATA_GAP_MS) return;
      this.dataGapReported = true;
      toast.warn(t('error.dataGap'), 8000);
      announce(t('error.dataGap'));
    }, 1000);
  }

  private clearDataGapWatch(): void {
    if (this.dataGapTimer !== null) {
      window.clearInterval(this.dataGapTimer);
      this.dataGapTimer = null;
    }
    this.lastDataMs = 0;
    this.dataGapReported = false;
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== null) {
      window.clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  /**
   * The rate actually asked of the firmware: the user's fixed choice, or —
   * on "auto", the default — whatever this sensor can usefully deliver.
   */
  private effectiveRate(): SamplingHz {
    const chosen = settings.sampling;
    if (chosen !== 'auto') return chosen;
    return this.currentSensor ? RECOMMENDED_RATE_HZ[this.currentSensor] : 10;
  }

  private sendCommand(cmd: string): void {
    if (!this.transport || !this.transport.isConnected()) return;
    const transport = this.transport;
    transport.send(cmd).catch((err) => {
      if (!transport.isConnected() && this.transport === transport) {
        // The cable was pulled or the board reset. Expected, already told to
        // the user as a toast — logging an error on top is just noise.
        const wasMeasuring = appState.recording;
        appState.stopRecording();
        appState.setStatus('disconnected');
        if (wasMeasuring) toast.error(t('error.connectionLost'));
        return;
      }
      console.error('[App] send failed:', err);
    });
  }

  private isConnectedStatus(s: typeof appState.status): boolean {
    return (
      s === 'connected' ||
      s === 'measuring' ||
      s === 'calibrating' ||
      s === 'handshake'
    );
  }

  private handleLine(line: string): void {
    const msg = parseLine(line);
    switch (msg.type) {
      case 'hello':
        appState.setStatus('handshake');
        this.reportedChannels = [];
        this.deriver = null;
        appState.setChannels([]);
        this.streamStartMs = 0;
        if (msg.sensor && (SENSOR_NAMES as readonly string[]).includes(msg.sensor)) {
          const sensor = msg.sensor as SensorName;
          this.currentSensor = sensor;
          this.sensorSelect.setSensor(sensor);
          this.wiringDiagram.setSensor(sensor);
        }
        break;
      case 'channel':
        // Collected, not published one by one: the derived channels can only
        // be worked out once the firmware has finished announcing its own.
        this.reportedChannels = [...this.reportedChannels, msg.channel];
        break;
      case 'ready':
        this.clearHandshakeTimer();
        this.publishChannels();
        appState.setStatus(this.reportedChannels.length > 0 ? 'measuring' : 'connected');
        this.sendCommand(Commands.rate(this.effectiveRate()));
        // Connected means streaming, for the whole session. A board powered
        // over USB survives a page reload, so it can still be sitting in the
        // stopped state an earlier session left it in — say so rather than
        // waiting for the first START and showing a frozen value until then.
        this.sendCommand(Commands.start());
        break;
      case 'tare':
        if (msg.ok) toast.success(t('toast.tareOk'), 2000);
        else toast.error(t('toast.tareErr'));
        break;
      case 'calibration': {
        const payload: {
          channelId: string;
          ok: boolean;
          factor?: number;
          previousFactor?: number;
        } = {
          channelId: msg.channelId,
          ok: msg.ok,
        };
        if (msg.factor !== undefined) payload.factor = msg.factor;
        if (msg.previousFactor !== undefined) payload.previousFactor = msg.previousFactor;
        this.calibrationListeners.forEach((l) => l(payload));
        break;
      }
      case 'error':
        console.warn('[App] device error:', msg.message);
        toast.error(`${t('toast.deviceError')}: ${msg.message}`);
        break;
      case 'data': {
        this.lastDataMs = performance.now();
        this.dataGapReported = false;
        if (this.streamStartMs === 0) this.streamStartMs = performance.now();
        const tSec = (performance.now() - this.streamStartMs) / 1000;
        const derived = this.deriver?.push(tSec, msg.values);
        appState.pushDataPoint({
          t: tSec,
          values: derived ? { ...msg.values, ...derived } : msg.values,
        });
        break;
      }
      case 'sensor-error': {
        // A board flashed with firmware that forwards the driver's -Infinity
        // instead of reporting #ERR. Say so: silence used to be the only
        // symptom of a probe that never reads.
        const now = performance.now();
        if (now - this.lastSensorErrorMs > SENSOR_ERROR_TOAST_MS) {
          this.lastSensorErrorMs = now;
          toast.error(
            t(
              this.transportKind === 'bluetooth'
                ? 'error.sensorReadFailedBluetooth'
                : 'error.sensorReadFailed',
            ),
          );
        }
        break;
      }
      case 'unknown':
      default:
        // A board that has just been reset spits boot noise and half-lines
        // down the wire before its first #HELLO; the app resynchronises on
        // the next newline by itself. It is useful while working on the
        // firmware and pure confusion in a classroom, so: dev only.
        if (import.meta.env.DEV && msg.type === 'unknown' && msg.raw.trim() !== '') {
          console.warn('[App] unknown protocol line:', msg.raw);
        }
        break;
    }
  }
}
