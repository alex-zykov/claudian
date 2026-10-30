import type { Workspace, WorkspaceLeaf } from 'obsidian';

import { ClaudianViews } from '@/composition/ClaudianViews';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import type { ClaudianView } from '@/features/chat/ClaudianView';

function setup(options: { streaming?: boolean; left?: boolean; right?: boolean } = {}) {
  const calls: string[] = [];
  const state = { tabWorkspace: { openTabs: ['c1', 'c2'] } };
  const oldLeaf = {
    getViewState: () => ({ type: VIEW_TYPE_CLAUDIAN, state }),
    detach: jest.fn(() => { calls.push('detach'); }),
  } as unknown as WorkspaceLeaf;
  const newLeaf = {
    setViewState: jest.fn(async () => { calls.push('setViewState'); }),
  } as unknown as WorkspaceLeaf;
  const workspace = {
    getLeftLeaf: jest.fn(() => (options.left === false ? null : newLeaf)),
    getRightLeaf: jest.fn(() => (options.right === false ? null : newLeaf)),
    revealLeaf: jest.fn(async () => { calls.push('reveal'); }),
    getLeavesOfType: jest.fn(() => []),
  } as unknown as Workspace;
  const view = {
    leaf: oldLeaf,
    getTabManager: () => ({
      getAllTabs: () => [{ state: { isStreaming: options.streaming === true } }],
    }),
  } as unknown as ClaudianView;
  const views = new ClaudianViews(workspace, () => 'right-sidebar');
  return { views, view, workspace, oldLeaf, newLeaf, state, calls };
}

describe('ClaudianViews.moveViewToSide', () => {
  it.each([
    ['left', 'getLeftLeaf'],
    ['right', 'getRightLeaf'],
  ] as const)('reopens the chat tabs in the %s sidebar and closes the old tab', async (side, getter) => {
    const { views, view, workspace, newLeaf, state, calls } = setup();

    await expect(views.moveViewToSide(view, side)).resolves.toBe(true);

    expect(workspace[getter]).toHaveBeenCalledWith(false);
    expect(newLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_CLAUDIAN,
      state,
      active: true,
    });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
    expect(calls).toEqual(['detach', 'setViewState', 'reveal']);
  });

  it('keeps the chat where it is while an answer is streaming', async () => {
    const { views, view, oldLeaf, newLeaf } = setup({ streaming: true });

    await expect(views.moveViewToSide(view, 'left')).resolves.toBe(false);

    expect(oldLeaf.detach).not.toHaveBeenCalled();
    expect(newLeaf.setViewState).not.toHaveBeenCalled();
  });

  it('keeps the chat where it is when the sidebar has no leaf to give', async () => {
    const { views, view, oldLeaf } = setup({ left: false });

    await expect(views.moveViewToSide(view, 'left')).resolves.toBe(false);

    expect(oldLeaf.detach).not.toHaveBeenCalled();
  });
});
