/** @jest-environment jsdom */
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { setImmediate } from 'timers';

import { cursorSettingsTabRenderer } from '@/providers/cursor/ui/CursorSettingsTab';

Object.assign(globalThis, { setImmediate });

const mockGetHostnameKey = jest.fn(() => 'device:current');
const mockRenderEnvironmentSettingsSection = jest.fn();
const mockCLIResolverReset = jest.fn();
const mockRefreshModelCatalog = jest.fn().mockResolvedValue({ changed: false });
const mockRefreshSubscriptionUsage = jest.fn().mockResolvedValue(undefined);
const mockGetServices = jest.fn(() => ({
  cliResolver: { reset: mockCLIResolverReset },
  modelCatalog: { refresh: mockRefreshModelCatalog, markStale: jest.fn() },
  subscriptionUsage: { refresh: mockRefreshSubscriptionUsage },
}));

jest.mock('node:fs');
jest.mock('obsidian', () => {
  class MockSetting {
    public name = '';
    public desc = '';
    public heading = false;

    constructor(private readonly container: HTMLElement) {}

    setName(value: string) {
      this.name = value;
      return this;
    }

    setDesc(value: string) {
      this.desc = value;
      return this;
    }

    setHeading() {
      this.heading = true;
      const heading = document.createElement('h2');
      heading.textContent = this.name || 'Models';
      this.container.appendChild(heading);
      return this;
    }

    addText() {
      return this;
    }

    addToggle(callback?: (toggle: {
      setValue: (value: boolean) => unknown;
      onChange: (handler: (value: boolean) => Promise<void> | void) => unknown;
    }) => void) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      if (this.name) {
        input.setAttribute('aria-label', this.name);
      }
      this.container.appendChild(input);
      const toggleComponent = {
        setValue: (value: boolean) => {
          input.checked = value;
          return toggleComponent;
        },
        onChange: (handler: (value: boolean) => Promise<void> | void) => {
          input.addEventListener('change', () => {
            void handler(input.checked);
          });
          return toggleComponent;
        },
      };
      callback?.(toggleComponent);
      return this;
    }
  }

  return { Setting: MockSetting };
});
jest.mock('@/core/providers/ProviderSettingsCoordinator', () => ({
  ProviderSettingsCoordinator: {
    canApplyProviderEnablement: jest.fn(() => true),
    applyProviderEnablement: jest.fn((
      settings: Record<string, any>,
      providerId: string,
      enabled: boolean,
    ) => {
      settings.providerConfigs[providerId].enabled = enabled;
      return true;
    }),
  },
}));
jest.mock('@/core/providers/ProviderWorkspaceRegistry', () => ({
  ProviderWorkspaceRegistry: {
    requireServices: (_providerId: string) => mockGetServices(),
  },
}));
jest.mock('@/shared/settings/EnvironmentSettingsSection', () => ({
  renderEnvironmentSettingsSection: (...args: unknown[]) => mockRenderEnvironmentSettingsSection(...args),
}));
jest.mock('@/shared/settings/ProviderModelsSection', () => ({
  renderProviderModelsSection: () => ({ refresh: jest.fn(), dispose: jest.fn() }),
}));
jest.mock('@/shared/settings/CLIInstallationSetting', () => ({
  renderCLIInstallationSetting: (options: {
    container: HTMLElement;
    enablement: { name: string; getValue: () => boolean; onChange: (value: boolean) => Promise<void> };
    name: string;
    getValue: () => string;
  }) => {
    const group = document.createElement('div');
    options.container.appendChild(group);
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.setAttribute('aria-label', options.enablement.name);
    toggle.checked = options.enablement.getValue();
    group.appendChild(toggle);
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', options.name);
    input.value = options.getValue();
    group.appendChild(input);
  },
}));
jest.mock('@/shared/settings/ProviderModelEnablementWarning', () => ({
  renderLastEnabledProviderWarning: (container: HTMLElement) => {
    const el = document.createElement('div');
    container.appendChild(el);
    return { showFor: jest.fn(), hide: jest.fn() };
  },
  renderProviderModelEnablementWarning: (container: HTMLElement) => {
    const el = document.createElement('div');
    container.appendChild(el);
    return {
      context: { notifyProviderModelOptionsChanged: jest.fn() },
      refresh: jest.fn(),
    };
  },
}));
jest.mock('@/core/device/InstallationKey', () => ({
  ...jest.requireActual('@/core/device/InstallationKey'),
  getInstallationKey: () => mockGetHostnameKey(),
}));

describe('CursorSettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
    mockGetHostnameKey.mockReturnValue('device:current');
  });

  it('renders enablement and CLI path controls with accessible names', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const settings = {
      providerConfigs: {
        cursor: {
          enabled: false,
          cliPath: '',
          cliPathsByHost: { 'device:current': '/home/user/.local/bin/agent' },
          catalogsByHost: {},
          environmentVariables: '',
          environmentHash: '',
          visibleModels: [],
          modelAliases: {},
          preferredReasoningByModel: {},
        },
      },
    };

    cursorSettingsTabRenderer.render(container, {
      plugin: {
        settings,
        storage: { installationKey: 'device:current' },
        mutateSettings: async (mutation: (value: typeof settings) => void) => {
          mutation(settings);
        },
        runProviderExecutionTransition: async (
          _ids: string[],
          work: () => Promise<void>,
        ) => work(),
        applyProviderRuntimeSettings: async (
          _ids: string[],
          mutation: (value: typeof settings) => void,
          after?: () => void,
        ) => {
          mutation(settings);
          after?.();
        },
        getResolvedProviderCliPath: async () => '/home/user/.local/bin/agent',
      },
      renderCustomContextLimits: jest.fn(),
      notifyProviderModelOptionsChanged: jest.fn(),
    } as never);

    const view = within(container);
    expect(view.getByRole('checkbox', { name: /enable.*cursor/i })).toBeTruthy();
    expect(view.getByRole('textbox', { name: /cli path|path/i })).toBeTruthy();
    expect(view.getByRole('heading', { name: /usage/i })).toBeTruthy();
    const usageToggle = view.getByRole('checkbox', { name: /show usage in status bar/i }) as HTMLInputElement;
    expect(usageToggle.checked).toBe(false);
    fireEvent.click(usageToggle);
    await waitFor(() => {
      expect((settings.providerConfigs.cursor as Record<string, unknown>).showUsageInStatusBar).toBe(true);
    });
    expect(mockRefreshSubscriptionUsage).toHaveBeenCalledTimes(1);
    expect(mockRenderEnvironmentSettingsSection).toHaveBeenCalled();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
