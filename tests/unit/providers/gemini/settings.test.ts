const mockGetHostnameKey = jest.fn(() => 'device:current');

import {
  getGeminiProviderSettings,
  updateGeminiProviderSettings,
} from '@/providers/gemini/settings';

jest.mock('@/core/device/InstallationKey', () => ({
  ...jest.requireActual('@/core/device/InstallationKey'),
  getInstallationKey: () => mockGetHostnameKey(),
}));

describe('Gemini settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHostnameKey.mockReturnValue('device:current');
  });

  it('runtime-decodes malformed scalar settings', () => {
    const settings = getGeminiProviderSettings({
      providerConfigs: {
        gemini: {
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
    updateGeminiProviderSettings(target, {
      enabled: true,
      cliPathsByHost: { 'device:current': '/Users/user/.antigravity/antigravity/bin/agy' },
    });
    const settings = getGeminiProviderSettings(target);
    expect(settings.enabled).toBe(true);
    expect(settings.cliPathsByHost['device:current']).toBe(
      '/Users/user/.antigravity/antigravity/bin/agy',
    );
  });
});
