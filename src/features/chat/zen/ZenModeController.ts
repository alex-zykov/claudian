import type { App, Command, EventRef, WorkspaceLeaf } from 'obsidian';
import { Platform } from 'obsidian';

import { VIEW_TYPE_CLAUDIAN, type ZenModePosition } from '@/core/types';
import { scheduleAnimationFrame } from '@/features/chat/utils/animationFrame';
import type { ZenModeSource, ZenPresentationPort, ZenScrollSnapshot } from '@/features/chat/zen/types';
import { ZenModePanel } from '@/features/chat/zen/ZenModePanel';

/** The view state key that records a chat the user sent to the floating window. */
export const ZEN_VIEW_STATE_KEY = 'claudianZen';
/** The view state key that records which tab of that view floats. */
export const ZEN_TAB_STATE_KEY = 'claudianZenTab';

export interface ZenModeControllerDeps {
  readonly app: App;
  /** Reads where the panel was left; null keeps it docked. */
  getPosition(): ZenModePosition | null;
  /** Remembers where the user moved the panel. */
  savePosition(position: ZenModePosition | null): void;
}

interface ZenAttachment {
  readonly source: ZenModeSource;
  readonly panel: ZenModePanel;
  readonly release: () => void;
}

/**
 * Locates Obsidian's central workspace split. Its element is not in the public
 * typings, so this is the single guarded host lookup; unsupported markup skips zen.
 */
function findCentralWorkspaceHost(app: App): HTMLElement | null {
  const containerEl = (app.workspace as { containerEl?: HTMLElement }).containerEl;
  return containerEl?.querySelector<HTMLElement>(':scope > .workspace-split.mod-root') ?? null;
}

/**
 * Single workspace owner for zen mode: hosts the live presentation of the one chat the user
 * sent to the floating window last. A chat asks for it (`isZenRequested`) and the leaf stays
 * wherever it is, so zen no longer depends on a sidebar. When several chats ask, the latest
 * request wins and the others are sent back to their tabs. It never creates or reveals views
 * to supply itself; it only loads a requesting chat that Obsidian deferred.
 */
export class ZenModeController {
  readonly #sources = new Map<ZenModeSource, () => void>();
  readonly #historyExpanded = new WeakMap<ZenModeSource, boolean>();
  readonly #loadRequested = new WeakSet<WorkspaceLeaf>();
  /** When each source's current request was first seen; the latest one wins. */
  readonly #requestOrder = new Map<ZenModeSource, number>();
  #requestCounter = 0;
  #eventRefs: EventRef[] = [];
  #attachment: ZenAttachment | null = null;
  #listening = false;
  #reconciling = false;
  #reconcileAgain = false;
  #disposed = false;

  constructor(private readonly deps: ZenModeControllerDeps) {}

  getActiveLeaf(): WorkspaceLeaf | null {
    return this.#attachment?.source.leaf ?? null;
  }

  createToggleHistoryCommand(): Command {
    return {
      id: 'toggle-zen-mode-history',
      name: 'Toggle zen mode history',
      checkCallback: (checking: boolean) => {
        const panel = this.#attachment?.panel;
        if (!panel?.runtime?.state.messages.length) return false;
        if (!checking) panel.toggleHistoryExpanded();
        return true;
      },
    };
  }

  start(): void {
    if (this.#listening || this.#disposed) return;
    const { workspace } = this.deps.app;
    workspace.onLayoutReady(() => {
      if (this.#listening || this.#disposed) return;
      this.#listening = true;
      // Leaf changes bring requesting chats in; resize and theme changes move the panel's clearance.
      this.#eventRefs.push(
        workspace.on('resize', () => this.reconcile()),
        workspace.on('layout-change', () => this.reconcile()),
        workspace.on('css-change', () => this.reconcile()),
      );
      this.reconcile();
    });
  }

  register(source: ZenModeSource): () => void {
    if (this.#disposed || this.#sources.has(source)) return () => undefined;
    this.#sources.set(source, source.onZenPresentationChanged(() => this.reconcile()));
    this.reconcile();
    return () => this.#unregister(source);
  }

  reconcile(): void {
    if (this.#disposed) return;
    // Moving nodes can publish presentation changes; finish one pass before the next.
    if (this.#reconciling) {
      this.#reconcileAgain = true;
      return;
    }
    this.#reconciling = true;
    try {
      do {
        this.#reconcileAgain = false;
        this.#reconcileOnce();
      } while (this.#reconcileAgain && !this.#disposed);
    } finally {
      this.#reconciling = false;
    }
  }

  #reconcileOnce(): void {
    const target = this.#selectSource();
    const attachment = this.#attachment;
    if (attachment && attachment.source === target) {
      // The source already placed a replaced runtime; only the bound state changes.
      attachment.panel.bind(target.getZenPresentation(), target.getZenProviderId());
      return;
    }
    this.#detach();
    if (target) this.#attach(target);
    else this.#loadDeferredSource();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#detach();
    this.#disposed = true;
    for (const ref of this.#eventRefs) this.deps.app.workspace.offref(ref);
    this.#eventRefs = [];
    for (const unsubscribe of this.#sources.values()) unsubscribe();
    this.#sources.clear();
    this.#requestOrder.clear();
  }

  #unregister(source: ZenModeSource): void {
    const unsubscribe = this.#sources.get(source);
    if (!unsubscribe) return;
    this.#sources.delete(source);
    this.#requestOrder.delete(source);
    unsubscribe();
    if (this.#attachment?.source === source) this.#detach();
    this.reconcile();
  }

  #canPresent(): boolean {
    return this.#listening && !Platform.isMobile;
  }

  /**
   * The chat that asked for the floating window last, once it is ready. The chats that asked
   * earlier are sent back to their tabs, so exactly one chat floats.
   */
  #selectSource(): ZenModeSource | null {
    if (!this.#canPresent()) return null;
    for (const source of this.#sources.keys()) {
      if (!source.isZenRequested()) this.#requestOrder.delete(source);
      else if (!this.#requestOrder.has(source)) this.#requestOrder.set(source, ++this.#requestCounter);
    }
    const requesting = [...this.#requestOrder.entries()].sort((a, b) => b[1] - a[1]).map(([source]) => source);
    const [winner, ...others] = requesting;
    for (const source of others) source.leaveZen();
    if (!winner || !winner.getZenPresentation()) return null;
    return winner;
  }

  /**
   * Obsidian defers leaves it has not shown yet, so a requesting chat may not have opened to
   * register here. Loading one lets it restore normally and present once ready; a registered
   * requesting view is already on its way.
   */
  #loadDeferredSource(): void {
    if (!this.#canPresent()) return;
    if ([...this.#sources.keys()].some(source => source.isZenRequested())) return;
    const leaf = this.deps.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN).find(candidate => (
      candidate.isDeferred
      && !this.#loadRequested.has(candidate)
      && candidate.getViewState().state?.[ZEN_VIEW_STATE_KEY] === true
    ));
    if (!leaf) return;
    // One attempt per leaf, so a failed load cannot repeat on every layout event.
    this.#loadRequested.add(leaf);
    void leaf.loadIfDeferred().catch(() => undefined);
  }

  #attach(source: ZenModeSource): void {
    const runtime = source.getZenPresentation();
    const hostEl = findCentralWorkspaceHost(this.deps.app);
    if (!runtime || !hostEl) return;

    const panel = new ZenModePanel(hostEl, {
      keymap: this.deps.app.keymap ?? null,
      parentScope: this.deps.app.scope,
      historyExpanded: this.#historyExpanded.get(source) ?? false,
      onHistoryExpandedChange: expanded => this.#historyExpanded.set(source, expanded),
      position: this.deps.getPosition(),
      onPositionChange: position => this.deps.savePosition(position),
      onLeave: () => source.exitZen(),
    });
    this.#attachment = { source, panel, release: source.attachZenPresentation(panel.slots) };
    panel.bind(runtime, source.getZenProviderId());
  }

  /** Restores every moved node to the source before the zen host is removed. */
  #detach(): void {
    const attachment = this.#attachment;
    if (!attachment) return;
    this.#attachment = null;
    const runtime = attachment.panel.runtime;
    const scroll = runtime ? runtime.captureScroll() : null;
    try {
      attachment.release();
    } finally {
      attachment.panel.destroy();
    }
    if (runtime && scroll) this.#restoreScroll(runtime, scroll);
  }

  #restoreScroll(runtime: ZenPresentationPort, scroll: ZenScrollSnapshot): void {
    runtime.restoreScroll(scroll);
    // A leaf that was just shown may still be hidden; reapply once it has layout.
    scheduleAnimationFrame(() => {
      if (this.#attachment?.panel.runtime === runtime) return;
      runtime.restoreScroll(scroll);
    }, runtime.window);
  }
}
