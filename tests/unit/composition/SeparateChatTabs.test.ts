import type { Workspace, WorkspaceLeaf } from 'obsidian';

import { SeparateChatTabs } from '@/composition/SeparateChatTabs';
import type { ChatFileOpenMode } from '@/core/types';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import type { ChatViewPlacement } from '@/core/types/settings';

interface FakeView {
  leaf: WorkspaceLeaf;
  getTabManager(): object;
  getActiveTab(): { conversationId: string | null; linkedContent: { handleActiveFileChanged: jest.Mock } } | null;
  focusActiveInput: jest.Mock;
  handleActiveFileChanged: jest.Mock;
}

function createView(conversationId: string | null): FakeView {
  const handleActiveFileChanged = jest.fn();
  return {
    leaf: {} as WorkspaceLeaf,
    getTabManager: () => ({}),
    getActiveTab: () => ({ conversationId, linkedContent: { handleActiveFileChanged } }),
    focusActiveInput: jest.fn(),
    handleActiveFileChanged,
  };
}

function setup(
  mode: ChatFileOpenMode,
  options: { placement?: ChatViewPlacement; views?: FakeView[]; activeFile?: unknown } = {},
) {
  const focusActiveInput = jest.fn();
  const newView = createView(null);
  newView.focusActiveInput = focusActiveInput;
  const leaf = {
    view: { ...newView, getTabManager: () => ({}) },
    setViewState: jest.fn(async () => undefined),
  } as unknown as WorkspaceLeaf;
  // Opening a leaf may change what the workspace reports as active, so the file is read first.
  let activeFile: unknown = options.activeFile ?? null;
  const workspace = {
    getActiveFile: jest.fn(() => activeFile),
    getLeaf: jest.fn(() => {
      activeFile = null;
      return leaf;
    }),
    revealLeaf: jest.fn(async () => undefined),
  } as unknown as Workspace;
  return {
    focusActiveInput,
    newView,
    leaf,
    tabs: new SeparateChatTabs({
      workspace,
      getMode: () => mode,
      getPlacement: () => options.placement ?? 'main-tab',
      getViews: () => (options.views ?? []) as never,
    }),
    workspace,
  };
}

describe('SeparateChatTabs', () => {
  describe('openNewChat', () => {
    it('opens a new chat in its own active tab when chats open in separate tabs', async () => {
      const { tabs, workspace, leaf, focusActiveInput } = setup('separate-tab');

      await expect(tabs.openNewChat()).resolves.toBe(true);

      expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
      expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CLAUDIAN, active: true });
      expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
      expect(focusActiveInput).toHaveBeenCalledTimes(1);
    });

    it.each(['in-claudian', 'note'] as const)('leaves new chats to the chat view in %s mode', async (mode) => {
      const { tabs, workspace, leaf } = setup(mode);

      await expect(tabs.openNewChat()).resolves.toBe(false);

      expect(workspace.getLeaf).not.toHaveBeenCalled();
      expect(leaf.setViewState).not.toHaveBeenCalled();
    });
  });

  describe('openHome', () => {
    it('opens a fresh chat tab instead of activating an existing chat', async () => {
      const bound = createView('c1');
      const { tabs, workspace, leaf } = setup('separate-tab', { views: [bound] });

      await expect(tabs.openHome()).resolves.toBe(true);

      expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
      expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CLAUDIAN, active: true });
      expect(workspace.revealLeaf).not.toHaveBeenCalledWith(bound.leaf);
    });

    it('reuses an existing empty chat tab rather than piling up blank ones', async () => {
      const bound = createView('c1');
      const blank = createView(null);
      const { tabs, workspace } = setup('separate-tab', { views: [bound, blank] });

      await expect(tabs.openHome()).resolves.toBe(true);

      expect(workspace.getLeaf).not.toHaveBeenCalled();
      expect(workspace.revealLeaf).toHaveBeenCalledWith(blank.leaf);
      expect(blank.focusActiveInput).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['in-claudian', 'main-tab'],
      ['note', 'main-tab'],
      ['separate-tab', 'right-sidebar'],
      ['separate-tab', 'left-sidebar'],
    ] as const)('leaves the chat view alone in %s mode with %s placement', async (mode, placement) => {
      const { tabs, workspace } = setup(mode, { placement, views: [createView('c1')] });

      await expect(tabs.openHome()).resolves.toBe(false);

      expect(workspace.getLeaf).not.toHaveBeenCalled();
      expect(workspace.revealLeaf).not.toHaveBeenCalled();
    });
  });
  describe('linking the note that was open', () => {
    const note = { path: 'Projects/A/x.md', extension: 'md' };

    it('gives a new chat tab the note that was active before the tab opened', async () => {
      const { tabs, leaf } = setup('separate-tab', { activeFile: note });

      await tabs.openNewChat();

      const opened = leaf.view as unknown as FakeView;
      expect(opened.getActiveTab()).not.toBeNull();
      expect(opened.handleActiveFileChanged).toHaveBeenCalledWith(note, true);
    });

    it('does not link anything when no note was open', async () => {
      const { tabs, leaf } = setup('separate-tab');

      await tabs.openNewChat();

      expect((leaf.view as unknown as FakeView).handleActiveFileChanged).not.toHaveBeenCalled();
    });

    it('relinks a reused empty chat tab to the note that is open now', async () => {
      const blank = createView(null);
      const { tabs } = setup('separate-tab', { views: [blank], activeFile: note });

      await tabs.openHome();

      expect(blank.handleActiveFileChanged).toHaveBeenCalledWith(note, true);
    });
  });
});
