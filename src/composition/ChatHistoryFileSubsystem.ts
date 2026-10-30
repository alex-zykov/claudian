import type { App, EventRef } from 'obsidian';

import type { ConversationService } from '@/app/conversations/ConversationService';
import {
  hasAnySessionMetadata,
  hasSessionTombstone,
  listDeviceSessionFolders,
} from '@/app/storage/ChatHistoryFileAdmission';
import type { SharedStorageService } from '@/app/storage/SharedStorageService';
import type { ChatFileCustomField } from '@/core/chat-file/chatFileCustomFields';
import type { ClaudianSettings } from '@/core/types';
import type { ChatHistoryFilePort } from '@/features/chat/ChatFeatureHost';
import { ChatFileOpenHandler } from '@/features/chat/history-file/ChatFileOpenHandler';
import { ChatHistoryFileImporter } from '@/features/chat/history-file/ChatHistoryFileImporter';
import { HistoryFileWriter } from '@/features/chat/history-file/HistoryFileWriter';

import type { ClaudianViews } from './ClaudianViews';

export interface ChatHistoryFileSubsystemDeps {
  readonly app: App;
  readonly storage: SharedStorageService;
  readonly conversations: ConversationService;
  readonly views: ClaudianViews;
  isWriteHistoryFileEnabled(): boolean;
  isWriteHistoryFileTextEnabled(): boolean;
  getChatFileCustomFields(): readonly ChatFileCustomField[];
  reportError(error: unknown): void;
}

/**
 * Main-owned wiring for chat history files: writer projection, import admission and
 * open-on-click routing. Keeps storage-layout policy and settings/delete
 * side effects out of feature modules and out of inline main lambdas.
 */
export class ChatHistoryFileSubsystem {
  readonly writer: HistoryFileWriter;
  readonly importer: ChatHistoryFileImporter;
  readonly openHandler: ChatFileOpenHandler;
  /** The surface chat features use: writer operations. */
  readonly port: ChatHistoryFilePort;

  private constructor(
    writer: HistoryFileWriter,
    importer: ChatHistoryFileImporter,
    openHandler: ChatFileOpenHandler,
    private readonly deps: ChatHistoryFileSubsystemDeps,
  ) {
    this.writer = writer;
    this.importer = importer;
    this.openHandler = openHandler;
    this.port = {
      scheduleWrite: id => writer.scheduleWrite(id),
      hasFile: id => writer.getFile(id) !== null,
      openFileAsMarkdown: async (id) => {
        const file = writer.getFile(id);
        if (!file) return false;
        await openHandler.openAsMarkdown(file);
        return true;
      },
      trashForConversation: id => writer.trashForConversation(id),
      startBackfill: () => writer.startBackfill(),
      cancelBackfill: () => writer.cancelBackfill(),
    };
  }

  static create(deps: ChatHistoryFileSubsystemDeps): ChatHistoryFileSubsystem {
    const writer = new HistoryFileWriter({
      app: deps.app,
      isEnabled: () => deps.isWriteHistoryFileEnabled(),
      isTextEnabled: () => deps.isWriteHistoryFileTextEnabled(),
      getCustomFields: () => deps.getChatFileCustomFields(),
      getConversation: id => deps.conversations.getCachedConversation(id)
        ?? deps.conversations.getConversationSync(id),
      hydrateConversation: id => deps.conversations.getConversationById(id),
      listConversationMeta: () => deps.conversations.getConversationList(),
      reportError: error => deps.reportError(error),
    });

    const adapter = deps.storage.getAdapter();
    const listDeviceFolders = () => listDeviceSessionFolders(path => adapter.listFolders(path));
    const importer = new ChatHistoryFileImporter({
      app: deps.app,
      hasAnyMetadata: async (id) => {
        if (deps.conversations.hasLiveConversation(id)) return true;
        return hasAnySessionMetadata(
          path => adapter.exists(path),
          listDeviceFolders,
          id,
        );
      },
      hasTombstone: async (id) => {
        if (deps.conversations.wasDeletedInSession(id)) return true;
        return hasSessionTombstone(
          path => adapter.exists(path),
          listDeviceFolders,
          id,
        );
      },
      importConversation: record => deps.conversations.importFromHistoryFile(record),
      reportError: error => deps.reportError(error),
    });

    const openHandler = new ChatFileOpenHandler({
      app: deps.app,
      hasConversation: id => deps.conversations.hasLiveConversation(id),
      revealOpenConversation: id => deps.views.focusConversation(id),
      openConversationInNewTab: id => deps.views.openConversationInNewTab(id),
    });

    return new ChatHistoryFileSubsystem(writer, importer, openHandler, deps);
  }

  register(registerEvent: (eventRef: EventRef) => void): void {
    const { app } = this.deps;
    this.openHandler.install();
    this.importer.scheduleScan();
    if (typeof app.vault?.on === 'function') {
      registerEvent(app.vault.on('create', file => {
        this.importer.handleFileChanged(file);
      }));
      registerEvent(app.vault.on('modify', file => {
        this.importer.handleFileChanged(file);
      }));
    }
    if (typeof app.metadataCache?.on === 'function') {
      registerEvent(app.metadataCache.on('changed', file => {
        this.importer.handleFileChanged(file);
      }));
    }
  }

  onSettingsCommitted(
    settings: Readonly<ClaudianSettings>,
    previous: Readonly<ClaudianSettings>,
  ): void {
    if (settings.writeHistoryFile && !previous.writeHistoryFile) {
      this.writer.startBackfill();
    } else if (settings.writeHistoryFile && settings.writeHistoryFileText && !previous.writeHistoryFileText) {
      // Files written while the text was off have no transcript yet.
      this.writer.startBackfill();
    } else if (!settings.writeHistoryFile && previous.writeHistoryFile) {
      this.writer.cancelBackfill();
    }
  }

  async onConversationDeleted(
    conversationId: string,
    resetTabs: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.writer.trashForConversation(conversationId);
    } catch (error) {
      // Trash failure must not skip tab reset.
      this.deps.reportError(error);
    }
    await resetTabs();
  }

  dispose(): void {
    this.writer.dispose();
    this.importer.dispose();
    this.openHandler.uninstall();
  }
}
