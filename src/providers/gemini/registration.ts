import { NOOP_TASK_RESULT_INTERPRETER } from '../../core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '../../core/providers/providerConfig';
import { hasStoredConfigNormalization } from '../../core/providers/settings/storedSettings';
import type { ProviderModule } from '../../core/providers/types';
import {
  geminiWorkspaceRegistration,
  getGeminiWorkspaceServices,
} from './app/GeminiWorkspaceServices';
import { GEMINI_PROVIDER_CAPABILITIES } from './capabilities';
import { geminiSettingsReconciler } from './env/GeminiSettingsReconciler';
import { GeminiExecutionBackend } from './execution/GeminiExecutionBackend';
import { geminiModelPolicy } from './GeminiModelPolicy';
import { GeminiConversationHistoryService } from './history/GeminiConversationHistoryService';
import { findGeminiModel } from './models';
import { geminiSubagentLifecycleAdapter } from './normalization/geminiSubagentNormalization';
import {
  getGeminiMigratedVisibleModelIds,
  getGeminiProviderSettings,
  getOrderedGeminiVisibleModelIds,
  projectGeminiModelSettings,
  updateGeminiProviderSettings,
} from './settings';
import { geminiChatUIConfig } from './ui/GeminiChatUIConfig';

export const geminiProviderRegistration: ProviderModule = {
  id: 'gemini',
  blankTabOrder: 70,
  capabilities: GEMINI_PROVIDER_CAPABILITIES,
  modelPolicy: geminiModelPolicy,
  chatUIConfig: geminiChatUIConfig,
  createExecutionBackend: (plugin) => {
    const workspace = getGeminiWorkspaceServices();
    return new GeminiExecutionBackend(plugin, {
      commandCatalog: workspace.commandCatalog,
      modelCatalogCoordinator: workspace.modelCatalogCoordinator,
    });
  },

  displayName: 'Gemini',
  environmentKeyPatterns: [/^GEMINI_/i, /^GOOGLE_/i, /^ANTIGRAVITY_/i, /^AGY_/i],
  historyService: new GeminiConversationHistoryService(),
  isEnabled: settings => getGeminiProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateGeminiProviderSettings(settings, { enabled }),
  settingsReconciler: geminiSettingsReconciler,
  settingsStorage: {
    projectPersistedConfig: projectGeminiModelSettings,
    needsReasoningMetadata(settings) {
      const current = getGeminiProviderSettings(settings);
      const catalogModels = current.currentCatalog?.models ?? [];
      if (catalogModels.length === 0) {
        return true;
      }
      return getOrderedGeminiVisibleModelIds(current)
        .some(id => !findGeminiModel(catalogModels, id)?.reasoningMetadataResolved);
    },
    hostScopedFields: ['cliPathsByHost', 'catalogsByHost', 'selectedModelsByHost'],
    normalizeStored(target, stored) {
      const storedConfig = getProviderConfig(stored, 'gemini');
      const current = getGeminiProviderSettings(stored);
      updateGeminiProviderSettings(target, { ...current, visibleModels: getGeminiMigratedVisibleModelIds(current) });
      return hasStoredConfigNormalization(
        storedConfig,
        getProviderConfig(target, 'gemini'),
      );
    },
  },
  subagentAdapter: geminiSubagentLifecycleAdapter,
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER,
  workspace: geminiWorkspaceRegistration,
};
