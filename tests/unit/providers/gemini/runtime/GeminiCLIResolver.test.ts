import * as fs from 'fs';
import * as path from 'path';

import { GeminiCLIResolver } from '@/providers/gemini/runtime/GeminiCLIResolver';

jest.mock('fs');
const mockedStat = fs.statSync as jest.Mock;

jest.mock('@/core/device/InstallationKey', () => ({
  ...jest.requireActual('@/core/device/InstallationKey'),
  getInstallationKey: () => 'current-host',
}));

describe('GeminiCLIResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('prefers the current host path over the legacy path', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/current/agy' || filePath === '/legacy/agy') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    expect(new GeminiCLIResolver().resolveFromSettings({
      providerConfigs: {
        gemini: {
          cliPathsByHost: {
            'current-host': '/current/agy',
            'other-host': '/other/agy',
          },
          cliPath: '/legacy/agy',
        },
      },
    })).toBe('/current/agy');
  });

  it('resolves only agy on PATH and ignores gemini binary names', () => {
    const agyPath = path.join('/provider/bin', 'agy');
    const geminiPath = path.join('/provider/bin', 'gemini');
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === agyPath || filePath === geminiPath) {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    expect(new GeminiCLIResolver().resolveFromSettings({
      providerConfigs: {
        gemini: { environmentVariables: 'PATH=/provider/bin' },
      },
    })).toBe(agyPath);
  });

  it('returns null when only gemini is present on PATH without agy', () => {
    const geminiPath = path.join('/provider/bin', 'gemini');
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === geminiPath) {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    expect(new GeminiCLIResolver().resolveFromSettings({
      providerConfigs: {
        gemini: { environmentVariables: 'PATH=/provider/bin' },
      },
    })).toBeNull();
  });
});
