import { onLanguageChange, t } from '../i18n/i18n';

export type ExpandablePanel = 'wiring' | 'chart' | 'runs';

const PANELS: readonly ExpandablePanel[] = ['wiring', 'chart', 'runs'];

/**
 * "Give me the whole window for this one" buttons on the three columns.
 *
 * Wiring a sensor and reading a graph want opposite things from the screen,
 * and on a laptop the three fixed columns serve neither well: the schematic is
 * squeezed into 260 px exactly when you are peering at which hole a wire goes
 * into. One click hands a panel the full width and the others step aside;
 * clicking again puts them back.
 *
 * Like MobileNav this only sets an attribute on #app — the layout itself is
 * CSS, and on narrow screens (where each panel is already a full-width tab)
 * the buttons are hidden and the attribute does nothing.
 *
 * Deliberately not persisted: it is a posture for the next few minutes, not a
 * preference, and a layout that silently came back "broken" after a reload
 * would be worse than one that always starts whole.
 */
export class PanelExpand {
  private root: HTMLElement;
  private buttons: HTMLButtonElement[];

  constructor(
    root: HTMLElement,
    private readonly onChange?: (expanded: ExpandablePanel | null) => void,
  ) {
    this.root = root;
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>('.panel__expand')];
    for (const btn of this.buttons) {
      btn.addEventListener('click', () => {
        const panel = btn.dataset.expand;
        if (!isExpandable(panel)) return;
        this.toggle(panel);
      });
    }
    onLanguageChange(() => this.sync());
    this.sync();
  }

  get expanded(): ExpandablePanel | null {
    const current = this.root.dataset.expanded;
    return isExpandable(current) ? current : null;
  }

  toggle(panel: ExpandablePanel): void {
    this.set(this.expanded === panel ? null : panel);
  }

  set(panel: ExpandablePanel | null): void {
    const next = panel ?? 'none';
    if (this.root.dataset.expanded === next) return;
    this.root.dataset.expanded = next;
    this.sync();
    this.onChange?.(panel);
  }

  /** Used when something else takes over the layout (e.g. a mobile tab switch). */
  reset(): void {
    this.set(null);
  }

  private sync(): void {
    const current = this.expanded;
    for (const btn of this.buttons) {
      const isCurrent = btn.dataset.expand === current;
      btn.setAttribute('aria-pressed', String(isCurrent));
      const label = t(isCurrent ? 'panel.collapse' : 'panel.expand');
      btn.title = label;
      btn.setAttribute('aria-label', label);
      // The global re-scan would otherwise put the "expand" wording back on a
      // button that currently collapses.
      btn.removeAttribute('data-i18n-title');
      btn.removeAttribute('data-i18n-aria-label');
    }
  }
}

function isExpandable(value: string | undefined): value is ExpandablePanel {
  return PANELS.includes(value as ExpandablePanel);
}
