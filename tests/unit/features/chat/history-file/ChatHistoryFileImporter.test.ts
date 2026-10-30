import { testDate } from '@test/helpers/testClock';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';

import type { Conversation } from '@/core/types';
import {
  ChatHistoryFileImporter,
  readChatFileImportRecord,
} from '@/features/chat/history-file/ChatHistoryFileImporter';

const CREATED = testDate({ hours: -2 }).toISOString();
const UPDATED = testDate({ hours: -1 }).toISOString();

function createFile(path: string): TFile {
  const file = new TFile();
  Object.assign(file, {
    path,
    name: path.split('/').pop() ?? path,
    basename: (path.split('/').pop() ?? '').replace(/\.md$/i, ''),
    extension: 'md',
  });
  return file;
}

describe('readChatFileImportRecord', () => {
  it('reads a valid chat file frontmatter record', () => {
    expect(readChatFileImportRecord({
      'claudian-chat': true,
      'claudian-chat-version': 1,
      id: 'conv-1',
      provider: 'claude',
      title: 'Plan',
      created: CREATED,
      updated: UPDATED,
      linked: 'Projects/A/x.md',
      sessionId: 'native-1',
    })).toEqual({
      id: 'conv-1',
      providerId: 'claude',
      title: 'Plan',
      createdAt: Date.parse(CREATED),
      lastActivityAt: Date.parse(UPDATED),
      linkedContentPath: 'Projects/A/x.md',
      sessionId: 'native-1',
    });
  });
});

describe('ChatHistoryFileImporter', () => {
  it('creates meta for a new id and is idempotent across two scans', async () => {
    const file = createFile('Projects/A/Plan.chat.md');
    const frontmatter = {
      'claudian-chat': true,
      id: 'import-1',
      provider: 'claude',
      title: 'Plan',
      created: CREATED,
      updated: UPDATED,
      linked: 'Projects/A/x.md',
      sessionId: 'native-1',
    };
    const known = new Set<string>();
    const tombstones = new Set<string>();
    const imported: string[] = [];
    const app = {
      vault: { getMarkdownFiles: () => [file] },
      metadataCache: { getFileCache: () => ({ frontmatter }) },
    } as unknown as App;

    const importer = new ChatHistoryFileImporter({
      app,
      hasAnyMetadata: async (id) => known.has(id),
      hasTombstone: async (id) => tombstones.has(id),
      importConversation: async (record) => {
        known.add(record.id);
        imported.push(record.id);
        return { id: record.id } as Conversation;
      },
      reportError: jest.fn(),
    });

    importer.scheduleScan();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    importer.scheduleScan();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(imported).toEqual(['import-1']);
  });

  it('skips tombstoned and already-known ids', async () => {
    const file = createFile('Projects/A/Plan.chat.md');
    const frontmatter = {
      'claudian-chat': true,
      id: 'import-2',
      provider: 'claude',
      title: 'Plan',
      created: CREATED,
      updated: UPDATED,
    };
    const app = {
      vault: { getMarkdownFiles: () => [file] },
      metadataCache: { getFileCache: () => ({ frontmatter }) },
    } as unknown as App;
    const importConversation = jest.fn(async () => null);

    const tombstoned = new ChatHistoryFileImporter({
      app,
      hasAnyMetadata: async () => false,
      hasTombstone: async () => true,
      importConversation,
      reportError: jest.fn(),
    });
    tombstoned.scheduleScan();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(importConversation).not.toHaveBeenCalled();

    const known = new ChatHistoryFileImporter({
      app,
      hasAnyMetadata: async () => true,
      hasTombstone: async () => false,
      importConversation,
      reportError: jest.fn(),
    });
    known.scheduleScan();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(importConversation).not.toHaveBeenCalled();
  });
  it('keeps importing later chat files after one file fails', async () => {
    const broken = createFile('Projects/A/Broken.chat.md');
    const healthy = createFile('Projects/A/Healthy.chat.md');
    const frontmatterById: Record<string, Record<string, unknown>> = {
      [broken.path]: {
        'claudian-chat': true, id: 'broken-1', provider: 'not-registered', title: 'Broken',
        created: CREATED, updated: UPDATED,
      },
      [healthy.path]: {
        'claudian-chat': true, id: 'healthy-1', provider: 'claude', title: 'Healthy',
        created: CREATED, updated: UPDATED,
      },
    };
    const app = {
      vault: { getMarkdownFiles: () => [broken, healthy] },
      metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: frontmatterById[file.path] }) },
    } as unknown as App;
    const imported: string[] = [];
    const reportError = jest.fn();

    const importer = new ChatHistoryFileImporter({
      app,
      hasAnyMetadata: async () => false,
      hasTombstone: async () => false,
      importConversation: async (record) => {
        if (record.id === 'broken-1') throw new Error('Unknown provider');
        imported.push(record.id);
        return { id: record.id } as Conversation;
      },
      reportError,
    });
    importer.scheduleScan();
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(imported).toEqual(['healthy-1']);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('imports only the changed chat file instead of rescanning the vault', async () => {
    const changed = createFile('Projects/A/Changed.chat.md');
    const other = createFile('Projects/A/Other.chat.md');
    const getMarkdownFiles = jest.fn(() => [changed, other]);
    const frontmatterFor = (id: string) => ({
      'claudian-chat': true, id, provider: 'claude', title: id, created: CREATED, updated: UPDATED,
    });
    const app = {
      vault: { getMarkdownFiles },
      metadataCache: {
        getFileCache: (file: TFile) => ({
          frontmatter: frontmatterFor(file === changed ? 'changed-1' : 'other-1'),
        }),
      },
    } as unknown as App;
    const imported: string[] = [];

    const importer = new ChatHistoryFileImporter({
      app,
      hasAnyMetadata: async () => false,
      hasTombstone: async () => false,
      importConversation: async (record) => {
        imported.push(record.id);
        return { id: record.id } as Conversation;
      },
      reportError: jest.fn(),
    });
    importer.handleFileChanged(changed);
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(imported).toEqual(['changed-1']);
    expect(getMarkdownFiles).not.toHaveBeenCalled();
  });
});
