import type { ProviderHost } from '../core/providers/ProviderHost';
import { ProviderRegistry } from '../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderId,
  ProviderSubscriptionUsageService,
  ProviderSubscriptionUsageSnapshot,
} from '../core/providers/types';
import { t } from '../i18n/i18n';
import type { TranslationKey } from '../i18n/types';
import { createProviderIconSvg } from '../shared/icons';

const DEFAULT_POLL_INTERVAL_MS = 5 * 60_000;

export interface ClaudianStatusBarUsageOptions {
  readonly addStatusBarItem: () => HTMLElement;
  readonly providerHost: ProviderHost;
  readonly getSettings: () => Record<string, unknown>;
  readonly pollIntervalMs?: number;
}

interface ProviderSubscriptionEntry {
  readonly service: ProviderSubscriptionUsageService;
  readonly unsubscribe: () => void;
}

function formatResetSuffix(resetsAt: string | null | undefined): string | null {
  if (!resetsAt) return null;
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return t('statusBar.usage.resetsAt', { time: formatted });
}

export class ClaudianStatusBarUsage {
  private readonly statusBarEl: HTMLElement;
  private readonly subscriptions = new Map<ProviderId, ProviderSubscriptionEntry>();
  private readonly initializing = new Set<ProviderId>();
  private pollTimer: number | null = null;
  private disposed = false;

  constructor(private readonly options: ClaudianStatusBarUsageOptions) {
    this.statusBarEl = options.addStatusBarItem();
    this.statusBarEl.classList.add('claudian-status-bar-usage', 'claudian-hidden');
  }

  syncWithSettings(): void {
    if (this.disposed) return;
    const enabledProviderIds = this.#getEnabledProviderIds();

    for (const [providerId, entry] of this.subscriptions.entries()) {
      if (!enabledProviderIds.includes(providerId)) {
        entry.unsubscribe();
        this.subscriptions.delete(providerId);
      }
    }

    if (enabledProviderIds.length === 0) {
      this.#stopPolling();
      this.statusBarEl.empty();
      this.statusBarEl.classList.add('claudian-hidden');
      return;
    }

    this.#ensurePolling();
    this.#render(enabledProviderIds);

    for (const providerId of enabledProviderIds) {
      void this.#ensureProviderSubscribed(providerId);
    }
  }

  refreshEnabled(): void {
    if (this.disposed) return;
    for (const { service } of this.subscriptions.values()) {
      void service.refresh().catch(() => undefined);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.#stopPolling();
    for (const entry of this.subscriptions.values()) {
      entry.unsubscribe();
    }
    this.subscriptions.clear();
    this.initializing.clear();
    this.statusBarEl.empty();
    this.statusBarEl.classList.add('claudian-hidden');
  }

  #getEnabledProviderIds(): ProviderId[] {
    const settings = this.options.getSettings();
    return ProviderWorkspaceRegistry.getSubscriptionUsageProviderIds().filter(providerId =>
      ProviderWorkspaceRegistry.isSubscriptionUsageEnabled(providerId, settings),
    );
  }

  async #ensureProviderSubscribed(providerId: ProviderId): Promise<void> {
    const existing = this.subscriptions.get(providerId);
    if (existing) {
      if (existing.service.getSnapshot().status === 'idle') {
        void existing.service.refresh().catch(() => undefined);
      }
      return;
    }
    if (this.initializing.has(providerId)) {
      return;
    }

    this.initializing.add(providerId);
    try {
      await ProviderWorkspaceRegistry.ensureInitialized(
        this.options.providerHost,
        providerId,
        'status-bar-usage',
      );
      if (this.disposed) return;
      const enabledProviderIds = this.#getEnabledProviderIds();
      if (!enabledProviderIds.includes(providerId)) return;

      const service = ProviderWorkspaceRegistry.getSubscriptionUsage(providerId);
      if (!service) return;

      if (!this.subscriptions.has(providerId)) {
        const unsubscribe = service.subscribe(() => {
          if (!this.disposed) {
            this.#render(this.#getEnabledProviderIds());
          }
        });
        this.subscriptions.set(providerId, { service, unsubscribe });
      }

      this.#render(this.#getEnabledProviderIds());
      if (service.getSnapshot().status === 'idle') {
        void service.refresh().catch(() => undefined);
      }
    } catch {
      // Best-effort status bar initialization.
    } finally {
      this.initializing.delete(providerId);
    }
  }

  #ensurePolling(): void {
    if (this.pollTimer !== null) return;
    const interval = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollTimer = window.setInterval(() => {
      this.refreshEnabled();
    }, interval);
  }

  #stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  #render(enabledProviderIds: readonly ProviderId[]): void {
    this.statusBarEl.empty();
    if (enabledProviderIds.length === 0) {
      this.statusBarEl.classList.add('claudian-hidden');
      return;
    }
    this.statusBarEl.classList.remove('claudian-hidden');

    enabledProviderIds.forEach((providerId, index) => {
      if (index > 0) {
        this.statusBarEl.createSpan({
          cls: 'claudian-status-bar-usage-divider',
          text: '|',
          attr: { 'aria-hidden': 'true' },
        });
      }

      const snapshot = ProviderWorkspaceRegistry.getSubscriptionUsage(providerId)?.getSnapshot() ?? {
        status: 'loading',
        windows: [],
      };

      const button = this.statusBarEl.createEl('button', {
        cls: 'claudian-status-bar-usage-item',
        attr: {
          type: 'button',
          'data-provider': providerId,
          'data-tooltip-position': 'top',
          'aria-label': this.#buildTooltip(providerId, snapshot),
        },
      });

      const icon = ProviderRegistry.getChatUIConfig(providerId)?.getProviderIcon?.();
      if (icon) {
        const iconSpan = button.createSpan({
          cls: 'claudian-status-bar-usage-icon',
          attr: { 'aria-hidden': 'true' },
        });
        createProviderIconSvg(icon, {
          parent: iconSpan,
          width: 12,
          height: 12,
          dataProvider: providerId,
        });
      }

      if (snapshot.windows.length === 2) {
        for (const window of snapshot.windows) {
          this.#appendDot(button);
          button.createSpan({
            cls: 'claudian-status-bar-usage-value',
            text: `${window.percentUsed}%`,
          });
        }
      } else {
        this.#appendDot(button);
        button.createSpan({
          cls: 'claudian-status-bar-usage-value',
          text: snapshot.status === 'loading' || snapshot.status === 'idle' ? '…' : '—',
        });
      }

      button.addEventListener('click', () => {
        const service = ProviderWorkspaceRegistry.getSubscriptionUsage(providerId);
        void service?.refresh().catch(() => undefined);
      });
    });
  }

  #appendDot(parent: HTMLElement): void {
    parent.createSpan({
      cls: 'claudian-status-bar-usage-dot',
      text: '·',
      attr: { 'aria-hidden': 'true' },
    });
  }

  #buildTooltip(providerId: ProviderId, snapshot: ProviderSubscriptionUsageSnapshot): string {
    const displayName = ProviderRegistry.getProviderDisplayName(providerId);
    if (snapshot.windows.length === 2) {
      const lines = snapshot.windows.map((window) => {
        const label = t(window.labelKey as TranslationKey);
        const reset = formatResetSuffix(window.resetsAt);
        return `${window.percentUsed}% — ${label}${reset ? ` (${reset})` : ''}`;
      });
      return [displayName, ...lines, t('statusBar.usage.clickToRefresh')].join('\n');
    }
    if (snapshot.status === 'loading' || snapshot.status === 'idle') {
      return `${displayName} — ${t('statusBar.usage.loading')}`;
    }
    return `${displayName} — ${t('statusBar.usage.unavailable')}`;
  }
}
