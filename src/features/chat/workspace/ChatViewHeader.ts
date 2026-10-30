/** Where a chat leaf sits in the workspace. */
export type ChatViewSide = 'left' | 'right' | 'main';

/** The folders of a vault-relative folder path; the vault root has none. */
export function folderSegments(folder: string): string[] {
  return folder.split('/').filter(segment => segment.length > 0);
}

/**
 * Fills the view header's breadcrumb slot the way Obsidian does for a note: one crumb per
 * folder, each followed by a separator. The vault root leaves the slot empty (Obsidian hides
 * an empty slot). Clicking a crumb reports the folder path up to and including it.
 */
export function renderFolderBreadcrumbs(
  parentEl: HTMLElement,
  folder: string,
  onSelect: (folderPath: string) => void,
): void {
  parentEl.empty();
  const segments = folderSegments(folder);
  segments.forEach((segment, index) => {
    const crumb = parentEl.createSpan({ cls: 'view-header-breadcrumb', text: segment });
    crumb.addEventListener('click', () => onSelect(segments.slice(0, index + 1).join('/')));
    parentEl.createSpan({ cls: 'view-header-breadcrumb-separator', text: '/' });
  });
}

/** Whether a leaf lives in the left sidebar, the right sidebar, or the main area. */
export function resolveViewSide(
  leaf: { getRoot(): unknown },
  workspace: { readonly leftSplit: unknown; readonly rightSplit: unknown },
): ChatViewSide {
  const root = leaf.getRoot();
  if (root === workspace.leftSplit) return 'left';
  if (root === workspace.rightSplit) return 'right';
  return 'main';
}

export interface ChatViewHeaderDeps {
  /** Obsidian's breadcrumb slot of the view header; absent when the app does not expose it. */
  readonly titleParentEl?: HTMLElement;
  /** Obsidian's title slot of the view header; absent when the app does not expose it. */
  readonly titleEl?: HTMLElement;
  addAction(icon: string, title: string, onClick: () => void): HTMLElement;
  readonly labels: {
    readonly moveToLeft: string;
    readonly moveToRight: string;
    readonly editNote: string;
  };
  getFolder(): string;
  getTitle(): string;
  getSide(): ChatViewSide;
  revealFolder(folderPath: string): void;
  /** Moves the chat into a sidebar; false when it was refused. */
  moveToSide(side: 'left' | 'right'): Promise<boolean>;
  onMoveRefused(): void;
  /** Whether the active chat has a `.chat.md` file to edit. */
  hasChatFile(): boolean;
  /** Opens the chat file as a note in a new tab; false when it could not be opened. */
  openChatFile(): Promise<boolean>;
  onEditRefused(): void;
}

/**
 * The chat view's own header, laid out like a note's: breadcrumbs of the project folder and the
 * chat title in the middle, and buttons that move the chat into a sidebar on the right.
 */
export class ChatViewHeader {
  readonly #deps: ChatViewHeaderDeps;
  readonly #actions: Record<'left' | 'right' | 'edit', HTMLElement>;

  constructor(deps: ChatViewHeaderDeps) {
    this.#deps = deps;
    // Obsidian puts each new action to the left of the previous ones, so they go in right to left.
    const right = deps.addAction('panel-right', deps.labels.moveToRight, () => this.#move('right'));
    const edit = deps.addAction('file-pen', deps.labels.editNote, () => this.#editNote());
    const left = deps.addAction('panel-left', deps.labels.moveToLeft, () => this.#move('left'));
    this.#actions = { left, edit, right };
  }

  /** Redraws everything the header derives from the chat. */
  refresh(): void {
    const { titleParentEl, titleEl } = this.#deps;
    if (titleParentEl) {
      renderFolderBreadcrumbs(titleParentEl, this.#deps.getFolder(), path => this.#deps.revealFolder(path));
    }
    titleEl?.setText(this.#deps.getTitle());
    const side = this.#deps.getSide();
    this.#actions.left.toggleClass('claudian-hidden', side === 'left');
    this.#actions.right.toggleClass('claudian-hidden', side === 'right');
    this.#actions.edit.toggleClass('claudian-hidden', !this.#deps.hasChatFile());
  }

  #editNote(): void {
    void this.#deps.openChatFile().then((opened) => {
      if (!opened) this.#deps.onEditRefused();
    });
  }

  #move(side: 'left' | 'right'): void {
    void this.#deps.moveToSide(side).then((moved) => {
      if (!moved) this.#deps.onMoveRefused();
    });
  }
}

/** Shows a folder in the file explorer, as a click on a note's breadcrumb does. Quiet if unavailable. */
export function revealFolderInExplorer(
  app: {
    readonly vault: { getFolderByPath(path: string): unknown };
    readonly internalPlugins?: {
      getEnabledPluginById?(id: string): { revealInFolder?(folder: unknown): void } | null | undefined;
    };
  },
  folderPath: string,
): void {
  const explorer = app.internalPlugins?.getEnabledPluginById?.('file-explorer');
  const folder = app.vault.getFolderByPath(folderPath);
  if (explorer?.revealInFolder && folder) explorer.revealInFolder(folder);
}
