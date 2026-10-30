import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import { TFile as ObsidianTFile, WorkspaceLeaf as ObsidianWorkspaceLeaf } from 'obsidian';

import { readChatFileId } from '@/features/chat/history-file/HistoryFileWriter';

export interface ChatFileOpenHandlerDeps {
  readonly app: App;
  hasConversation(id: string): boolean;
  /**
   * Focuses a conversation that is already open in a chat view, in whichever tab of it, and
   * returns true; returns false when no view has it.
   */
  revealOpenConversation(id: string): Promise<boolean>;
  /** Opens a conversation in a new leaf where the default placement says. */
  openConversationInNewTab(id: string): Promise<void>;
}

type SetViewState = WorkspaceLeaf['setViewState'];

interface PatchedLeafPrototype {
  setViewState: SetViewState;
}

/**
 * Opens `claudian-chat` markdown as its conversation. A conversation that is already open is
 * focused where it is; otherwise it opens in a new leaf where the default placement says. The
 * tab the click was aimed at is never turned into the chat: a note there stays, and the blank
 * tab Obsidian makes for a new file is dropped.
 */
export class ChatFileOpenHandler {
  readonly #deps: ChatFileOpenHandlerDeps;
  #originalSetViewState: SetViewState | null = null;
  #patchedProto: PatchedLeafPrototype | null = null;
  #disposed = false;
  readonly #openingAsMarkdown = new Set<string>();

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

  /** Opens a chat file as a plain note in a new tab, without routing it to its conversation. */
  async openAsMarkdown(file: TFile): Promise<void> {
    this.#openingAsMarkdown.add(file.path);
    try {
      await this.#deps.app.workspace.getLeaf('tab').openFile(file);
    } finally {
      this.#openingAsMarkdown.delete(file.path);
    }
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
    const record = state as { type?: string; state?: { file?: string } };
    if (record.type !== 'markdown') return 'passthrough';
    const path = record.state?.file;
    if (typeof path !== 'string' || path.length === 0) return 'passthrough';
    if (this.#openingAsMarkdown.has(path)) return 'passthrough';
    const file = this.#deps.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof ObsidianTFile) || !this.#isChatFile(file)) return 'passthrough';

    const id = readChatFileId(
      this.#deps.app.metadataCache?.getFileCache?.(file)?.frontmatter,
    );
    // An unknown chat keeps the markdown view so the file stays reachable.
    if (!id || !this.#deps.hasConversation(id)) return 'passthrough';

    try {
      if (!(await this.#deps.revealOpenConversation(id))) {
        await this.#deps.openConversationInNewTab(id);
      }
      // A leaf that already shows something keeps it; only the blank tab made for the click goes.
      return leaf.view?.getViewType?.() === 'empty' || !leaf.view ? 'close-file-leaf' : 'handled';
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
