import { findCLIBinaryPath } from '@/core/process/cliBinaryLocator';
import { CachedProviderCLIResolver } from '@/core/providers/cli/CachedProviderCLIResolver';
import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';

import { getCursorProviderSettings } from '../settings';

const CURSOR_CLI_BINARY_NAMES = ['agent', 'cursor-agent'] as const;

export class CursorCLIResolver {
  private readonly resolver = new CachedProviderCLIResolver({
    binaryName: CURSOR_CLI_BINARY_NAMES[0],
    findBinaryPath: (additionalPath) => {
      for (const binaryName of CURSOR_CLI_BINARY_NAMES) {
        const resolved = findCLIBinaryPath(binaryName, additionalPath);
        if (resolved) return resolved;
      }
      return null;
    },
    getSettingsProjection: (settings) => {
      const providerSettings = getCursorProviderSettings(settings);
      return {
        cliPathsByHost: providerSettings.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'cursor'),
        legacyCliPath: providerSettings.cliPath,
      };
    },
    providerId: 'cursor',
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  reset(): void {
    this.resolver.reset();
  }
}
