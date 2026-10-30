import type { Command, Workspace } from 'obsidian';

import type { ChatViewHost } from '@/features/chat/ChatFeatureHost';
import { createChatTabCommands } from '@/features/chat/workspace/ChatTabCommands';

function setup() {
  const view = {
    getTabManager: () => ({}),
    handleNewConversationCommand: jest.fn(async () => false),
    createNewTab: jest.fn(async () => null),
  } as unknown as ChatViewHost;
  const openNewTab = jest.fn(async () => undefined);
  const commands = createChatTabCommands({
    workspace: { getLeavesOfType: () => [] } as unknown as Pick<Workspace, 'getLeavesOfType'>,
    views: { getView: () => view },
    openNewTab,
  });
  const newTab = commands.find(command => command.id === 'new-tab') as Required<Pick<Command, 'callback'>>;
  return { newTab, view, openNewTab };
}

describe('createChatTabCommands new chat', () => {
  it('opens a new Claudian tab where the default placement says, not a tab inside the last chat', async () => {
    const { newTab, view, openNewTab } = setup();

    await newTab.callback();

    expect(openNewTab).toHaveBeenCalledTimes(1);
    expect(view.createNewTab).not.toHaveBeenCalled();
    expect(view.handleNewConversationCommand).not.toHaveBeenCalled();
  });

  it('is named for what it does', () => {
    const { newTab } = setup();

    expect((newTab as Command).name).toBe('New Claudian tab');
  });
});
