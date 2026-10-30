import type { Workspace, WorkspaceLeaf } from 'obsidian';

import { ClaudianViews } from '@/composition/ClaudianViews';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import type { ChatViewPlacement } from '@/core/types/settings';

function setup(placement: ChatViewPlacement, options: { leaf?: boolean } = {}) {
  const focusActiveInput = jest.fn();
  const leaf = {
    view: { getTabManager: () => null, focusActiveInput },
    setViewState: jest.fn(async () => undefined),
  } as unknown as WorkspaceLeaf;
  const existing = { id: 'existing' } as unknown as WorkspaceLeaf;
  const workspace = {
    getLeaf: jest.fn(() => leaf),
    getLeftLeaf: jest.fn(() => (options.leaf === false ? null : leaf)),
    getRightLeaf: jest.fn(() => (options.leaf === false ? null : leaf)),
    getLeavesOfType: jest.fn(() => [existing]),
    revealLeaf: jest.fn(async () => undefined),
  } as unknown as Workspace;
  return { views: new ClaudianViews(workspace, () => placement), workspace, leaf, existing, focusActiveInput };
}

describe('ClaudianViews.openNewTab', () => {
  it.each([
    ['main-tab', 'getLeaf', 'tab'],
    ['right-sidebar', 'getRightLeaf', false],
    ['left-sidebar', 'getLeftLeaf', false],
  ] as const)('opens a fresh chat leaf for the %s default', async (placement, getter, argument) => {
    const { views, workspace, leaf, focusActiveInput } = setup(placement);

    await views.openNewTab();

    expect(workspace[getter]).toHaveBeenCalledWith(argument);
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CLAUDIAN, active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    expect(focusActiveInput).toHaveBeenCalledTimes(1);
  });

  it('opens another leaf even when a chat view already exists', async () => {
    const { views, workspace, existing } = setup('right-sidebar');

    await views.openNewTab();

    expect(workspace.revealLeaf).not.toHaveBeenCalledWith(existing);
  });

  it('does nothing when the destination has no leaf to give', async () => {
    const { views, workspace } = setup('left-sidebar', { leaf: false });

    await views.openNewTab();

    expect(workspace.revealLeaf).not.toHaveBeenCalled();
  });
});
