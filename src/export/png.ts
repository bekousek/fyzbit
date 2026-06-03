import { timestampedFilename, triggerDownload } from './csv';

/**
 * Capture the uPlot canvas as a PNG and trigger a download.
 *
 * Strategy: clone the visible canvas to a larger one (2× pixel ratio) to keep
 * lines crisp on retina/projector. We re-draw via drawImage rather than
 * regenerating the chart — that's simpler and the output looks fine for screen
 * captures embedded in protocols.
 */
export function exportChartPng(canvas: HTMLCanvasElement | null): void {
  if (!canvas) {
    console.warn('[png] No chart canvas to capture.');
    return;
  }
  const scale = 2;
  const w = canvas.width;
  const h = canvas.height;
  const off = document.createElement('canvas');
  off.width = w * scale;
  off.height = h * scale;
  const ctx = off.getContext('2d');
  if (!ctx) return;
  // White background to match printable PDF behavior.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, off.width, off.height);
  off.toBlob((blob) => {
    if (!blob) return;
    triggerDownload(blob, timestampedFilename('FyzBit_graf', 'png'));
  }, 'image/png');
}

/**
 * Capture chart as a base64 data URL — used by the PDF exporter when embedding
 * the chart image into a jsPDF document. Returns "" if no canvas.
 */
export function chartToDataUrl(canvas: HTMLCanvasElement | null): string {
  if (!canvas) return '';
  const scale = 2;
  const off = document.createElement('canvas');
  off.width = canvas.width * scale;
  off.height = canvas.height * scale;
  const ctx = off.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, off.width, off.height);
  return off.toDataURL('image/png');
}

/** Find the main uPlot drawing canvas inside the chart container. */
export function findChartCanvas(container: HTMLElement | null): HTMLCanvasElement | null {
  if (!container) return null;
  return container.querySelector<HTMLCanvasElement>('.uplot canvas');
}
