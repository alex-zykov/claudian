import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import { TFile as ObsidianTFile, WorkspaceLeaf as ObsidianWorkspaceLeaf } from 'obsidian';

import type { ChatFileOpenMode } from '@/core/types';
import { readChatFileId } from '@/features/chat/history-file/HistoryFileWriter';

export interface ChatFileOpenHandlerDeps {
  readonly app: App;
  getMode(): ChatFileOpenMode;
  hasConversation(id: string): boolean;
  /** Shows a conversation that is already open in a chat view; false when no view has it. */
  revealOpenConversation(id: string): Promise<boolean>;
  /** Opens a conversation in the chat view placed by the view-placement setting. */
  openConversationInClaudian(id: string): Promise<void>;
}

type SetViewState = WorkspaceLeaf['setViewState'];

interface PatchedLeafPrototype {
  setViewState: SetViewState;
}

/**
 * Opens `claudian-chat` markdown as its conversation unless the chat-file open mode is
 * `markdown`. The chat opens like any other, where the view-placement setting puts it; a
 * conversation that is already open in a chat view is revealed there instead of duplicated.
 */
export class ChatFileOpenHandler {
  readonly #deps: ChatFileOpenHandlerDeps;
  #originalSetViewState: SetViewState | null = null;
  #patchedProto: PatchedLeafPrototype | null = null;
  #disposed = false;

  constructor(deps: ChatFileOpenHandlerDeps) {
    this.#deps = deps;
  }

  install(): void {
    if (this.#originalSetViewState || this.#disposed) return;
    const proto = ObsidianWorkspaceLeaf.prototype as unknown as PatchedLeafPrototype | null;
    if (!proto || typeof proto.setViewState !== 'function') return;

    // Keep the unbound method so call(this) uses the WorkspaceLeaf instance.
    const original = proto.setViewState;
    // Prototype patch: Obsidian has no file-open intercept for markdown→chat routing.
    /* eslint-disable @typescript-eslint/no-this-alias -- leaf.prototype patch */
    const handler = this;
    this.#originalSetViewState = original;
    this.#patchedProto = proto;
    proto.setViewState = async function patchedSetViewState(
      this: WorkspaceLeaf,
      state: Parameters<SetViewState>[0],
      ...rest: []
    ) {
      if (handler.#disposed) return original.call(this, state, ...rest);
      const outcome = await handler.#tryRouteChatFile(this, state, original);
      if (outcome === 'close-file-leaf') {
        this.detach();
        return;
      }
      if (outcome === 'handled') return;
      return original.call(this, state, ...rest);
    };
    /* eslint-enable @typescript-eslint/no-this-alias -- end leaf.prototype patch */
  }

  uninstall(): void {
    this.#disposed = true;
    const original = this.#originalSetViewState;
    const proto = this.#patchedProto;
    this.#originalSetViewState = null;
    this.#patchedProto = null;
    if (original && proto) proto.setViewState = original;
  }

  async #tryRouteChatFile(
    leaf: WorkspaceLeaf,
    state: Parameters<SetViewState>[0],
    setViewState: SetViewState,
  ): Promise<'passthrough' | 'handled' | 'close-file-leaf'> {
    if (!state || typeof state !== 'object') return 'passthrough';
    const mode = this.#deps.getMode();
    const record = state as { type?: string; state?: { file?: string } };
    if (record.type !== 'markdown' || mode === 'markdown') return 'passthrough';
    const path = record.state?.file;
    if (typeof path !== 'string' || path.length === 0) return 'passthrough';
    const file = this.#deps.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof ObsidianTFile) || !this.#isChatFile(file)) return 'passthrough';

    const id = readChatFileId(
      this.#deps.app.metadataCache?.getFileCache?.(file)?.frontmatter,
    );
    // An unknown chat keeps the markdown view so the file stays reachable.
    if (!id || !this.#deps.hasConversation(id)) return 'passthrough';

    try {
      if (!(await this.#deps.revealOpenConversation(id))) {
        await this.#deps.openConversationInClaudian(id);
      }
      return 'close-file-leaf';
    } catch {
      // The chat could not be opened; put the file back so it stays reachable.
      await setViewState.call(leaf, state);
      return 'handled';
    }
  }

  #isChatFile(file: TFile): boolean {
    if (file.extension.toLocaleLowerCase() !== 'md') return false;
    return this.#deps.app.metadataCache?.getFileCache?.(file)?.frontmatter?.['claudian-chat'] === true;
  }
}
