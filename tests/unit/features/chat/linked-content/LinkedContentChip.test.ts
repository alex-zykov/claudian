import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import type { ComposerInfoItem, ComposerInfoRow } from '@/features/chat/composer/ComposerInfoRow';
import { LinkedContentChip } from '@/features/chat/linked-content/LinkedContentChip';
import { deriveLinkedContentPresentation } from '@/features/chat/linked-content/LinkedContentPresentation';

function createFile(path: string): TFile {
  const file = new TFile();
  const name = path.split('/').pop() ?? path;
  Object.assign(file, { path, name, basename: name.replace(/\.md$/i, ''), extension: 'md' });
  return file;
}

function createFolder(path: string): TFolder {
  const folder = new TFolder();
  Object.assign(folder, { path, name: path.split('/').pop() ?? path });
  return folder;
}

const entries = new Map<string, TFile | TFolder>([
  ['Projects', createFolder('Projects')],
  ['Projects/A', createFolder('Projects/A')],
  ['Projects/A/Plan.md', createFile('Projects/A/Plan.md')],
  ['Inbox.md', createFile('Inbox.md')],
]);
const app = {
  vault: { getAbstractFileByPath: (path: string) => entries.get(path) ?? null },
} as unknown as App;

function render(path: string): ComposerInfoItem {
  let item: ComposerInfoItem | null = null;
  const infoRow = {
    setLinkedContent: (next: ComposerInfoItem | null) => { item = next; },
  } as unknown as ComposerInfoRow;
  new LinkedContentChip(infoRow, jest.fn(), jest.fn())
    .render(deriveLinkedContentPresentation(app, path), true);
  if (!item) throw new Error('Chip did not render');
  return item;
}

describe('LinkedContentChip project folder', () => {
  it.each([
    ['Projects/A/Plan.md', 'Projects/A'],
    ['Inbox.md', 'Vault root'],
    ['Projects/A', 'Projects/A'],
  ])('shows %s with folder detail %j', (path, detail) => {
    const item = render(path);
    expect(item.detail).toBe(detail);
    expect(item.ariaLabel).toContain(`Folder: ${detail}`);
  });

  it('omits detail for a top-level folder whose label already names it', () => {
    const item = render('Projects');
    expect(item.label).toBe('Projects');
    expect(item.detail).toBeUndefined();
  });
});
