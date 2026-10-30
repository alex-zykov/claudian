import type { ChatFeatureHostDomains } from '@/composition/ClaudianFeatureHosts';
import { ClaudianChatFeatureHost } from '@/composition/ClaudianFeatureHosts';

describe('ClaudianChatFeatureHost renameConversation', () => {
  it('refreshes the chat history file after the title changes', async () => {
    const order: string[] = [];
    const conversations = {
      renameConversation: jest.fn(async () => { order.push('rename'); }),
    };
    const chatHistoryFiles = {
      scheduleWrite: jest.fn(() => { order.push('write'); }),
    };
    const host = new ClaudianChatFeatureHost({
      conversations,
      chatHistoryFiles,
    } as unknown as ChatFeatureHostDomains);

    await host.renameConversation('conv-1', 'Generated title');

    expect(conversations.renameConversation).toHaveBeenCalledWith('conv-1', 'Generated title');
    expect(chatHistoryFiles.scheduleWrite).toHaveBeenCalledWith('conv-1');
    expect(order).toEqual(['rename', 'write']);
  });
});
