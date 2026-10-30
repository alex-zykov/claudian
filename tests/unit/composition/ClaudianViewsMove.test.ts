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
  const handoff = { activeTabId: 't1', tabs: new Map() };
  const newView = {
    getTabManager: () => null,
    receiveHandoff: jest.fn(() => { calls.push('receiveHandoff'); }),
  };
  const newLeaf = {
    view: newView,
    setViewState: jest.fn(async () => { calls.push('setViewState'); }),
  } as unknown as WorkspaceLeaf;
  const workspace = {
    getLeftLeaf: jest.fn(() => (options.left === false ? null : newLeaf)),
    getRightLeaf: jest.fn(() => (options.right === false ? null : newLeaf)),
    getLeaf: jest.fn(() => newLeaf),
    revealLeaf: jest.fn(async () => { calls.push('reveal'); }),
    getLeavesOfType: jest.fn(() => []),
  } as unknown as Workspace;
  const view = {
    leaf: oldLeaf,
    captureHandoff: jest.fn(() => { calls.push('capture'); return handoff; }),
    getTabManager: () => ({
      getAllTabs: () => [{ state: { isStreaming: options.streaming === true } }],
    }),
  } as unknown as ClaudianView;
  const views = new ClaudianViews(workspace, () => 'right-sidebar');
  return { views, view, workspace, oldLeaf, newLeaf, newView, handoff, state, calls };
}

describe('ClaudianViews.moveView', () => {
  it.each([
    ['left', 'getLeftLeaf', false],
    ['right', 'getRightLeaf', false],
  ] as const)('reopens the chat tabs in the %s sidebar and closes the old tab', async (side, getter, argument) => {
    const { views, view, workspace, newLeaf, state, calls } = setup();

    await expect(views.moveView(view, side)).resolves.toBe(true);

    expect(workspace[getter]).toHaveBeenCalledWith(argument);
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

    await expect(views.moveView(view, 'left')).resolves.toBe(false);

    expect(oldLeaf.detach).not.toHaveBeenCalled();
    expect(newLeaf.setViewState).not.toHaveBeenCalled();
  });

  it('keeps the chat where it is when the sidebar has no leaf to give', async () => {
    const { views, view, oldLeaf } = setup({ left: false });

    await expect(views.moveView(view, 'left')).resolves.toBe(false);

    expect(oldLeaf.detach).not.toHaveBeenCalled();
  });
});

describe('ClaudianViews.moveView in place', () => {
  function tabsGroup(calls: string[], name: string, children: unknown[]) {
    const group = {
      children,
      removeChild: jest.fn((child: unknown) => {
        calls.push(`${name}.removeChild`);
        group.children.splice(group.children.indexOf(child), 1);
      }),
      insertChild: jest.fn((index: number, child: unknown) => {
        calls.push(`${name}.insertChild`);
        group.children.splice(index, 0, child);
      }),
      selectTabIndex: jest.fn(() => { calls.push(`${name}.selectTabIndex`); }),
    };
    return group;
  }

  function setup(options: { streaming?: boolean } = {}) {
    const calls: string[] = [];
    const leaf = {
      detach: jest.fn(() => { calls.push('detach'); }),
      setDimension: jest.fn(() => { calls.push('setDimension'); }),
      getViewState: jest.fn(),
      parent: null as unknown,
    };
    const sibling = {};
    const from = tabsGroup(calls, 'from', [sibling, leaf]);
    leaf.parent = from;
    const existing = {};
    const to = tabsGroup(calls, 'to', []);
    // A real leaf leaves its tab group when detached.
    const placeholder = {
      detach: jest.fn(() => {
        calls.push('placeholder.detach');
        to.children.splice(to.children.indexOf(placeholder), 1);
      }),
      setViewState: jest.fn(),
      parent: to as unknown,
    };
    to.children.push(existing, placeholder);
    const workspace = {
      getLeftLeaf: jest.fn(() => placeholder),
      getRightLeaf: jest.fn(() => placeholder),
      getLeaf: jest.fn(() => placeholder),
      revealLeaf: jest.fn(async () => { calls.push('reveal'); }),
      requestSaveLayout: jest.fn(),
      getLeavesOfType: jest.fn(() => []),
    } as unknown as Workspace;
    const view = {
      leaf,
      refreshPlacement: jest.fn(),
      captureHandoff: jest.fn(),
      getTabManager: () => ({
        getAllTabs: () => [{ state: { isStreaming: options.streaming === true } }],
      }),
    } as unknown as ClaudianView;
    const views = new ClaudianViews(workspace, () => 'right-sidebar');
    return { views, view, leaf, placeholder, from, to, workspace, calls };
  }

  it.each(['left', 'right', 'main'] as const)('moves the live view into the %s destination as a drag does', async (destination) => {
    const { views, view, leaf, placeholder, to, workspace, calls } = setup();

    await expect(views.moveView(view, destination)).resolves.toBe(true);

    expect(calls).toEqual([
      'from.removeChild',
      'setDimension',
      'to.insertChild',
      'placeholder.detach',
      'to.selectTabIndex',
      'reveal',
    ]);
    expect(to.children).toEqual([expect.anything(), leaf]);
    expect(placeholder.detach).toHaveBeenCalledTimes(1);
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it('saves the new layout and lets the view update what depends on where it sits', async () => {
    const { views, view, workspace } = setup();

    await views.moveView(view, 'left');

    expect(workspace.requestSaveLayout).toHaveBeenCalledTimes(1);
    expect(view.refreshPlacement).toHaveBeenCalledTimes(1);
  });

  it('does not close the view or rebuild its state, so nothing is lost', async () => {
    const { views, view, leaf, placeholder } = setup();

    await views.moveView(view, 'left');

    expect(leaf.detach).not.toHaveBeenCalled();
    expect(leaf.getViewState).not.toHaveBeenCalled();
    expect(placeholder.setViewState).not.toHaveBeenCalled();
  });

  it('moves a chat that is streaming an answer, because the view stays alive', async () => {
    const { views, view } = setup({ streaming: true });

    await expect(views.moveView(view, 'right')).resolves.toBe(true);
  });
});
