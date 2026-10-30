import { CursorConversationHistoryService } from '@/providers/cursor/history/CursorConversationHistoryService';

describe('CursorConversationHistoryService', () => {
  const service = new CursorConversationHistoryService();

  it('keeps existing messages and refreshes small provider state', async () => {
    const result = await service.hydrateConversationHistory(
      {
        sessionId: 'ses_cursor_example_001',
        messages: [
          { id: 'u1', role: 'user', content: 'Say hello', timestamp: 1 },
          { id: 'a1', role: 'assistant', content: 'Hello from Cursor.', timestamp: 2 },
        ],
        providerState: { cwd: '/vault' },
      },
      '/vault',
      { environment: { HOME: '/home/user' }, vaultPath: '/vault' },
    );

    expect(result.messages).toHaveLength(2);
    expect(result.providerState).toMatchObject({
      cwd: '/vault',
      nativeConversationContextEstablished: true,
    });
  });

  it('does not treat conversations as pending forks', () => {
    expect(service.isPendingForkConversation({
      sessionId: 'ses_1',
      messages: [],
      providerState: {},
    })).toBe(false);
  });

  it('buildForkProviderState keeps only cwd hints because native fork is absent', () => {
    expect(service.buildForkProviderState('ses_1', 'msg_1', { cwd: '/vault', extra: 1 }))
      .toEqual({ cwd: '/vault' });
  });
});
