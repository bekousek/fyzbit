/** Query a required element; throws with the selector if missing (fail fast on markup drift). */
export function required<T extends HTMLElement = HTMLElement>(
  selector: string,
  scope: ParentNode = document,
): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  return el;
}

/** Escape text for safe interpolation into innerHTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
