import { NOOP_TASK_RESULT_INTERPRETER } from '../../core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '../../core/providers/providerConfig';
import { hasStoredConfigNormalization } from '../../core/providers/settings/storedSettings';
import type { ProviderModule } from '../../core/providers/types';
import {
  cursorWorkspaceRegistration,
  getCursorWorkspaceServices,
} from './app/CursorWorkspaceServices';
import { CURSOR_PROVIDER_CAPABILITIES } from './capabilities';
import { cursorModelPolicy } from './CursorModelPolicy';
import { cursorSettingsReconciler } from './env/CursorSettingsReconciler';
import { CursorExecutionBackend } from './execution/CursorExecutionBackend';
import { CursorConversationHistoryService } from './history/CursorConversationHistoryService';
import { cursorSubagentLifecycleAdapter } from './normalization/cursorSubagentNormalization';
import { getCursorMigratedVisibleModelIds, getCursorProviderSettings, projectCursorModelSettings, updateCursorProviderSettings } from './settings';
import { cursorChatUIConfig } from './ui/CursorChatUIConfig';

export const cursorProviderRegistration: ProviderModule = {
  id: 'cursor',
  blankTabOrder: 13,
  capabilities: CURSOR_PROVIDER_CAPABILITIES,
  modelPolicy: cursorModelPolicy,
  chatUIConfig: cursorChatUIConfig,
  createExecutionBackend: (plugin) => {
    const workspace = getCursorWorkspaceServices();
    return new CursorExecutionBackend(plugin, {
      commandCatalog: workspace.commandCatalog,
      modelCatalogCoordinator: workspace.modelCatalogCoordinator,
      subscriptionUsage: workspace.subscriptionUsage,
    });
  },

  displayName: 'Cursor',
  environmentKeyPatterns: [/^CURSOR_/i],
  historyService: new CursorConversationHistoryService(),
  isEnabled: settings => getCursorProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateCursorProviderSettings(settings, { enabled }),
  settingsReconciler: cursorSettingsReconciler,
  settingsStorage: {
    projectPersistedConfig: projectCursorModelSettings,
    needsReasoningMetadata() {
      return false;
    },
    hostScopedFields: ['cliPathsByHost', 'catalogsByHost', 'selectedModelsByHost'],
    normalizeStored(target, stored) {
      const storedConfig = getProviderConfig(stored, 'cursor');
      const current = getCursorProviderSettings(stored);
      updateCursorProviderSettings(target, { ...current, visibleModels: getCursorMigratedVisibleModelIds(current) });
      return hasStoredConfigNormalization(
        storedConfig,
        getProviderConfig(target, 'cursor'),
      );
    },
  },
  subagentAdapter: cursorSubagentLifecycleAdapter,
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER,
  workspace: cursorWorkspaceRegistration,
};
