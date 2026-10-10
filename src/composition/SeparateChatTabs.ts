import type { TFile, Workspace } from 'obsidian';

import type { ChatFileOpenMode } from '@/core/types';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import type { ChatViewPlacement } from '@/core/types/settings';
import type { ClaudianView } from '@/features/chat/ClaudianView';
import { revealWorkspaceLeaf } from '@/utils/obsidianCompat';

import { isClaudianView } from './ClaudianViews';

export interface SeparateChatTabsDeps {
  readonly workspace: Pick<Workspace, 'getActiveFile' | 'getLeaf' | 'revealLeaf'>;
  getMode(): ChatFileOpenMode;
  getPlacement(): ChatViewPlacement;
  getViews(): readonly ClaudianView[];
}

/** Gives each chat its own workspace tab when chat files open in separate tabs. */
export class SeparateChatTabs {
  constructor(private readonly deps: SeparateChatTabsDeps) {}

  /** Opens a new chat in an active tab of its own; false when chats do not use separate tabs. */
  async openNewChat(): Promise<boolean> {
    if (this.deps.getMode() !== 'separate-tab') return false;
    const { workspace } = this.deps;
    // Opening a tab changes what the workspace reports as active, so read the note first.
    const openNote = workspace.getActiveFile();
    const leaf = workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_CLAUDIAN, active: true });
    await revealWorkspaceLeaf(workspace as Workspace, leaf);
    if (isClaudianView(leaf.view)) this.#present(leaf.view, openNote);
    return true;
  }

  /**
   * "Open Claudian" with chats in main-area tabs: a tab with no chat yet, reusing an empty one
   * instead of activating whichever chat tab comes first. False when the chat view has a
   * single home (sidebar, or one view holding every chat) and plain activation applies.
   */
  async openHome(): Promise<boolean> {
    if (this.deps.getMode() !== 'separate-tab' || this.deps.getPlacement() !== 'main-tab') return false;
    const blank = this.deps.getViews().find(view => (
      view.getTabManager() !== null && view.getActiveTab()?.conversationId == null
    ));
    if (!blank) return this.openNewChat();
    const openNote = this.deps.workspace.getActiveFile();
    await revealWorkspaceLeaf(this.deps.workspace as Workspace, blank.leaf);
    this.#present(blank, openNote);
    return true;
  }

  /** A chat with no messages follows the note that is open, as a new chat always has. */
  #present(view: ClaudianView, openNote: TFile | null): void {
    if (openNote) view.getActiveTab()?.linkedContent.handleActiveFileChanged(openNote, true);
    view.focusActiveInput();
  }
}
