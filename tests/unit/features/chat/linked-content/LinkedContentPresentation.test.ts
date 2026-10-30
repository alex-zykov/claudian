import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { resolveLinkedFolder } from '@/core/path/ResolveLinkedFolder';
import {
  createVaultLinkedContentIsFolder,
  deriveLinkedContentPresentation,
} from '@/features/chat/linked-content/LinkedContentPresentation';

function createFile(path: string): TFile {
  const file = new TFile();
  Object.assign(file, {
    path,
    name: path.split('/').pop() ?? '',
    basename: (path.split('/').pop() ?? '').replace(/\.[^.]+$/, ''),
    extension: path.split('.').pop() ?? '',
  });
  return file;
}

function createFolder(path: string): TFolder {
  const folder = new TFolder();
  Object.assign(folder, { path, name: path.split('/').pop() ?? '' });
  return folder;
}

function createApp(entries: Array<TFile | TFolder>): App {
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  return {
    vault: {
      getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
    },
  } as unknown as App;
}

describe('createVaultLinkedContentIsFolder', () => {
  it('reports folders, files, and missing targets for resolveLinkedFolder', () => {
    const isFolder = createVaultLinkedContentIsFolder(createApp([
      createFolder('Projects/A'),
      createFile('Projects/A/x.md'),
    ]));

    expect(isFolder('Projects/A')).toBe(true);
    expect(isFolder('Projects/A/x.md')).toBe(false);
    expect(isFolder('Missing/Plan.md')).toBeUndefined();

    expect(resolveLinkedFolder('Projects/A', isFolder)).toBe('Projects/A');
    expect(resolveLinkedFolder('Projects/A/x.md', isFolder)).toBe('Projects/A');
    expect(resolveLinkedFolder(undefined, isFolder)).toBe('');
  });
});

describe('deriveLinkedContentPresentation folder', () => {
  const app = createApp([
    createFolder('Projects'),
    createFolder('Projects/A'),
    createFile('Projects/A/x.md'),
    createFile('Inbox.md'),
  ]);

  it.each([
    ['Projects/A/x.md', 'Projects/A'],
    ['Inbox.md', ''],
    ['Projects/A', 'Projects/A'],
    ['Projects', 'Projects'],
    ['Projects/A/gone.md', 'Projects/A'],
  ])('derives the project folder of %s as %j', (path, folder) => {
    expect(deriveLinkedContentPresentation(app, path).folder).toBe(folder);
  });
});
