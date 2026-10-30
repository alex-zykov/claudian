import type { Command, Workspace } from 'obsidian';

import type { ChatViewHost } from '@/features/chat/ChatFeatureHost';
import { createChatTabCommands } from '@/features/chat/workspace/ChatTabCommands';

function setup() {
  const view = {
    getTabManager: () => ({}),
    handleNewConversationCommand: jest.fn(async () => false),
    createNewTab: jest.fn(async () => null),
  } as unknown as ChatViewHost;
  const commands = createChatTabCommands({
    workspace: { getLeavesOfType: () => [] } as unknown as Pick<Workspace, 'getLeavesOfType'>,
    views: { getView: () => view, activateView: jest.fn(async () => undefined) },
  });
  const newTab = commands.find(command => command.id === 'new-tab') as Required<Pick<Command, 'checkCallback'>>;
  return { newTab, view };
}

const flush = () => new Promise(resolve => window.setTimeout(resolve, 0));

describe('createChatTabCommands new chat', () => {
  it('opens the new chat as a tab inside the chat view', async () => {
    const { newTab, view } = setup();

    expect(newTab.checkCallback(false)).toBe(true);
    await flush();

    expect(view.createNewTab).toHaveBeenCalledTimes(1);
  });
});
