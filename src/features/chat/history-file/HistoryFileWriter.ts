import type { App, TAbstractFile } from 'obsidian';
import { TFile } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { Conversation, ConversationMeta } from '@/core/types';
import {
  chatFilePathForTitle,
  preferredChatFilePath,
} from '@/features/chat/history-file/chatFilePaths';
import {
  CHAT_FILE_TAG,
  type ChatFileFrontmatter,
  renderChatFile,
} from '@/features/chat/history-file/renderChatFile';
import { serializeChatMarkdown } from '@/features/chat/history-file/serializeChatMarkdown';
import { createVaultLinkedContentIsFolder } from '@/features/chat/linked-content/LinkedContentPresentation';

const BACKFILL_GAP_MS = 25;

/** Frontmatter keys the writer owns; every other key is the user's and is left alone. */
const OWNED_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  'claudian-chat',
  'claudian-chat-version',
  'id',
  'provider',
  'title',
  'created',
  'updated',
  'linked',
  'sessionId',
  'forkSessionId',
  'forkResumeAt',
]);

export interface HistoryFileWriterDeps {
  readonly app: App;
  isEnabled: () => boolean;
  getConversation: (id: string) => Conversation | null;
  hydrateConversation: (id: string) => Promise<Conversation | null>;
  listConversationMeta: () => readonly ConversationMeta[];
  /** Surfaces a failed background write; the queue keeps serving later turns. */
  reportError: (error: unknown) => void;
}

/**
 * Projects capable conversations into vault `.chat.md` files. One serialized
 * write queue per conversation; path cache tracks user renames/moves/deletes.
 */
export class HistoryFileWriter {
  readonly #deps: HistoryFileWriterDeps;
  readonly #isFolder: (path: string) => boolean | undefined;
  readonly #pathByConversationId = new Map<string, string>();
  readonly #queues = new Map<string, Promise<void>>();
  #backfillAbort: AbortController | null = null;
  #disposed = false;

  constructor(deps: HistoryFileWriterDeps) {
    this.#deps = deps;
    this.#isFolder = createVaultLinkedContentIsFolder(deps.app);
  }

  scheduleWrite(conversationId: string): void {
    if (this.#disposed || !this.#deps.isEnabled()) return;
    void this.#enqueue(conversationId, () => this.#writeConversation(conversationId))
      .catch(error => this.#deps.reportError(error));
  }

  async trashForConversation(conversationId: string): Promise<void> {
    await this.#enqueue(conversationId, async () => {
      const path = this.#pathByConversationId.get(conversationId)
        ?? this.#findPathById(conversationId);
      this.#pathByConversationId.delete(conversationId);
      if (!path) return;
      const file = this.#deps.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.#deps.app.fileManager.trashFile(file);
      }
    });
  }

  startBackfill(): void {
    if (this.#disposed || !this.#deps.isEnabled()) return;
    this.cancelBackfill();
    const abort = new AbortController();
    this.#backfillAbort = abort;
    void this.#runBackfill(abort.signal);
  }

  cancelBackfill(): void {
    this.#backfillAbort?.abort();
    this.#backfillAbort = null;
  }

  handleVaultRename(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile)) {
      for (const [id, path] of this.#pathByConversationId) {
        if (path === oldPath || path.startsWith(`${oldPath}/`)) {
          this.#pathByConversationId.set(
            id,
            path === oldPath ? file.path : `${file.path}${path.slice(oldPath.length)}`,
          );
        }
      }
      return;
    }
    const id = this.#idForPath(oldPath) ?? this.#readIdFromFile(file);
    if (!id) return;
    this.#pathByConversationId.set(id, file.path);
  }

  handleVaultDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile)) {
      for (const [id, path] of [...this.#pathByConversationId]) {
        if (path === file.path || path.startsWith(`${file.path}/`)) {
          this.#pathByConversationId.delete(id);
        }
      }
      return;
    }
    const id = this.#idForPath(file.path);
    if (id) this.#pathByConversationId.delete(id);
  }

  handleVaultCreate(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    const id = this.#readIdFromFile(file);
    if (id) this.#pathByConversationId.set(id, file.path);
  }

  dispose(): void {
    this.#disposed = true;
    this.cancelBackfill();
  }

  #enqueue(conversationId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.#queues.get(conversationId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(operation);
    this.#queues.set(conversationId, next);
    void next
      .finally(() => {
        if (this.#queues.get(conversationId) === next) {
          this.#queues.delete(conversationId);
        }
      })
      .catch(() => undefined);
    return next;
  }

  async #runBackfill(signal: AbortSignal): Promise<void> {
    const metas = this.#deps.listConversationMeta();
    for (const meta of metas) {
      if (signal.aborted || this.#disposed || !this.#deps.isEnabled()) return;
      const capabilities = ProviderRegistry.getCapabilities(meta.providerId);
      if (!capabilities.supportsChatHistoryFile) continue;
      this.scheduleWrite(meta.id);
      await delay(BACKFILL_GAP_MS, signal);
    }
  }

  async #writeConversation(conversationId: string): Promise<void> {
    if (this.#disposed || !this.#deps.isEnabled()) return;
    const conversation = this.#deps.getConversation(conversationId)
      ?? await this.#deps.hydrateConversation(conversationId);
    if (!conversation) return;

    const capabilities = ProviderRegistry.getCapabilities(
      conversation.providerId,
      conversation.providerState,
    );
    if (!capabilities.supportsChatHistoryFile) return;

    const rendered = renderChatFile(conversation);
    const existingPath = this.#pathByConversationId.get(conversationId)
      ?? this.#findPathById(conversationId);
    if (existingPath) {
      await this.#updateExisting(conversation, existingPath, rendered.frontmatter, rendered.body);
      return;
    }
    await this.#createNew(conversation, rendered.frontmatter, rendered.body);
  }

  async #createNew(
    conversation: Conversation,
    frontmatter: ChatFileFrontmatter,
    body: string,
  ): Promise<void> {
    const { preferred, collision } = preferredChatFilePath(conversation, this.#isFolder);
    const path = this.#needsCollisionName(preferred, conversation.id) ? collision : preferred;
    await this.#ensureParentFolders(path);
    const content = serializeChatMarkdown(frontmatter, body);
    const created = await this.#deps.app.vault.create(path, content);
    this.#pathByConversationId.set(conversation.id, created.path);
  }

  async #updateExisting(
    conversation: Conversation,
    path: string,
    frontmatter: ChatFileFrontmatter,
    body: string,
  ): Promise<void> {
    const existing = this.#deps.app.vault.getAbstractFileByPath(path);
    if (!(existing instanceof TFile)) {
      this.#pathByConversationId.delete(conversation.id);
      await this.#createNew(conversation, frontmatter, body);
      return;
    }

    // The file's own title is the last one written, so a rename survives restarts and a file
    // the user renamed by hand keeps its name until the conversation title actually changes.
    let previousTitle: unknown;
    await this.#deps.app.fileManager.processFrontMatter(existing, (fm: Record<string, unknown>) => {
      previousTitle = fm.title;
      // Tags are the user's; the writer only makes sure the chat tag is among them.
      const { tags: _chatTags, ...owned } = frontmatter;
      Object.assign(fm, owned);
      fm.tags = withChatTag(fm.tags);
      for (const key of Object.keys(fm)) {
        if (!(key in frontmatter) && OWNED_FRONTMATTER_KEYS.has(key)) delete fm[key];
      }
    });
    await this.#deps.app.vault.process(existing, (data) => replaceMarkdownBody(data, body));

    let target: TFile = existing;
    if (typeof previousTitle === 'string' && previousTitle !== conversation.title) {
      const desired = this.#renamedPathForTitleChange(conversation, target.path);
      if (desired !== target.path) {
        await this.#ensureParentFolders(desired);
        await this.#deps.app.fileManager.renameFile(target, desired);
        const renamed = this.#deps.app.vault.getAbstractFileByPath(desired);
        if (renamed instanceof TFile) target = renamed;
      }
    }
    this.#pathByConversationId.set(conversation.id, target.path);
  }

  #renamedPathForTitleChange(conversation: Conversation, currentPath: string): string {
    const separator = currentPath.lastIndexOf('/');
    const folder = separator === -1 ? '' : currentPath.slice(0, separator);
    const currentName = separator === -1 ? currentPath : currentPath.slice(separator + 1);
    const id8 = conversation.id.replace(/-/g, '').slice(0, 8);
    const usesCollision = currentName.includes(` ${id8}.chat.md`);
    return chatFilePathForTitle(folder, conversation.title, conversation.id, usesCollision);
  }

  #needsCollisionName(preferredPath: string, conversationId: string): boolean {
    const existing = this.#deps.app.vault.getAbstractFileByPath(preferredPath);
    if (!(existing instanceof TFile)) return false;
    const id = this.#readIdFromFile(existing);
    // Any non-ours occupant (other chat, ordinary note, or missing id) needs a collision name.
    return id !== conversationId;
  }

  #readIdFromFile(file: TFile): string | undefined {
    const cache = this.#deps.app.metadataCache?.getFileCache?.(file);
    return readChatFileId(cache?.frontmatter);
  }

  async #ensureParentFolders(path: string): Promise<void> {
    const parts = path.split('/');
    if (parts.length <= 1) return;
    let current = '';
    for (const part of parts.slice(0, -1)) {
      current = current ? `${current}/${part}` : part;
      const existing = this.#deps.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.#deps.app.vault.createFolder(current);
      }
    }
  }

  #findPathById(conversationId: string): string | undefined {
    for (const [id, path] of this.#pathByConversationId) {
      if (id === conversationId) return path;
    }
    const { vault } = this.#deps.app;
    if (typeof vault.getMarkdownFiles !== 'function') return undefined;
    for (const file of vault.getMarkdownFiles()) {
      const id = this.#readIdFromFile(file);
      if (id === conversationId) {
        this.#pathByConversationId.set(id, file.path);
        return file.path;
      }
    }
    return undefined;
  }

  #idForPath(path: string): string | undefined {
    for (const [id, cached] of this.#pathByConversationId) {
      if (cached === path) return id;
    }
    return undefined;
  }
}

export function readChatFileId(frontmatter: Record<string, unknown> | undefined): string | undefined {
  if (!frontmatter || frontmatter['claudian-chat'] !== true) return undefined;
  return typeof frontmatter.id === 'string' && frontmatter.id.length > 0
    ? frontmatter.id
    : undefined;
}

export function readChatFileTitle(frontmatter: Record<string, unknown> | undefined): string | undefined {
  if (!frontmatter || frontmatter['claudian-chat'] !== true) return undefined;
  return typeof frontmatter.title === 'string' && frontmatter.title.length > 0
    ? frontmatter.title
    : undefined;
}

function withChatTag(tags: unknown): unknown[] {
  const list: unknown[] = Array.isArray(tags)
    ? [...(tags as unknown[])]
    : typeof tags === 'string'
      ? tags.split(/[,\s]+/).filter(Boolean)
      : [];
  const hasChatTag = list.some(tag => (
    typeof tag === 'string' && tag.replace(/^#/, '').toLowerCase() === CHAT_FILE_TAG
  ));
  return hasChatTag ? list : [...list, CHAT_FILE_TAG];
}

function replaceMarkdownBody(data: string, body: string): string {
  const match = data.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;
  if (!match) return normalizedBody;
  return `${match[0]}${normalizedBody.replace(/^\n/, '')}`;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      window.clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
