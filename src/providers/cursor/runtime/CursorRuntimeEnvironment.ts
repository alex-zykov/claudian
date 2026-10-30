import { getEnhancedPath, parseEnvironmentVariables } from '@/core/process/env';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';

/**
 * Merge process env with provider:cursor environment variables.
 * CURSOR_API_KEY / CURSOR_AUTH_TOKEN may arrive from process or provider env;
 * never write them into plugin settings.
 */
export function buildCursorRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const environmentText = getRuntimeEnvironmentText(settings, 'cursor');
  const configuredEnvironment = parseEnvironmentVariables(environmentText);

  return {
    ...process.env,
    ...configuredEnvironment,
    PATH: getEnhancedPath(configuredEnvironment.PATH, cliPath || undefined),
  };
}
