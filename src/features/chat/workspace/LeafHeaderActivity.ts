import type { WorkspaceLeaf } from 'obsidian';

import type { TabBarItem } from '@/features/chat/tabs/ChatTab';

/** What the Obsidian tab header of a chat leaf shows: a chat waiting for the user wins over work. */
export type LeafHeaderActivity = 'working' | 'attention' | null;

const ACTIVITY_CLASSES: Record<Exclude<LeafHeaderActivity, null>, string> = {
  working: 'claudian-tab-header--working',
  attention: 'claudian-tab-header--attention',
};

export function resolveLeafHeaderActivity(
  items: readonly Pick<TabBarItem, 'isWorking' | 'attention'>[],
): LeafHeaderActivity {
  if (items.some(item => item.attention?.kind === 'action-required')) return 'attention';
  if (items.some(item => item.isWorking)) return 'working';
  return null;
}

/**
 * Marks the leaf's tab header so its icon animates. Obsidian has no public API for the header
 * element; its own Web Viewer uses the same leaf fields, and without them nothing is shown.
 */
export function applyLeafHeaderActivity(leaf: WorkspaceLeaf, activity: LeafHeaderActivity): void {
  const headerEl = (leaf as { tabHeaderEl?: HTMLElement }).tabHeaderEl;
  if (!headerEl) return;
  for (const [kind, className] of Object.entries(ACTIVITY_CLASSES)) {
    headerEl.classList.toggle(className, kind === activity);
  }
}

/**
 * Hides the leaf's tab header while its chat floats in the zen window, so the tab seems gone
 * and only the placeholder pane stays behind. Same undocumented header element as above.
 */
export function applyLeafHeaderZen(leaf: WorkspaceLeaf, floating: boolean): void {
  const headerEl = (leaf as { tabHeaderEl?: HTMLElement }).tabHeaderEl;
  headerEl?.classList.toggle('claudian-tab-header--zen', floating);
}
