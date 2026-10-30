import type { Workspace, WorkspaceLeaf } from 'obsidian';

import { ClaudianViews } from '@/composition/ClaudianViews';
import { TAB_WORKSPACE_VIEW_STATE_KEY } from '@/core/bootstrap/tabManagerState';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import type { ChatViewPlacement } from '@/core/types/settings';

const ID = 'conv-aaaaaaaa-bbbb';

function chatView(overrides: Record<string, unknown> = {}) {
  return {
    getTabManager: () => ({ getTabIdentities: () => [{ id: 'tab-2', conversationId: ID }] }),
    focusConversationTab: jest.fn(async () => undefined),
    focusActiveInput: jest.fn(),
    ...overrides,
  };
}

function setup(placement: ChatViewPlacement = 'right-sidebar') {
  const openConversation = jest.fn(async () => undefined);
  const created = {
    view: chatView({ getTabManager: () => ({ openConversation, getTabIdentities: () => [] }) }),
    setViewState: jest.fn(async () => undefined),
  } as unknown as WorkspaceLeaf;
  const leaves: unknown[] = [];
  const workspace = {
    getLeaf: jest.fn(() => created),
    getLeftLeaf: jest.fn(() => created),
    getRightLeaf: jest.fn(() => created),
    getLeavesOfType: jest.fn((type: string) => (type === VIEW_TYPE_CLAUDIAN ? leaves : [])),
    getActiveViewOfType: jest.fn(() => null),
    revealLeaf: jest.fn(async () => undefined),
  } as unknown as Workspace;
  return { views: new ClaudianViews(workspace, () => placement), workspace, created, leaves, openConversation };
}

describe('ClaudianViews.openConversationInNewTab', () => {
  it.each([
    ['main-tab', 'getLeaf', 'tab'],
    ['right-sidebar', 'getRightLeaf', false],
    ['left-sidebar', 'getLeftLeaf', false],
  ] as const)('opens the conversation in a fresh leaf for the %s default', async (placement, getter, argument) => {
    const { views, workspace, created, openConversation } = setup(placement);

    await views.openConversationInNewTab(ID);

    expect(workspace[getter]).toHaveBeenCalledWith(argument);
    expect(created.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CLAUDIAN, active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(created);
    expect(openConversation).toHaveBeenCalledWith(ID);
  });

  it('fails, so the file stays reachable, when the new view is not ready', async () => {
    const { views, created } = setup();
    (created as unknown as { view: unknown }).view = chatView({ getTabManager: () => null });

    await expect(views.openConversationInNewTab(ID)).rejects.toThrow('Chat view is not ready');
  });
});

describe('ClaudianViews.focusConversation', () => {
  it('focuses the tab that holds the conversation, whichever tab of the view it is', async () => {
    const { views, leaves } = setup();
    const view = chatView();
    leaves.push({ view });

    await expect(views.focusConversation(ID)).resolves.toBe(true);

    expect(view.focusConversationTab).toHaveBeenCalledWith('tab-2');
  });

  it('says false when no view holds it', async () => {
    const { views, leaves } = setup();
    leaves.push({ view: chatView({ getTabManager: () => ({ getTabIdentities: () => [] }) }) });

    await expect(views.focusConversation(ID)).resolves.toBe(false);
  });

  it('shows a deferred leaf that keeps the conversation in its saved tabs, so it loads', async () => {
    const { views, workspace, leaves } = setup();
    const deferred = {
      isDeferred: true,
      view: {},
      getViewState: () => ({
        state: {
          [TAB_WORKSPACE_VIEW_STATE_KEY]: {
            version: 1,
            openTabs: [{ tabId: 'tab-1', conversationId: ID }],
            activeTabId: 'tab-1',
          },
        },
      }),
    };
    leaves.push(deferred);

    await expect(views.focusConversation(ID)).resolves.toBe(true);

    expect(workspace.revealLeaf).toHaveBeenCalledWith(deferred);
  });
});
