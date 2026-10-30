/** @jest-environment jsdom */
import type { WorkspaceLeaf } from 'obsidian';

import {
  applyLeafHeaderActivity,
  resolveLeafHeaderActivity,
} from '@/features/chat/workspace/LeafHeaderActivity';

const idle = { isWorking: false, attention: null };
const working = { isWorking: true, attention: null };
const waiting = { isWorking: true, attention: { kind: 'action-required', since: 1 } } as const;
const reviewed = { isWorking: false, attention: { kind: 'review', outcome: 'completed', since: 1 } } as const;

describe('resolveLeafHeaderActivity', () => {
  it.each([
    ['no chats', [], null],
    ['idle chats', [idle, reviewed], null],
    ['a working chat', [idle, working], 'working'],
    ['a chat waiting for the user, even while another works', [working, waiting], 'attention'],
  ])('reports %s', (_case, items, expected) => {
    expect(resolveLeafHeaderActivity(items)).toBe(expected);
  });
});

describe('applyLeafHeaderActivity', () => {
  function createLeaf(): { leaf: WorkspaceLeaf; header: HTMLElement } {
    const header = document.createElement('div');
    header.className = 'workspace-tab-header';
    return { leaf: { tabHeaderEl: header } as unknown as WorkspaceLeaf, header };
  }

  it('marks the tab header with the one current activity and clears it when idle', () => {
    const { leaf, header } = createLeaf();

    applyLeafHeaderActivity(leaf, 'working');
    expect([...header.classList]).toEqual(['workspace-tab-header', 'claudian-tab-header--working']);

    applyLeafHeaderActivity(leaf, 'attention');
    expect([...header.classList]).toEqual(['workspace-tab-header', 'claudian-tab-header--attention']);

    applyLeafHeaderActivity(leaf, null);
    expect([...header.classList]).toEqual(['workspace-tab-header']);
  });

  it('does nothing when Obsidian does not expose the tab header', () => {
    expect(() => applyLeafHeaderActivity({} as WorkspaceLeaf, 'working')).not.toThrow();
  });
});
