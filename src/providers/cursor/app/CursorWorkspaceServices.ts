import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { CursorCommandCatalog } from '../commands/CursorCommandCatalog';
import { CursorCLIResolver } from '../runtime/CursorCLIResolver';
import { CursorModelCatalogCoordinator } from '../runtime/CursorModelCatalogCoordinator';
import { CursorModelDiscoveryService } from '../runtime/CursorModelDiscoveryService';
import { createCursorModels } from '../runtime/CursorModels';
import { cursorSettingsTabRenderer } from '../ui/CursorSettingsTab';

export interface CursorWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: CursorCLIResolver;
  commandCatalog: ProviderCommandCatalog;
  modelCatalogCoordinator: CursorModelCatalogCoordinator;
  dispose(): Promise<void>;
}

export async function createCursorWorkspaceServices(
  plugin: ProviderHost,
): Promise<CursorWorkspaceServices> {
  const modelCatalogService = new CursorModelDiscoveryService(plugin);
  const modelCatalogCoordinator = new CursorModelCatalogCoordinator(
    plugin,
    modelCatalogService,
  );
  const modelCatalog = createCursorModels(plugin, modelCatalogCoordinator);
  const unregisterTransitionHook =
    plugin.executionLifecycleRegistry.registerTransitionHook('cursor', {
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
    cliResolver: new CursorCLIResolver(),
    commandCatalog: new CursorCommandCatalog(),
    commandLoader: null,
    modelCatalogCoordinator,
    settingsTabRenderer: cursorSettingsTabRenderer,
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

export const cursorWorkspaceRegistration: ProviderWorkspaceRegistration<CursorWorkspaceServices> = {
  consumesAgentSkills: true,
  initialize: async ({ plugin }) => createCursorWorkspaceServices(plugin),
};

export function getCursorWorkspaceServices(): CursorWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('cursor') as CursorWorkspaceServices;
}
