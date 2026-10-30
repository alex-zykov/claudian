import type { Workspace, WorkspaceLeaf } from 'obsidian';
import { ItemView } from 'obsidian';

import {
  decodeTabWorkspaceViewState,
  TAB_WORKSPACE_VIEW_STATE_KEY,
} from '@/core/bootstrap/tabManagerState';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import type { ChatViewPlacement } from '@/core/types/settings';
import type { ClaudianView } from '@/features/chat/ClaudianView';
import { revealWorkspaceLeaf } from '@/utils/obsidianCompat';

/** Identifies a mounted chat view without relying on class identity across reloads. */
export function isClaudianView(value: unknown): value is ClaudianView {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getTabManager?: unknown }).getTabManager === 'function';
}

/** Locates and opens the chat views mounted in the Obsidian workspace. */
export class ClaudianViews {
  constructor(
    private readonly workspace: Workspace,
    private readonly getPlacement: () => ChatViewPlacement,
  ) {}

  /** The focused chat view, else the first mounted one. */
  getView(): ClaudianView | null {
    const leaves = this.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
    const activeView = this.workspace.getActiveViewOfType(ItemView);
    if (isClaudianView(activeView) && leaves.some(leaf => leaf.view === activeView)) {
      return activeView;
    }
    return leaves.map(leaf => leaf.view).find(isClaudianView) ?? null;
  }

  getAllViews(): ClaudianView[] {
    const leaves = this.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
    return leaves.map(leaf => leaf.view).filter(isClaudianView);
  }

  /** Chooses a visible composer without opening or revealing a chat. */
  getInputFocusView(zenLeaf: WorkspaceLeaf | null): ClaudianView | null {
    const views = this.getAllViews().filter(view => view.getActiveTab()?.composer.isVisible());
    const preferred = this.getView();
    return views.find(view => view.getActiveTab()?.composer.isFocused())
      ?? views.find(view => view.leaf === zenLeaf)
      ?? views.find(view => view === preferred)
      ?? views[0]
      ?? null;
  }

  findConversationAcrossViews(conversationId: string): { view: ClaudianView; tabId: string } | null {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      const tabs = tabManager.getTabIdentities();
      for (const tab of tabs) {
        if (tab.conversationId === conversationId) {
          return { view, tabId: tab.id };
        }
      }
    }
    return null;
  }

  /** Sessions held by any chat pane's tabs, including unloaded panes and pending restoration. */
  getWorkspaceConversationIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const leaf of this.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN)) {
      const liveTabs = isClaudianView(leaf.view) ? leaf.view.getTabManager()?.getTabIdentities() ?? [] : [];
      // Deferred leaves keep their saved state; mounted views report pending restoration through getState().
      const savedTabs = decodeTabWorkspaceViewState(
        leaf.getViewState().state?.[TAB_WORKSPACE_VIEW_STATE_KEY],
      )?.openTabs ?? [];
      for (const { conversationId } of [...liveTabs, ...savedTabs]) {
        if (conversationId) ids.add(conversationId);
      }
    }
    return ids;
  }

  async activateView(): Promise<void> {
    const { workspace } = this;
    const existingLeaf = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN)[0];
    const leaf = existingLeaf
      ?? this.#getLeafForPlacement(this.getPlacement());
    if (!leaf) return;

    let focusSuperseded = false;
    const focusIntentRef = workspace.on('active-leaf-change', (activeLeaf) => {
      if (activeLeaf && activeLeaf !== leaf) {
        focusSuperseded = true;
      }
    });

    try {
      if (!existingLeaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_CLAUDIAN,
          active: true,
        });
      }

      await revealWorkspaceLeaf(workspace, leaf);
      if (!focusSuperseded && isClaudianView(leaf.view)) {
        leaf.view.focusActiveInput();
      }
    } finally {
      workspace.offref(focusIntentRef);
    }
  }


  /**
   * Opens a conversation in a new leaf where the default placement says. The new view starts
   * with one blank tab, which the conversation takes over. Throws when the view is not ready.
   */
  async openConversationInNewTab(conversationId: string): Promise<void> {
    const leaf = this.#getLeafForPlacement(this.getPlacement());
    if (!leaf) throw new Error('No leaf to open the chat in');
    await leaf.setViewState({ type: VIEW_TYPE_CLAUDIAN, active: true });
    await revealWorkspaceLeaf(this.workspace, leaf);
    const manager = isClaudianView(leaf.view) ? leaf.view.getTabManager() : null;
    if (!manager) throw new Error('Chat view is not ready');
    await manager.openConversation(conversationId);
  }

  /**
   * Focuses a conversation that is already open, in whichever tab of whichever chat view holds it.
   * A deferred leaf that keeps it in its saved tabs is shown, which loads it. False when none does.
   */
  async focusConversation(conversationId: string): Promise<boolean> {
    let open = this.findConversationAcrossViews(conversationId);
    if (!open) {
      const deferred = this.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN).find(leaf => (
        leaf.isDeferred
        && (decodeTabWorkspaceViewState(leaf.getViewState().state?.[TAB_WORKSPACE_VIEW_STATE_KEY])?.openTabs ?? [])
          .some(tab => tab.conversationId === conversationId)
      ));
      if (!deferred) return false;
      await revealWorkspaceLeaf(this.workspace, deferred);
      open = this.findConversationAcrossViews(conversationId);
      // Restoration may still be admitting its tabs; the revealed leaf will show it.
      if (!open) return true;
    }
    await open.view.focusConversationTab(open.tabId);
    return true;
  }

  #getLeafForPlacement(placement: ChatViewPlacement): WorkspaceLeaf | null {
    const { workspace } = this;
    switch (placement) {
      case 'main-tab':
        return workspace.getLeaf('tab');
      case 'left-sidebar':
        return workspace.getLeftLeaf(false);
      case 'right-sidebar':
        return workspace.getRightLeaf(false);
    }
  }
}
