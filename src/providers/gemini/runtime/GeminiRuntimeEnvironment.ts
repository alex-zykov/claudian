import { getEnhancedPath, parseEnvironmentVariables } from '@/core/process/env';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';

/**
 * Merge process env with provider:gemini environment variables.
 * GEMINI_API_KEY / GOOGLE_API_KEY may arrive from process or provider env;
 * never write them into plugin settings.
 */
export function buildGeminiRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const environmentText = getRuntimeEnvironmentText(settings, 'gemini');
  const configuredEnvironment = parseEnvironmentVariables(environmentText);

  return {
    ...process.env,
    ...configuredEnvironment,
    PATH: getEnhancedPath(configuredEnvironment.PATH, cliPath || undefined),
  };
}
