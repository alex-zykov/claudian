import type { App } from 'obsidian';

import type { ConversationService } from '@/app/conversations/ConversationService';
import type { SharedStorageService } from '@/app/storage/SharedStorageService';
import { ChatHistoryFileSubsystem } from '@/composition/ChatHistoryFileSubsystem';
import type { ClaudianViews } from '@/composition/ClaudianViews';
import type { ClaudianSettings } from '@/core/types';

describe('ChatHistoryFileSubsystem', () => {
  it('isolates trash failures so tab reset still runs', async () => {
    const reportError = jest.fn();
    const resetTabs = jest.fn(async () => undefined);
    const subsystem = ChatHistoryFileSubsystem.create({
      app: {} as App,
      storage: {
        getAdapter: () => ({
          listFolders: async () => [],
          exists: async () => false,
        }),
      } as unknown as SharedStorageService,
      conversations: {
        getCachedConversation: () => null,
        getConversationSync: () => null,
        getConversationById: async () => null,
        getConversationList: () => [],
      } as unknown as ConversationService,
      views: {} as ClaudianViews,
      isWriteHistoryFileEnabled: () => false,
      isWriteHistoryFileTextEnabled: () => true,
      getChatFileCustomFields: () => [],
      reportError,
    });

    const failure = new Error('trash failed');
    jest.spyOn(subsystem.writer, 'trashForConversation').mockRejectedValue(failure);

    await subsystem.onConversationDeleted('c1', resetTabs);

    expect(reportError).toHaveBeenCalledWith(failure);
    expect(resetTabs).toHaveBeenCalledTimes(1);
    subsystem.dispose();
  });

  it('starts and cancels backfill from settings commits', () => {
    const subsystem = ChatHistoryFileSubsystem.create({
      app: {} as App,
      storage: {
        getAdapter: () => ({
          listFolders: async () => [],
          exists: async () => false,
        }),
      } as unknown as SharedStorageService,
      conversations: {
        getCachedConversation: () => null,
        getConversationSync: () => null,
        getConversationById: async () => null,
        getConversationList: () => [],
      } as unknown as ConversationService,
      views: {} as ClaudianViews,
      isWriteHistoryFileEnabled: () => false,
      isWriteHistoryFileTextEnabled: () => true,
      getChatFileCustomFields: () => [],
      reportError: () => undefined,
    });

    const start = jest.spyOn(subsystem.writer, 'startBackfill').mockImplementation(() => undefined);
    const cancel = jest.spyOn(subsystem.writer, 'cancelBackfill').mockImplementation(() => undefined);

    const base = { writeHistoryFile: false, writeHistoryFileText: true } as ClaudianSettings;
    subsystem.onSettingsCommitted({ ...base, writeHistoryFile: true }, base);
    expect(start).toHaveBeenCalledTimes(1);

    subsystem.onSettingsCommitted(
      { ...base, writeHistoryFile: true, writeHistoryFileText: true },
      { ...base, writeHistoryFile: true, writeHistoryFileText: false },
    );
    expect(start).toHaveBeenCalledTimes(2);

    subsystem.onSettingsCommitted({ ...base, writeHistoryFile: false }, { ...base, writeHistoryFile: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    subsystem.dispose();
  });
});
