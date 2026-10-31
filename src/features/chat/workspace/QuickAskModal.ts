import { type App, Modal, Notice } from 'obsidian';

import { t } from '@/i18n/i18n';

/** True when the text was admitted or queued. False leaves the question in the field. */
export type QuickAskSubmit = (text: string) => Promise<boolean>;

/** A single question. Enter sends it; Escape closes; an empty question stays put. */
export class QuickAskModal extends Modal {
  readonly #onSubmit: QuickAskSubmit;
  #inputEl: HTMLInputElement | null = null;
  #closed = false;
  #submitting = false;

  constructor(app: App, onSubmit: QuickAskSubmit) {
    super(app);
    this.#onSubmit = onSubmit;
  }

  onOpen(): void {
    this.setTitle(t('chat.quickAsk.title'));
    this.modalEl.addClass('claudian-quick-ask-modal');

    const inputId = 'claudian-quick-ask-input';
    this.contentEl.createEl('label', {
      text: t('chat.quickAsk.label'),
      attr: { for: inputId },
    });
    const input = this.contentEl.createEl('input', {
      cls: 'prompt-input',
      attr: {
        id: inputId,
        type: 'text',
        placeholder: t('chat.quickAsk.placeholder'),
      },
    });
    this.#inputEl = input;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      void this.#submit();
    });
    input.focus();
  }

  onClose(): void {
    this.#closed = true;
    this.#inputEl = null;
    this.contentEl.empty();
  }

  async #submit(): Promise<void> {
    if (this.#submitting || this.#closed) return;
    const input = this.#inputEl;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    this.#submitting = true;
    let accepted: boolean;
    try {
      accepted = await this.#onSubmit(text);
    } catch {
      accepted = false;
    } finally {
      this.#submitting = false;
    }
    if (this.#closed) return;
    if (!accepted) {
      new Notice(t('chat.quickAsk.notSent'));
      this.#inputEl?.focus();
      return;
    }
    this.close();
  }
}
