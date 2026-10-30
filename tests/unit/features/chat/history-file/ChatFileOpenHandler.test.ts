import type { App, WorkspaceLeaf } from 'obsidian';
import { TFile, WorkspaceLeaf as ObsidianWorkspaceLeaf } from 'obsidian';

import type { ChatFileOpenMode } from '@/core/types';
import {
  ChatFileOpenHandler,
  type ChatFileOpenHandlerDeps,
} from '@/features/chat/history-file/ChatFileOpenHandler';

function createFile(path: string): TFile {
  const file = new TFile();
  Object.assign(file, {
    path,
    name: path.split('/').pop() ?? path,
    basename: (path.split('/').pop() ?? '').replace(/\.md$/i, ''),
    extension: 'md',
  });
  return file;
}

const chatFile = createFile('Projects/A/Plan.chat.md');
const note = createFile('Projects/A/x.md');

function markdownState(file: TFile) {
  return { type: 'markdown', state: { file: file.path }, active: true };
}

function setup(mode: ChatFileOpenMode, overrides: Partial<ChatFileOpenHandlerDeps> = {}) {
  const original = jest.fn(async (..._args: unknown[]) => undefined);
  const detach = jest.fn();
  const previous = ObsidianWorkspaceLeaf.prototype.setViewState;
  ObsidianWorkspaceLeaf.prototype.setViewState = original;
  const leaf = Object.create(ObsidianWorkspaceLeaf.prototype) as WorkspaceLeaf;
  Object.assign(leaf, { detach });

  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (
        path === chatFile.path ? chatFile : path === note.path ? note : null
      ),
    },
    metadataCache: {
      getFileCache: (file: TFile) => (
        file.path === chatFile.path
          ? { frontmatter: { 'claudian-chat': true, id: 'conv-open-1' } }
          : null
      ),
    },
  } as unknown as App;
  const deps: ChatFileOpenHandlerDeps = {
    app,
    getMode: () => mode,
    hasConversation: () => true,
    revealOpenConversation: jest.fn(async () => false),
    openConversationInClaudian: jest.fn(async () => undefined),
    ...overrides,
  };
  const handler = new ChatFileOpenHandler(deps);
  handler.install();
  return {
    deps,
    detach,
    handler,
    leaf,
    original,
    restore: () => {
      handler.uninstall();
      ObsidianWorkspaceLeaf.prototype.setViewState = previous;
    },
  };
}

describe('ChatFileOpenHandler', () => {
  describe('claudian', () => {
    it('opens the conversation in the placed chat view and closes the file leaf', async () => {
      const { deps, leaf, original, detach, restore } = setup('claudian');

      await leaf.setViewState(markdownState(chatFile));

      expect(deps.openConversationInClaudian).toHaveBeenCalledWith('conv-open-1');
      expect(original).not.toHaveBeenCalled();
      expect(detach).toHaveBeenCalledTimes(1);
      restore();
    });

    it('reveals a conversation that is already open instead of opening it again', async () => {
      const { deps, leaf, original, detach, restore } = setup('claudian', {
        revealOpenConversation: jest.fn(async () => true),
      });

      await leaf.setViewState(markdownState(chatFile));

      expect(deps.revealOpenConversation).toHaveBeenCalledWith('conv-open-1');
      expect(deps.openConversationInClaudian).not.toHaveBeenCalled();
      expect(original).not.toHaveBeenCalled();
      expect(detach).toHaveBeenCalledTimes(1);
      restore();
    });

    it('keeps the markdown view when opening the conversation fails', async () => {
      const { leaf, original, detach, restore } = setup('claudian', {
        openConversationInClaudian: jest.fn(async () => { throw new Error('open failed'); }),
      });

      await leaf.setViewState(markdownState(chatFile));

      expect(original).toHaveBeenCalledTimes(1);
      expect(original).toHaveBeenCalledWith(markdownState(chatFile));
      expect(detach).not.toHaveBeenCalled();
      restore();
    });
  });

  it.each([
    ['markdown mode', 'markdown' as const, {}],
    ['an unknown conversation', 'claudian' as const, { hasConversation: (): boolean => false }],
  ])('keeps the markdown view for %s', async (_label, mode, overrides) => {
    const { deps, leaf, original, detach, restore } = setup(mode, overrides);

    await leaf.setViewState(markdownState(chatFile));

    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith(markdownState(chatFile));
    expect(deps.openConversationInClaudian).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
    restore();
  });

  describe('openAsMarkdown', () => {
    function withWorkspace() {
      const harness = setup('claudian');
      const fileLeaf = harness.leaf;
      const openFile = jest.fn(async (file: TFile) => {
        await fileLeaf.setViewState(markdownState(file));
      });
      (harness.deps.app as unknown as { workspace: unknown }).workspace = {
        getLeaf: jest.fn(() => Object.assign(fileLeaf, { openFile })),
      };
      return { ...harness, openFile };
    }

    it('opens the chat file as a note in a new tab instead of routing it to Claudian', async () => {
      const { handler, deps, original, detach, openFile, restore } = withWorkspace();

      await handler.openAsMarkdown(chatFile);

      expect(openFile).toHaveBeenCalledWith(chatFile);
      expect(original).toHaveBeenCalledWith(markdownState(chatFile));
      expect(deps.openConversationInClaudian).not.toHaveBeenCalled();
      expect(detach).not.toHaveBeenCalled();
      restore();
    });

    it('routes the chat file to Claudian again once the note is open', async () => {
      const { handler, deps, leaf, original, detach, restore } = withWorkspace();
      await handler.openAsMarkdown(chatFile);
      original.mockClear();

      await leaf.setViewState(markdownState(chatFile));

      expect(deps.openConversationInClaudian).toHaveBeenCalledWith('conv-open-1');
      expect(original).not.toHaveBeenCalled();
      expect(detach).toHaveBeenCalledTimes(1);
      restore();
    });
  });

  it('forwards ordinary setViewState with the calling leaf as this', async () => {
    const { leaf, original, restore } = setup('claudian');

    await leaf.setViewState(markdownState(note));

    expect(original).toHaveBeenCalledWith(markdownState(note));
    expect(original.mock.contexts[0]).toBe(leaf);
    restore();
  });

  it('restores the original setViewState on uninstall', () => {
    const { handler, original, restore } = setup('claudian');
    expect(ObsidianWorkspaceLeaf.prototype.setViewState).not.toBe(original);
    handler.uninstall();
    expect(ObsidianWorkspaceLeaf.prototype.setViewState).toBe(original);
    restore();
  });
});
