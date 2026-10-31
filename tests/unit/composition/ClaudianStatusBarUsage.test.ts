/** @jest-environment jsdom */
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import { ClaudianStatusBarUsage } from '@/composition/ClaudianStatusBarUsage';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderSubscriptionUsageService,
  ProviderSubscriptionUsageSnapshot,
} from '@/core/providers/types';
import { BUILT_IN_PROVIDER_MODULES } from '@/providers';

function createFakeUsageService(
  initialSnapshot: ProviderSubscriptionUsageSnapshot,
): ProviderSubscriptionUsageService & {
  emit: (snapshot: ProviderSubscriptionUsageSnapshot) => void;
  refresh: jest.Mock<Promise<ProviderSubscriptionUsageSnapshot>, []>;
} {
  let current = initialSnapshot;
  const listeners = new Set<(snapshot: ProviderSubscriptionUsageSnapshot) => void>();
  const refresh = jest.fn(async () => current);
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    emit: (snapshot) => {
      current = snapshot;
      for (const listener of listeners) {
        listener(snapshot);
      }
    },
  };
}

function decorateObsidianElement<T extends Element>(el: T): T {
  const anyEl = el as unknown as Record<string, unknown>;
  anyEl.empty = () => {
    el.replaceChildren();
  };
  anyEl.addClass = (cls: string) => {
    cls.split(/\s+/).filter(Boolean).forEach(token => el.classList.add(token));
    return el;
  };
  anyEl.removeClass = (cls: string) => {
    cls.split(/\s+/).filter(Boolean).forEach(token => el.classList.remove(token));
    return el;
  };
  anyEl.toggleClass = (cls: string, force?: boolean) => {
    el.classList.toggle(cls, force);
    return el;
  };
  anyEl.createEl = (
    tag: string,
    opts?: { cls?: string; text?: string; attr?: Record<string, string> },
  ) => {
    const child = decorateObsidianElement(document.createElement(tag));
    if (opts?.cls) {
      opts.cls.split(/\s+/).filter(Boolean).forEach(token => child.classList.add(token));
    }
    if (opts?.text !== undefined) {
      child.textContent = opts.text;
    }
    for (const [name, value] of Object.entries(opts?.attr ?? {})) {
      child.setAttribute(name, value);
    }
    el.appendChild(child);
    return child;
  };
  anyEl.createDiv = (opts?: { cls?: string; text?: string; attr?: Record<string, string> }) =>
    (anyEl.createEl as (tag: string, o?: typeof opts) => HTMLElement)('div', opts);
  anyEl.createSpan = (opts?: { cls?: string; text?: string; attr?: Record<string, string> }) =>
    (anyEl.createEl as (tag: string, o?: typeof opts) => HTMLElement)('span', opts);
  anyEl.createSvg = (tag: string) => {
    const svgChild = decorateObsidianElement(
      document.createElementNS('http://www.w3.org/2000/svg', tag),
    );
    el.appendChild(svgChild);
    return svgChild;
  };
  return el;
}

describe('ClaudianStatusBarUsage', () => {
  beforeEach(() => {
    ProviderWorkspaceRegistry.clear();
    for (const module of BUILT_IN_PROVIDER_MODULES) {
      ProviderRegistry.register(module.id, module);
      ProviderWorkspaceRegistry.register(module.id, module.workspace);
    }
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    await ProviderWorkspaceRegistry.disposeInitialized();
    ProviderWorkspaceRegistry.clear();
  });

  it('stays hidden when usage display is disabled and renders Claude + Cursor usage with tooltips when enabled', async () => {
    const statusBarContainer = decorateObsidianElement(document.createElement('div'));
    document.body.appendChild(statusBarContainer);

    const claudeService = createFakeUsageService({
      status: 'ready',
      windows: [
        { id: 'five_hour', labelKey: 'statusBar.usage.claude.fiveHour', percentUsed: 20, resetsAt: '2026-11-01T03:00:00Z' },
        { id: 'seven_day', labelKey: 'statusBar.usage.claude.weekly', percentUsed: 30, resetsAt: '2026-11-05T00:00:00Z' },
      ],
    });
    const cursorService = createFakeUsageService({
      status: 'ready',
      windows: [
        { id: 'auto', labelKey: 'statusBar.usage.cursor.autoModels', percentUsed: 30, resetsAt: '2026-11-15T00:00:00Z' },
        { id: 'api', labelKey: 'statusBar.usage.cursor.apiModels', percentUsed: 50, resetsAt: '2026-11-15T00:00:00Z' },
      ],
    });

    ProviderWorkspaceRegistry.setServices('claude', { subscriptionUsage: claudeService });
    ProviderWorkspaceRegistry.setServices('cursor', { subscriptionUsage: cursorService });

    const settings: Record<string, unknown> = {
      providerConfigs: {
        claude: { enabled: true, showUsageInStatusBar: false },
        cursor: { enabled: true, showUsageInStatusBar: false },
      },
    };

    const ensureInitialized = jest.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized').mockResolvedValue(undefined);
    const addStatusBarItem = jest.fn(() => statusBarContainer);

    const controller = new ClaudianStatusBarUsage({
      addStatusBarItem,
      providerHost: { settings } as never,
      getSettings: () => settings,
    });

    controller.syncWithSettings();
    expect(ensureInitialized).not.toHaveBeenCalled();
    expect(statusBarContainer.classList.contains('claudian-hidden')).toBe(true);

    (settings.providerConfigs as Record<string, Record<string, unknown>>).claude.showUsageInStatusBar = true;
    (settings.providerConfigs as Record<string, Record<string, unknown>>).cursor.showUsageInStatusBar = true;
    controller.syncWithSettings();

    await waitFor(() => {
      expect(statusBarContainer.classList.contains('claudian-hidden')).toBe(false);
    });

    const view = within(statusBarContainer);
    const claudeButton = view.getByRole('button', { name: /Claude Code[\s\S]*20%[\s\S]*30%/i });
    const cursorButton = view.getByRole('button', { name: /Cursor[\s\S]*30%[\s\S]*50%/i });

    expect(claudeButton.textContent).toContain('20%');
    expect(claudeButton.textContent).toContain('30%');
    expect(claudeButton.getAttribute('aria-label')).toMatch(/20%.*5h limit/i);
    expect(claudeButton.getAttribute('aria-label')).toMatch(/30%.*weekly limit/i);

    expect(cursorButton.textContent).toContain('30%');
    expect(cursorButton.textContent).toContain('50%');
    expect(cursorButton.getAttribute('aria-label')).toMatch(/30%.*Auto \+ Composer models/i);
    expect(cursorButton.getAttribute('aria-label')).toMatch(/50%.*API \/ all models/i);

    fireEvent.click(claudeButton);
    expect(claudeService.refresh).toHaveBeenCalled();

    const axeResults = await axe(statusBarContainer);
    expect(axeResults).toHaveNoViolations();

    controller.dispose();
  });
});
