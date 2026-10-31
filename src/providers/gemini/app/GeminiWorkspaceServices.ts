import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { GeminiCommandCatalog } from '../commands/GeminiCommandCatalog';
import { GeminiCLIResolver } from '../runtime/GeminiCLIResolver';
import { GeminiModelCatalogCoordinator } from '../runtime/GeminiModelCatalogCoordinator';
import { GeminiModelDiscoveryService } from '../runtime/GeminiModelDiscoveryService';
import { createGeminiModels } from '../runtime/GeminiModels';
import { geminiSettingsTabRenderer } from '../ui/GeminiSettingsTab';

export interface GeminiWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: GeminiCLIResolver;
  commandCatalog: ProviderCommandCatalog;
  modelCatalogCoordinator: GeminiModelCatalogCoordinator;
  dispose(): Promise<void>;
}

export async function createGeminiWorkspaceServices(
  plugin: ProviderHost,
): Promise<GeminiWorkspaceServices> {
  const modelCatalogService = new GeminiModelDiscoveryService(plugin);
  const modelCatalogCoordinator = new GeminiModelCatalogCoordinator(
    plugin,
    modelCatalogService,
  );
  const modelCatalog = createGeminiModels(plugin, modelCatalogCoordinator);
  const unregisterTransitionHook =
    plugin.executionLifecycleRegistry.registerTransitionHook('gemini', {
      beforeTransition: async () => {
        modelCatalog.beginTransition();
        modelCatalogCoordinator.beginEnvironmentTransition();
        await modelCatalogCoordinator.quiesceForEnvironmentChange();
      },
      afterTransition: async () => {
        try {
          await modelCatalogCoordinator.quiesceForEnvironmentChange();
        } finally {
          modelCatalogCoordinator.endEnvironmentTransition();
          modelCatalog.endTransition();
        }
      },
    });

  return {
    cliResolver: new GeminiCLIResolver(),
    commandCatalog: new GeminiCommandCatalog(),
    commandLoader: null,
    modelCatalogCoordinator,
    settingsTabRenderer: geminiSettingsTabRenderer,
    modelCatalog,
    async dispose() {
      unregisterTransitionHook();
      await Promise.all([
        modelCatalog.dispose(),
        modelCatalogCoordinator.dispose(),
      ]);
    },
  };
}

export const geminiWorkspaceRegistration: ProviderWorkspaceRegistration<GeminiWorkspaceServices> = {
  consumesAgentSkills: true,
  initialize: async ({ plugin }) => createGeminiWorkspaceServices(plugin),
};

export function getGeminiWorkspaceServices(): GeminiWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('gemini') as GeminiWorkspaceServices;
}
