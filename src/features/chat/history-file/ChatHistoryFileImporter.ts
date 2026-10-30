import type { App, TAbstractFile, TFile } from 'obsidian';
import { TFile as ObsidianTFile } from 'obsidian';

import { isValidSessionMetadataId } from '@/core/bootstrap/storagePaths';
import type { ProviderId } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import { readChatFileId } from '@/features/chat/history-file/HistoryFileWriter';

export interface ChatHistoryFileImportRecord {
  id: string;
  providerId: ProviderId;
  title: string;
  createdAt: number;
  lastActivityAt: number;
  sessionId: string | null;
  linkedContentPath?: string;
}

export interface ChatHistoryFileImporterDeps {
  readonly app: App;
  /** App admission: true when any metadata layer already owns this id. */
  hasAnyMetadata(id: string): Promise<boolean>;
  /** App admission: true when a tombstone or in-session delete blocks import. */
  hasTombstone(id: string): Promise<boolean>;
  /** Creates device-local metadata for an imported chat file without touching native history. */
  importConversation(record: ChatHistoryFileImportRecord): Promise<Conversation | null>;
  /** Surfaces a failed file import; the scan continues with the remaining files. */
  reportError(error: unknown): void;
}

/**
 * Scans vault markdown for `claudian-chat` frontmatter and creates missing
 * device metadata. Never overwrites existing meta or resurrects tombstones.
 * Storage-layout admission stays in app; this feature only reads frontmatter.
 */
export class ChatHistoryFileImporter {
  readonly #deps: ChatHistoryFileImporterDeps;
  #disposed = false;
  #scanTail: Promise<void> = Promise.resolve();

  constructor(deps: ChatHistoryFileImporterDeps) {
    this.#deps = deps;
  }

  scheduleScan(): void {
    this.#enqueue(() => this.#scan());
  }

  handleFileChanged(file: TAbstractFile): void {
    if (!(file instanceof ObsidianTFile)) return;
    if (file.extension.toLocaleLowerCase() !== 'md') return;
    this.#enqueue(() => this.#importFileSafely(file));
  }

  dispose(): void {
    this.#disposed = true;
  }

  #enqueue(task: () => Promise<void>): void {
    if (this.#disposed) return;
    this.#scanTail = this.#scanTail.then(task);
  }

  async #scan(): Promise<void> {
    if (this.#disposed) return;
    const files = typeof this.#deps.app.vault.getMarkdownFiles === 'function'
      ? this.#deps.app.vault.getMarkdownFiles()
      : [];
    for (const file of files) {
      if (this.#disposed) return;
      await this.#importFileSafely(file);
    }
  }

  async #importFileSafely(file: TFile): Promise<void> {
    if (this.#disposed) return;
    try {
      await this.#importFile(file);
    } catch (error) {
      this.#deps.reportError(error);
    }
  }

  async #importFile(file: TFile): Promise<void> {
    const record = readChatFileImportRecord(
      this.#deps.app.metadataCache?.getFileCache?.(file)?.frontmatter,
    );
    if (!record) return;
    if (!isValidSessionMetadataId(record.id)) return;
    if (await this.#deps.hasTombstone(record.id)) return;
    if (await this.#deps.hasAnyMetadata(record.id)) return;
    await this.#deps.importConversation(record);
  }
}

export function readChatFileImportRecord(
  frontmatter: Record<string, unknown> | undefined,
): ChatHistoryFileImportRecord | null {
  if (!frontmatter || frontmatter['claudian-chat'] !== true) return null;
  const id = readChatFileId(frontmatter);
  if (!id) return null;
  if (typeof frontmatter.provider !== 'string' || frontmatter.provider.length === 0) return null;
  if (typeof frontmatter.title !== 'string') return null;

  const createdAt = parseTimestamp(frontmatter.created);
  const lastActivityAt = parseTimestamp(frontmatter.updated) ?? createdAt;
  if (createdAt === undefined || lastActivityAt === undefined) return null;

  return {
    id,
    providerId: frontmatter.provider,
    title: frontmatter.title,
    createdAt,
    lastActivityAt,
    sessionId: typeof frontmatter.sessionId === 'string' ? frontmatter.sessionId : null,
    ...(typeof frontmatter.linked === 'string' ? { linkedContentPath: frontmatter.linked } : {}),
  };
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
