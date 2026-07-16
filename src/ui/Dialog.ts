import { t } from '../i18n/i18n';

/**
 * Shared alert/confirm/prompt replacement built on a single reused <dialog>.
 * Unlike window.alert/confirm/prompt these don't block the JS event loop and
 * match the app's own modal styling; the native <dialog> still gives us a
 * free focus trap and Escape-to-cancel.
 */

let dialogEl: HTMLDialogElement | null = null;
let messageEl: HTMLParagraphElement;
let fieldEl: HTMLLabelElement;
let inputEl: HTMLInputElement;
let cancelBtn: HTMLButtonElement;
let okBtn: HTMLButtonElement;

function build(): void {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal confirm-dialog';
  dlg.innerHTML = `
    <div class="modal__form">
      <div class="modal__body">
        <p class="confirm-dialog__message"></p>
        <label class="field confirm-dialog__field" hidden>
          <input type="text" class="field__input" />
        </label>
      </div>
      <footer class="modal__footer">
        <button type="button" class="btn confirm-dialog__cancel"></button>
        <button type="button" class="btn btn--primary confirm-dialog__ok"></button>
      </footer>
    </div>
  `;
  document.body.appendChild(dlg);
  dialogEl = dlg;
  messageEl = dlg.querySelector('.confirm-dialog__message')!;
  fieldEl = dlg.querySelector('.confirm-dialog__field')!;
  inputEl = dlg.querySelector('input')!;
  cancelBtn = dlg.querySelector('.confirm-dialog__cancel')!;
  okBtn = dlg.querySelector('.confirm-dialog__ok')!;
}

type OpenOptions = {
  message: string;
  showCancel: boolean;
  showInput: boolean;
  defaultValue?: string;
  okLabel: string;
  cancelLabel?: string;
  danger?: boolean;
};

function open(opts: OpenOptions): Promise<{ confirmed: boolean; value: string }> {
  if (!dialogEl) build();
  const dlg = dialogEl!;

  messageEl.textContent = opts.message;
  fieldEl.hidden = !opts.showInput;
  inputEl.value = opts.defaultValue ?? '';
  cancelBtn.hidden = !opts.showCancel;
  cancelBtn.textContent = opts.cancelLabel ?? t('button.cancel');
  okBtn.textContent = opts.okLabel;
  okBtn.classList.toggle('btn--danger', !!opts.danger);
  okBtn.classList.toggle('btn--primary', !opts.danger);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      inputEl.removeEventListener('keydown', onInputKeydown);
      if (dlg.open) dlg.close();
      resolve({ confirmed, value: inputEl.value });
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onClose = () => finish(false);
    const onInputKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    inputEl.addEventListener('keydown', onInputKeydown);

    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    if (opts.showInput) {
      inputEl.focus();
      inputEl.select();
    } else {
      okBtn.focus();
    }
  });
}

export async function showAlert(message: string): Promise<void> {
  await open({ message, showCancel: false, showInput: false, okLabel: t('button.ok') });
}

export async function showConfirm(
  message: string,
  opts: { okLabel?: string; cancelLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  const { confirmed } = await open({
    message,
    showCancel: true,
    showInput: false,
    okLabel: opts.okLabel ?? t('button.ok'),
    cancelLabel: opts.cancelLabel,
    danger: opts.danger,
  });
  return confirmed;
}

export async function showPrompt(message: string, defaultValue = ''): Promise<string | null> {
  const { confirmed, value } = await open({
    message,
    showCancel: true,
    showInput: true,
    defaultValue,
    okLabel: t('button.ok'),
  });
  return confirmed ? value : null;
}
