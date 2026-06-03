/**
 * Global keyboard shortcuts (spec §10.4).
 *
 *   Space → START / STOP
 *   T     → Tára
 *   S     → Uložit run
 *   N     → Nový run
 *   A     → (held) annotation mode (handled separately; this module just exposes isHeld)
 *   E     → Export CSV
 *   P     → Export PDF
 *   Esc   → Reset zoom / close modal (modals already handle Esc natively)
 *   ?     → Help overlay
 *
 * Skips firing when focus is in an editable field, when modifier keys (Ctrl /
 * Meta) are pressed, or when a <dialog> is open.
 */

export type ShortcutHandlers = {
  start: () => void;
  tare: () => void;
  save: () => void;
  newRun: () => void;
  exportCsv: () => void;
  exportPdf: () => void;
  help: () => void;
};

export class KeyboardShortcuts {
  private aHeld = false;

  constructor(private readonly handlers: ShortcutHandlers) {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => (this.aHeld = false));
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
  }

  /** True while the A key is held (used by chart annotation mode). */
  isAnnotationModifierHeld(): boolean {
    return this.aHeld;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.isTypingTarget(e.target)) return;
    if (this.isModalOpen() && e.key !== 'Escape') return;

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        this.handlers.start();
        break;
      case 't':
      case 'T':
        e.preventDefault();
        this.handlers.tare();
        break;
      case 's':
      case 'S':
        e.preventDefault();
        this.handlers.save();
        break;
      case 'n':
      case 'N':
        e.preventDefault();
        this.handlers.newRun();
        break;
      case 'a':
      case 'A':
        this.aHeld = true;
        break;
      case 'e':
      case 'E':
        e.preventDefault();
        this.handlers.exportCsv();
        break;
      case 'p':
      case 'P':
        e.preventDefault();
        this.handlers.exportPdf();
        break;
      case '?':
        e.preventDefault();
        this.handlers.help();
        break;
      default:
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'a' || e.key === 'A') this.aHeld = false;
  };

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  private isModalOpen(): boolean {
    return Array.from(document.querySelectorAll('dialog')).some(
      (d) => (d as HTMLDialogElement).open,
    );
  }
}
