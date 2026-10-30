import * as fs from 'fs';
import * as path from 'path';

import { CursorCLIResolver } from '@/providers/cursor/runtime/CursorCLIResolver';

jest.mock('fs');
const mockedStat = fs.statSync as jest.Mock;

jest.mock('@/core/device/InstallationKey', () => ({
  ...jest.requireActual('@/core/device/InstallationKey'),
  getInstallationKey: () => 'current-host',
}));

describe('CursorCLIResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('prefers the current host path over the legacy path', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/current/agent' || filePath === '/legacy/agent') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    expect(new CursorCLIResolver().resolveFromSettings({
      providerConfigs: {
        cursor: {
          cliPathsByHost: {
            'current-host': '/current/agent',
            'other-host': '/other/agent',
          },
          cliPath: '/legacy/agent',
        },
      },
    })).toBe('/current/agent');
  });

  it('finds agent before cursor-agent on PATH', () => {
    const agentPath = path.join('/provider/bin', 'agent');
    const cursorAgentPath = path.join('/provider/bin', 'cursor-agent');
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === agentPath || filePath === cursorAgentPath) {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    expect(new CursorCLIResolver().resolveFromSettings({
      providerConfigs: {
        cursor: { environmentVariables: 'PATH=/provider/bin' },
      },
    })).toBe(agentPath);
  });

  it('falls back to cursor-agent when agent is missing', () => {
    const cursorAgentPath = path.join('/provider/bin', 'cursor-agent');
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === cursorAgentPath) {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    expect(new CursorCLIResolver().resolveFromSettings({
      providerConfigs: {
        cursor: { environmentVariables: 'PATH=/provider/bin' },
      },
    })).toBe(cursorAgentPath);
  });
});
