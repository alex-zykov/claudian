import { findCLIBinaryPath } from '@/core/process/cliBinaryLocator';
import { CachedProviderCLIResolver } from '@/core/providers/cli/CachedProviderCLIResolver';
import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';

import { getGeminiProviderSettings } from '../settings';

const GEMINI_CLI_BINARY_NAME = 'agy';

export class GeminiCLIResolver {
  private readonly resolver = new CachedProviderCLIResolver({
    binaryName: GEMINI_CLI_BINARY_NAME,
    findBinaryPath: (additionalPath) => findCLIBinaryPath(GEMINI_CLI_BINARY_NAME, additionalPath),
    getSettingsProjection: (settings) => {
      const providerSettings = getGeminiProviderSettings(settings);
      return {
        cliPathsByHost: providerSettings.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'gemini'),
        legacyCliPath: providerSettings.cliPath,
      };
    },
    providerId: 'gemini',
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  reset(): void {
    this.resolver.reset();
  }
}
