import { getInstallationKey } from '@/core/device/InstallationKey';
import { parseEnvironmentVariables } from '@/core/process/env';

import { createCLIPathFingerprintInputs } from '../../../core/providers/cli/CLIPathFingerprintInputs';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { createRuntimeInputFingerprint } from '../../../core/providers/settings/RuntimeInputFingerprint';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import {
  decodeCursorModelId,
  encodeCursorModelId,
} from '../models';
import {
  getCursorProviderSettings,
  updateCursorProviderSettings
} from '../settings';

export function computeCursorEnvironmentHash(settings: Record<string, unknown>): string {
  const providerSettings = getCursorProviderSettings(settings);
  const cliPathInputs = createCLIPathFingerprintInputs(
    providerSettings.cliPathsByHost[getInstallationKey()],
    providerSettings.cliPath,
  );
  const environment = Object.entries(parseEnvironmentVariables(
    getRuntimeEnvironmentText(settings, 'cursor'),
  )).sort(([left], [right]) => left.localeCompare(right));
  return createRuntimeInputFingerprint({
    additionalInputs: cliPathInputs,
    environmentKeys: environment.map(([key]) => key),
    environmentText: getRuntimeEnvironmentText(settings, 'cursor'),
  });
}

export const cursorSettingsReconciler: ProviderSettingsReconciler = {
  environmentSessionPolicy: 'reload',

  invalidateConversationSessions: () => [],

  reconcileModelWithEnvironment(settings) {
    if (!getCursorProviderSettings(settings).enabled) {
      return { changed: false, invalidatedConversations: [] };
    }

    const environmentHash = computeCursorEnvironmentHash(settings);
    if (getCursorProviderSettings(settings).environmentHash === environmentHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    updateCursorProviderSettings(settings, { environmentHash });
    return { changed: true, invalidatedConversations: [] };
  },

  normalizeModelVariantSettings(settings): boolean {
    let changed = false;
    changed = normalizeSelectionAt(settings, 'model') || changed;
    changed = normalizeSelectionAt(settings, 'titleGenerationModel') || changed;

    const savedProviderModel = settings.savedProviderModel;
    if (savedProviderModel && typeof savedProviderModel === 'object' && !Array.isArray(savedProviderModel)) {
      changed = normalizeSelectionAt(
        savedProviderModel as Record<string, unknown>,
        'cursor',
      ) || changed;
    }
    return changed;
  },
};

function normalizeSelectionAt(settings: Record<string, unknown>, key: string): boolean {
  const current = settings[key];
  if (typeof current !== 'string') {
    return false;
  }

  const trimmed = current.trim();
  let normalized: string | null = null;
  const rawModelId = decodeCursorModelId(trimmed);
  if (rawModelId) {
    normalized = encodeCursorModelId(rawModelId);
  }

  if (normalized === null || normalized === current) {
    return false;
  }
  settings[key] = normalized;
  return true;
}
