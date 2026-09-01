import { required } from '../utils/dom';

export type MobileView = 'wiring' | 'chart' | 'runs';

const VIEWS: readonly MobileView[] = ['wiring', 'chart', 'runs'];

/**
 * Bottom tab bar for phones and tablets.
 *
 * On a narrow screen the three desktop columns can't sit side by side, and
 * stacking them turns the page into a long scroll with the chart squeezed in
 * the middle. Instead one column is shown at a time and this switches between
 * them by setting `data-view` on #app — all the actual showing/hiding is CSS,
 * so on desktop (where the bar is hidden) the attribute simply has no effect.
 */
export class MobileNav {
  private root: HTMLElement;
  private nav: HTMLElement;
  private buttons: HTMLButtonElement[];

  constructor(
    root: HTMLElement,
    private readonly onViewChange?: (view: MobileView) => void,
  ) {
    this.root = root;
    this.nav = required('#mobile-nav', root);
    this.buttons = [...this.nav.querySelectorAll<HTMLButtonElement>('.mobile-nav__btn')];
    for (const btn of this.buttons) {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (isMobileView(view)) this.show(view);
      });
    }
    this.syncPressed();
  }

  get view(): MobileView {
    const current = this.root.dataset.view;
    return isMobileView(current) ? current : 'chart';
  }

  show(view: MobileView): void {
    if (this.root.dataset.view === view) return;
    this.root.dataset.view = view;
    this.syncPressed();
    this.onViewChange?.(view);
  }

  private syncPressed(): void {
    const current = this.view;
    for (const btn of this.buttons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === current));
    }
  }
}

function isMobileView(value: string | undefined): value is MobileView {
  return VIEWS.includes(value as MobileView);
}
