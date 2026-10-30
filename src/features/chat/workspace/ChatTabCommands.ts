import type { Command, Workspace } from 'obsidian';

import type { ChatViewHost } from '@/features/chat/ChatFeatureHost';

export interface ChatTabCommandsDeps {
  readonly workspace: Pick<Workspace, 'getLeavesOfType'>;
  readonly views: {
    getView(): ChatViewHost | null;
  };
  /** Opens a fresh chat in a new leaf where the default placement says. */
  openNewTab(): Promise<void>;
}

/** Palette commands that act on the focused chat view's tabs. */
export function createChatTabCommands(deps: ChatTabCommandsDeps): Command[] {
  const { views } = deps;

  /** The focused view's tab manager, unless dual-pane navigation owns the tab commands. */
  const getCompactTabManager = () => {
    const view = views.getView();
    if (!view || view.isDualPaneMode()) return null;
    return view.getTabManager();
  };

  return [
    {
      id: 'new-tab',
      // A new chat of its own, not one more tab inside whichever chat was used last.
      name: 'New Claudian tab',
      callback: () => {
        void deps.openNewTab();
      },
    },
    {
      id: 'new-session',
      name: 'Replace current conversation',
      checkCallback: (checking: boolean) => {
        const tabManager = getCompactTabManager();
        const activeTab = tabManager?.getActiveTab();
        if (!tabManager || !activeTab || activeTab.state.isStreaming) return false;
        if (!checking) void tabManager.createNewConversation();
        return true;
      },
    },
    {
      id: 'close-current-tab',
      name: 'Close current tab',
      checkCallback: (checking: boolean) => {
        const tabManager = getCompactTabManager();
        if (!tabManager) return false;
        if (!checking) {
          const activeTabId = tabManager.getActiveTabId();
          if (activeTabId) void tabManager.closeTab(activeTabId);
        }
        return true;
      },
    },
  ];
}
