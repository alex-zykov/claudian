import '@/providers';

import { testDate } from '@test/helpers/testClock';
import type { App } from 'obsidian';
import { parseYaml, TFile, TFolder } from 'obsidian';

import type { ChatMessage, Conversation, ConversationMeta } from '@/core/types';
import { HistoryFileWriter } from '@/features/chat/history-file/HistoryFileWriter';

const CREATED_AT = testDate({ hours: -2 }).getTime();
const UPDATED_AT = testDate({ hours: -1 }).getTime();

function createFile(path: string, content = ''): TFile {
  const file = new TFile();
  const name = path.split('/').pop() ?? path;
  Object.assign(file, {
    path,
    name,
    basename: name.replace(/\.md$/i, ''),
    extension: 'md',
  });
  (file as TFile & { __content?: string }).__content = content;
  return file;
}

function createFolder(path: string): TFolder {
  const folder = new TFolder();
  Object.assign(folder, { path, name: path.split('/').pop() ?? path });
  return folder;
}

function user(content: string): ChatMessage {
  return {
    id: `u-${content}`,
    role: 'user',
    content,
    timestamp: CREATED_AT,
  };
}

function assistant(content: string): ChatMessage {
  return {
    id: `a-${content}`,
    role: 'assistant',
    content,
    contentBlocks: [{ type: 'text', content }],
    timestamp: CREATED_AT,
    completedAt: UPDATED_AT,
  };
}

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    providerId: 'claude',
    title: 'Plan review',
    createdAt: CREATED_AT,
    lastActivityAt: UPDATED_AT,
    sessionId: 'session-1',
    linkedContentPath: 'Projects/A/x.md',
    messages: [user('hello'), assistant('world')],
    ...overrides,
  };
}

function createVaultHarness(initial: Array<TFile | TFolder> = []) {
  const entries = new Map<string, TFile | TFolder>(initial.map(entry => [entry.path, entry]));
  const frontmatterByPath = new Map<string, Record<string, unknown>>();
  const contents = new Map<string, string>();
  for (const entry of initial) {
    if (entry instanceof TFile) {
      contents.set(entry.path, (entry as TFile & { __content?: string }).__content ?? '');
    }
  }

  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
      getMarkdownFiles: () => [...entries.values()].filter((entry): entry is TFile => entry instanceof TFile),
      create: jest.fn(async (path: string, data: string) => {
        const file = createFile(path, data);
        entries.set(path, file);
        contents.set(path, data);
        const idMatch = data.match(/^id:\s*["']?([^"'\n]+)/m)
          ?? data.match(/\nid:\s*["']?([^"'\n]+)/);
        // Prefer YAML id from frontmatter block.
        const fmMatch = data.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const idLine = fmMatch[1].match(/^id:\s*(.+)$/m);
          if (idLine) {
            const id = JSON.parse(idLine[1].startsWith('"') ? idLine[1] : `"${idLine[1]}"`) as string;
            frontmatterByPath.set(path, { 'claudian-chat': true, id });
          }
        } else if (idMatch) {
          frontmatterByPath.set(path, { 'claudian-chat': true, id: idMatch[1] });
        }
        return file;
      }),
      createFolder: jest.fn(async (path: string) => {
        const folder = createFolder(path);
        entries.set(path, folder);
        return folder;
      }),
      process: jest.fn(async (file: TFile, fn: (data: string) => string) => {
        const next = fn(contents.get(file.path) ?? '');
        contents.set(file.path, next);
      }),
    },
    fileManager: {
      processFrontMatter: jest.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm = { ...(frontmatterByPath.get(file.path) ?? {}) };
        fn(fm);
        frontmatterByPath.set(file.path, fm);
        const body = (contents.get(file.path) ?? '').replace(/^---\n[\s\S]*?\n---\n?/, '');
        const yaml = Object.entries(fm)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n');
        contents.set(file.path, `---\n${yaml}\n---\n${body}`);
      }),
      renameFile: jest.fn(async (file: TFile, newPath: string) => {
        entries.delete(file.path);
        contents.set(newPath, contents.get(file.path) ?? '');
        contents.delete(file.path);
        const fm = frontmatterByPath.get(file.path);
        frontmatterByPath.delete(file.path);
        if (fm) frontmatterByPath.set(newPath, fm);
        Object.assign(file, {
          path: newPath,
          name: newPath.split('/').pop() ?? newPath,
          basename: (newPath.split('/').pop() ?? '').replace(/\.md$/i, ''),
        });
        entries.set(newPath, file);
      }),
      trashFile: jest.fn(async (file: TFile) => {
        entries.delete(file.path);
        contents.delete(file.path);
        frontmatterByPath.delete(file.path);
      }),
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const fm = frontmatterByPath.get(file.path);
        return fm ? { frontmatter: fm } : null;
      },
    },
  } as unknown as App;

  return { app, entries, contents, frontmatterByPath };
}

describe('HistoryFileWriter', () => {
  it('writes a chat file once per turn and rewrites the body on the next turn', async () => {
    const folder = createFolder('Projects/A');
    const note = createFile('Projects/A/x.md');
    const harness = createVaultHarness([folder, note]);
    let conversation = createConversation();
    const enabled = true;
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => enabled,
      getConversation: (id) => (id === conversation.id ? conversation : null),
      hydrateConversation: async (id) => (id === conversation.id ? conversation : null),
      listConversationMeta: () => [],
      reportError: jest.fn(),
    });

    writer.scheduleWrite(conversation.id);
    await Promise.resolve();
    await Promise.resolve();
    await flushQueues();

    expect(harness.app.vault.create).toHaveBeenCalledTimes(1);
    const createdPath = 'Projects/A/Plan review.chat.md';
    expect(harness.contents.has(createdPath)).toBe(true);
    expect(harness.contents.get(createdPath)).toContain('hello');
    expect(harness.contents.get(createdPath)).toContain('world');
    expect(harness.frontmatterByPath.get(createdPath)?.id).toBe(conversation.id);

    conversation = createConversation({
      messages: [user('hello'), assistant('world'), user('again'), assistant('updated')],
      lastActivityAt: UPDATED_AT + 1,
    });
    writer.scheduleWrite(conversation.id);
    await flushQueues();

    expect(harness.app.vault.create).toHaveBeenCalledTimes(1);
    expect(harness.app.fileManager.processFrontMatter).toHaveBeenCalled();
    expect(harness.app.vault.process).toHaveBeenCalled();
    expect(harness.contents.get(createdPath)).toContain('updated');
    expect(harness.frontmatterByPath.get(createdPath)?.id).toBe(conversation.id);
  });

  it('keeps writing to a user-renamed path and recreates after delete only on the next turn', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    const conversation = createConversation();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
      reportError: jest.fn(),
    });

    writer.scheduleWrite(conversation.id);
    await flushQueues();
    const original = 'Projects/A/Plan review.chat.md';
    const moved = 'Projects/A/Renamed.chat.md';
    const file = harness.entries.get(original) as TFile;
    await harness.app.fileManager.renameFile(file, moved);
    writer.handleVaultRename(file, original);

    writer.scheduleWrite(conversation.id);
    await flushQueues();
    expect(harness.app.vault.create).toHaveBeenCalledTimes(1);
    expect(harness.contents.has(moved)).toBe(true);

    await harness.app.fileManager.trashFile(file);
    writer.handleVaultDelete(file);
    expect(harness.contents.has(moved)).toBe(false);

    writer.scheduleWrite(conversation.id);
    await flushQueues();
    expect(harness.app.vault.create).toHaveBeenCalledTimes(2);
  });

  it('writes nothing when the setting is off', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    const conversation = createConversation();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => false,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
      reportError: jest.fn(),
    });
    writer.scheduleWrite(conversation.id);
    await flushQueues();
    expect(harness.app.vault.create).not.toHaveBeenCalled();
  });

  it('backfills existing capable chats when started', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    const conversation = createConversation();
    const meta: ConversationMeta = {
      id: conversation.id,
      providerId: 'claude',
      title: conversation.title,
      createdAt: conversation.createdAt,
      lastActivityAt: conversation.lastActivityAt,
      messageCount: 2,
      preview: 'hello',
      linkedContentPath: conversation.linkedContentPath,
    };
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [meta],
      reportError: jest.fn(),
    });

    writer.startBackfill();
    await flushQueues();
    await new Promise(resolve => window.setTimeout(resolve, 40));
    await flushQueues();
    expect(harness.app.vault.create).toHaveBeenCalled();
  });

  it('serializes overlapping writes for one conversation', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    let conversation = createConversation();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
      reportError: jest.fn(),
    });

    writer.scheduleWrite(conversation.id);
    conversation = createConversation({
      messages: [user('hello'), assistant('second')],
    });
    writer.scheduleWrite(conversation.id);
    await flushQueues();
    expect(harness.app.vault.create).toHaveBeenCalledTimes(1);
    expect(harness.contents.get('Projects/A/Plan review.chat.md')).toContain('second');
  });

  it('trashes the chat markdown when deleting a conversation', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    const conversation = createConversation();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
      reportError: jest.fn(),
    });
    writer.scheduleWrite(conversation.id);
    await flushQueues();
    await writer.trashForConversation(conversation.id);
    expect(harness.app.fileManager.trashFile).toHaveBeenCalled();
    expect(harness.contents.has('Projects/A/Plan review.chat.md')).toBe(false);
  });

  it('uses a collision name when preferred path is occupied by a non-chat file', async () => {
    const occupied = createFile('Projects/A/Plan review.chat.md', '# foreign note\n');
    const harness = createVaultHarness([
      createFolder('Projects/A'),
      createFile('Projects/A/x.md'),
      occupied,
    ]);
    const conversation = createConversation();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
      reportError: jest.fn(),
    });
    writer.scheduleWrite(conversation.id);
    await flushQueues();
    expect(harness.contents.has('Projects/A/Plan review.chat.md')).toBe(true);
    expect(harness.contents.has('Projects/A/Plan review aaaaaaaa.chat.md')).toBe(true);
    expect(harness.frontmatterByPath.get('Projects/A/Plan review aaaaaaaa.chat.md')?.id)
      .toBe(conversation.id);
  });

  it.each([
    ['no tags', undefined, ['chat']],
    ['a tag list', ['project', 'draft'], ['project', 'draft', 'chat']],
    ['a tag string', 'project, draft', ['project', 'draft', 'chat']],
    ['the chat tag already', ['#chat', 'project'], ['#chat', 'project']],
  ])('tags a chat file with chat and keeps the user tags when it has %s', async (_case, userTags, expected) => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    let conversation = createConversation();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
      reportError: jest.fn(),
    });

    writer.scheduleWrite(conversation.id);
    await flushQueues();
    const path = 'Projects/A/Plan review.chat.md';
    expect(parseYaml(harness.contents.get(path)?.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''))
      .toMatchObject({ tags: ['chat'] });

    const fm = harness.frontmatterByPath.get(path) ?? {};
    if (userTags === undefined) delete fm.tags;
    else fm.tags = userTags;
    harness.frontmatterByPath.set(path, fm);
    conversation = createConversation({ lastActivityAt: UPDATED_AT + 1 });
    writer.scheduleWrite(conversation.id);
    await flushQueues();

    expect(harness.frontmatterByPath.get(path)?.tags).toEqual(expected);
  });

  it('renames on title change after restart using the title stored in the file', async () => {
    const existingPath = 'Projects/A/Plan review.chat.md';
    const existing = createFile(existingPath, '---\nid: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n---\n');
    const harness = createVaultHarness([
      createFolder('Projects/A'),
      createFile('Projects/A/x.md'),
      existing,
    ]);
    harness.frontmatterByPath.set(existingPath, {
      'claudian-chat': true,
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      title: 'Plan review',
    });
    harness.contents.set(existingPath, '---\ntitle: "Plan review"\nid: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n---\nbody\n');

    let conversation = createConversation({ title: 'Plan review' });
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
      reportError: jest.fn(),
    });

    conversation = createConversation({ title: 'Renamed plan' });
    writer.scheduleWrite(conversation.id);
    await flushQueues();

    expect(harness.app.fileManager.renameFile).toHaveBeenCalled();
    expect(harness.contents.has('Projects/A/Renamed plan.chat.md')).toBe(true);
    expect(harness.contents.has(existingPath)).toBe(false);
  });

  it('reports write errors from scheduleWrite without rejecting', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    const failure = new Error('exists');
    (harness.app.vault.create as jest.Mock).mockRejectedValueOnce(failure);
    const conversation = createConversation();
    const reportError = jest.fn();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
      reportError,
    });
    expect(() => writer.scheduleWrite(conversation.id)).not.toThrow();
    await flushQueues();
    expect(reportError).toHaveBeenCalledWith(failure);
  });
});

async function flushQueues(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}
