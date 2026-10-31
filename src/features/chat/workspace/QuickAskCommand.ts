import type { App, Command } from 'obsidian';

import { QuickAskModal } from '@/features/chat/workspace/QuickAskModal';

export interface QuickAskCommandDeps {
  readonly app: App;
  activateView(): Promise<void>;
  getView(): { submitToActiveInput(text: string): Promise<boolean> } | null;
}

/** Opens a question box and sends the answer in the active chat tab. */
export function createQuickAskCommand(deps: QuickAskCommandDeps): Command {
  return {
    id: 'quick-ask',
    name: 'Quick ask',
    callback: () => {
      new QuickAskModal(deps.app, async (text) => {
        await deps.activateView();
        return await deps.getView()?.submitToActiveInput(text) ?? false;
      }).open();
    },
  };
}
