/**
 * Non-color identity for chart series (WCAG 1.4.1 "Use of Color").
 *
 * The chart tells two things apart at once — which quantity a line shows and
 * which run it belongs to — and color alone cannot carry either of them for a
 * reader who cannot distinguish the hues. So each dimension gets a second,
 * redundant encoding:
 *
 *   quantity (channel index) → dash pattern
 *   run (run index)          → marker shape, drawn along the line
 *
 * The same two functions feed the legends, so the key a reader sees in the
 * channel chips and the runs list matches what is drawn on the canvas.
 */

/** Dash patterns in canvas `setLineDash` form. Index 0 is a solid line. */
const DASHES: ReadonlyArray<readonly number[]> = [
  [],
  [9, 5],
  [2, 4],
  [13, 4, 2, 4],
  [7, 3, 2, 3, 2, 3],
];

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross';

const SHAPES: readonly MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross'];

/** Dash pattern for the n-th measured quantity. Empty array = solid. */
export function dashForChannel(index: number): readonly number[] {
  const n = ((index % DASHES.length) + DASHES.length) % DASHES.length;
  return DASHES[n]!;
}

/** Marker shape for the n-th run on screen. */
export function shapeForRun(index: number): MarkerShape {
  const n = ((index % SHAPES.length) + SHAPES.length) % SHAPES.length;
  return SHAPES[n]!;
}

/**
 * Paint one marker centred on (x, y). `halo` is painted underneath in the
 * chart background color so a marker sitting on top of another line is still
 * readable as a shape rather than a smudge.
 */
export function drawMarker(
  ctx: CanvasRenderingContext2D,
  shape: MarkerShape,
  x: number,
  y: number,
  size: number,
  color: string,
  halo: string,
): void {
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(x - r, y - r, size, size);
      break;
    case 'triangle':
      ctx.moveTo(x, y - r * 1.15);
      ctx.lineTo(x + r, y + r * 0.75);
      ctx.lineTo(x - r, y + r * 0.75);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(x, y - r * 1.2);
      ctx.lineTo(x + r * 1.2, y);
      ctx.lineTo(x, y + r * 1.2);
      ctx.lineTo(x - r * 1.2, y);
      ctx.closePath();
      break;
    case 'cross':
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      break;
  }
  if (shape === 'cross') {
    ctx.lineCap = 'round';
    ctx.strokeStyle = halo;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.fillStyle = halo;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The same marker as an inline SVG, for the legends in the runs list. Sized to
 * a 14×14 box so it drops into the place the old color dot occupied.
 */
export function markerSvg(shape: MarkerShape, color: string): string {
  const common = `fill="none" stroke="${color}" stroke-width="2"`;
  const body = {
    circle: `<circle cx="7" cy="7" r="4.5" ${common} />`,
    square: `<rect x="2.5" y="2.5" width="9" height="9" ${common} />`,
    triangle: `<path d="M7 2 L12 11.5 L2 11.5 Z" ${common} stroke-linejoin="round" />`,
    diamond: `<path d="M7 1.5 L12.5 7 L7 12.5 L1.5 7 Z" ${common} stroke-linejoin="round" />`,
    cross: `<path d="M3 3 L11 11 M11 3 L3 11" ${common} stroke-linecap="round" />`,
  }[shape];
  return `<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false">${body}</svg>`;
}

/**
 * A short dashed line as inline SVG, for the channel chips. Same dash array
 * the canvas uses, scaled to a 28×10 box.
 */
export function dashSvg(index: number, color: string): string {
  const dash = dashForChannel(index);
  const attr = dash.length > 0 ? ` stroke-dasharray="${dash.join(' ')}"` : '';
  return (
    `<svg viewBox="0 0 28 10" width="28" height="10" aria-hidden="true" focusable="false">` +
    `<path d="M1 5 H27" fill="none" stroke="${color}" stroke-width="2.5"${attr} /></svg>`
  );
}
