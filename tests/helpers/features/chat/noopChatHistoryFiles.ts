import type { ChatHistoryFilePort } from '@/features/chat/ChatFeatureHost';

/** No-op port for hosts and tests that do not project chat history files. */
export const NOOP_CHAT_HISTORY_FILES: ChatHistoryFilePort = {
  scheduleWrite() {},
  hasFile() { return false; },
  async openFileAsMarkdown() { return false; },
  async trashForConversation() {},
  startBackfill() {},
  cancelBackfill() {},
};
