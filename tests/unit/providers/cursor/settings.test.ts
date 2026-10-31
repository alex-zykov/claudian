const mockGetHostnameKey = jest.fn(() => 'device:current');

import { cursorProviderRegistration } from '@/providers/cursor/registration';
import {
  getCursorProviderSettings,
  projectCursorModelSettings,
  updateCursorProviderSettings,
} from '@/providers/cursor/settings';

jest.mock('@/core/device/InstallationKey', () => ({
  ...jest.requireActual('@/core/device/InstallationKey'),
  getInstallationKey: () => mockGetHostnameKey(),
}));

describe('Cursor settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHostnameKey.mockReturnValue('device:current');
  });

  it('runtime-decodes malformed scalar settings', () => {
    const settings = getCursorProviderSettings({
      providerConfigs: {
        cursor: {
          cliPath: 7,
          enabled: 'false',
          environmentHash: false,
          environmentVariables: ['SECRET=not-a-string'],
        },
      },
    });

    expect(settings.enabled).toBe(false);
    expect(settings.cliPath).toEqual(expect.any(String));
    expect(settings.environmentHash).toEqual(expect.any(String));
    expect(settings.environmentVariables).toEqual(expect.any(String));
  });

  it('updates enabled and host-scoped CLI paths', () => {
    const target: Record<string, unknown> = { providerConfigs: {} };
    updateCursorProviderSettings(target, {
      enabled: true,
      cliPathsByHost: { 'device:current': '/home/user/.local/bin/agent' },
    });
    const settings = getCursorProviderSettings(target);
    expect(settings.enabled).toBe(true);
    expect(settings.cliPathsByHost['device:current']).toBe('/home/user/.local/bin/agent');
  });

  it.each([undefined, null, 'true', 1, false, true])('decodes and persists opt-in status bar usage display from %p', value => {
    const settings = { providerConfigs: { cursor: { showUsageInStatusBar: value } } };
    expect(getCursorProviderSettings(settings).showUsageInStatusBar).toBe(value === true);
    expect(cursorProviderRegistration.workspace.isSubscriptionUsageEnabled?.(settings)).toBe(value === true);
    expect(projectCursorModelSettings(settings).showUsageInStatusBar).toBe(value === true);
  });
});
