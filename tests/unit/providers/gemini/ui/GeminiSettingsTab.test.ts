/** @jest-environment jsdom */
import { within } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { setImmediate } from 'timers';

import { geminiSettingsTabRenderer } from '@/providers/gemini/ui/GeminiSettingsTab';

Object.assign(globalThis, { setImmediate });

const mockGetHostnameKey = jest.fn(() => 'device:current');
const mockRenderEnvironmentSettingsSection = jest.fn();
const mockCLIResolverReset = jest.fn();
const mockRefreshModelCatalog = jest.fn().mockResolvedValue({ changed: false });
const mockGetServices = jest.fn(() => ({
  cliResolver: { reset: mockCLIResolverReset },
  modelCatalog: { refresh: mockRefreshModelCatalog, markStale: jest.fn() },
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

    addToggle() {
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

describe('GeminiSettingsTab', () => {
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
        gemini: {
          enabled: false,
          cliPath: '',
          cliPathsByHost: { 'device:current': '/Users/user/.antigravity/antigravity/bin/agy' },
          catalogsByHost: {},
          environmentVariables: '',
          environmentHash: '',
          visibleModels: [],
          modelAliases: {},
          preferredReasoningByModel: {},
        },
      },
    };

    geminiSettingsTabRenderer.render(container, {
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
        getResolvedProviderCliPath: async () => '/Users/user/.antigravity/antigravity/bin/agy',
      },
      renderCustomContextLimits: jest.fn(),
      notifyProviderModelOptionsChanged: jest.fn(),
    } as never);

    const view = within(container);
    expect(view.getByRole('checkbox', { name: /enable.*gemini/i })).toBeTruthy();
    expect(view.getByRole('textbox', { name: /cli path|path/i })).toBeTruthy();
    expect(mockRenderEnvironmentSettingsSection).toHaveBeenCalled();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
