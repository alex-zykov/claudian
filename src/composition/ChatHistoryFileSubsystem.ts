import type { App, EventRef } from 'obsidian';

import type { ConversationService } from '@/app/conversations/ConversationService';
import type { SharedStorageService } from '@/app/storage/SharedStorageService';
import type { ChatFileCustomField } from '@/core/chat-file/chatFileCustomFields';
import type { ClaudianSettings } from '@/core/types';
import type { ChatHistoryFilePort } from '@/features/chat/ChatFeatureHost';
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
 * Main-owned wiring for chat history files: writer projection into vault
 * `.chat.md` files. Import admission and open-on-click routing land in later
 * commits on this same subsystem.
 */
export class ChatHistoryFileSubsystem {
  readonly writer: HistoryFileWriter;
  /** The surface chat features use: writer operations. */
  readonly port: ChatHistoryFilePort;

  private constructor(
    writer: HistoryFileWriter,
    private readonly deps: ChatHistoryFileSubsystemDeps,
  ) {
    this.writer = writer;
    this.port = {
      scheduleWrite: id => writer.scheduleWrite(id),
      hasFile: id => writer.getFile(id) !== null,
      openFileAsMarkdown: async () => false,
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

    return new ChatHistoryFileSubsystem(writer, deps);
  }

  register(_registerEvent: (eventRef: EventRef) => void): void {
    // Vault create/modify listeners for import land with restore-from-file.
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
  }
}
