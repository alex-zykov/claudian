import type { App } from 'obsidian';

import type { ConversationService } from '@/app/conversations/ConversationService';
import type { SharedStorageService } from '@/app/storage/SharedStorageService';
import { ChatHistoryFileSubsystem } from '@/composition/ChatHistoryFileSubsystem';
import type { ClaudianViews } from '@/composition/ClaudianViews';
import type { ClaudianSettings } from '@/core/types';

describe('ChatHistoryFileSubsystem', () => {
  it('isolates trash failures so tab reset still runs', async () => {
    const resetTabs = jest.fn(async () => undefined);
    const reportError = jest.fn();
    const app = {
      vault: { getMarkdownFiles: () => [] },
      metadataCache: { getFileCache: () => null },
      workspace: {},
    } as unknown as App;
    const storage = {
      getAdapter: () => ({
        exists: async () => false,
        listFolders: async () => [],
      }),
    } as unknown as SharedStorageService;
    const conversations = {
      getCachedConversation: () => null,
      getConversationSync: () => null,
      getConversationById: async () => null,
      getConversationList: () => [],
      wasDeletedInSession: () => false,
      hasLiveConversation: () => false,
      importFromHistoryFile: async () => null,
    } as unknown as ConversationService;
    const views = {
      focusConversation: async () => false,
      openConversationInNewTab: async () => undefined,
    } as unknown as ClaudianViews;

    const subsystem = ChatHistoryFileSubsystem.create({
      app,
      storage,
      conversations,
      views,
      isWriteHistoryFileEnabled: () => true,
      getChatFileCustomFields: () => [],
      isWriteHistoryFileTextEnabled: () => true,
      reportError,
    });
    const failure = new Error('trash failed');
    jest.spyOn(subsystem.writer, 'trashForConversation').mockRejectedValue(failure);

    await subsystem.onConversationDeleted('conv-1', resetTabs);
    expect(resetTabs).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(failure);
    subsystem.dispose();
  });

  it('starts and cancels backfill from settings commits', () => {
    const reportError = jest.fn();
    const app = {
      vault: { getMarkdownFiles: () => [] },
      metadataCache: { getFileCache: () => null },
      workspace: {},
    } as unknown as App;
    const storage = {
      getAdapter: () => ({
        exists: async () => false,
        listFolders: async () => [],
      }),
    } as unknown as SharedStorageService;
    const conversations = {
      getCachedConversation: () => null,
      getConversationSync: () => null,
      getConversationById: async () => null,
      getConversationList: () => [],
      wasDeletedInSession: () => false,
      hasLiveConversation: () => false,
      importFromHistoryFile: async () => null,
    } as unknown as ConversationService;
    const views = {
      focusConversation: async () => false,
      openConversationInNewTab: async () => undefined,
    } as unknown as ClaudianViews;

    const subsystem = ChatHistoryFileSubsystem.create({
      app,
      storage,
      conversations,
      views,
      isWriteHistoryFileEnabled: () => true,
      getChatFileCustomFields: () => [],
      isWriteHistoryFileTextEnabled: () => true,
      reportError,
    });
    const start = jest.spyOn(subsystem.writer, 'startBackfill').mockImplementation(() => undefined);
    const cancel = jest.spyOn(subsystem.writer, 'cancelBackfill').mockImplementation(() => undefined);

    const off = { writeHistoryFile: false } as ClaudianSettings;
    const on = { writeHistoryFile: true } as ClaudianSettings;
    subsystem.onSettingsCommitted(on, off);
    expect(start).toHaveBeenCalledTimes(1);
    subsystem.onSettingsCommitted(off, on);
    expect(cancel).toHaveBeenCalledTimes(1);

    // Turning the conversation text on refreshes files whose body was left behind.
    start.mockClear();
    const textOff = { writeHistoryFile: true, writeHistoryFileText: false } as ClaudianSettings;
    const textOn = { writeHistoryFile: true, writeHistoryFileText: true } as ClaudianSettings;
    subsystem.onSettingsCommitted(textOn, textOff);
    expect(start).toHaveBeenCalledTimes(1);
    subsystem.onSettingsCommitted(textOff, textOn);
    expect(start).toHaveBeenCalledTimes(1);
    subsystem.onSettingsCommitted(
      { writeHistoryFile: false, writeHistoryFileText: true } as ClaudianSettings,
      { writeHistoryFile: false, writeHistoryFileText: false } as ClaudianSettings,
    );
    expect(start).toHaveBeenCalledTimes(1);
    subsystem.dispose();
  });
});
