import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';

import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCLIResolver,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import {
  ClaudeCommandCatalog,
  type CommandProbe,
} from '../commands/ClaudeCommandCatalog';
import { probeRuntimeCommands } from '../commands/probeRuntimeCommands';
import { ClaudeCLIResolver } from '../runtime/ClaudeCLIResolver';
import {
  applySessionClaudeCatalog,
  type ClaudeCatalogProbe,
  createClaudeModels,
  discoverClaudeModels,
} from '../runtime/ClaudeModels';
import {
  ClaudeSubscriptionUsageService,
  type ClaudeUsageProbe,
} from '../runtime/ClaudeSubscriptionUsageService';
import type { ClaudeRuntimeCatalog } from '../runtime/probeClaudeModels';
import { getClaudeProviderSettings } from '../settings';
import { createClaudeSettingsTabRenderer } from '../ui/ClaudeSettingsTab';

export interface ClaudeWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: ProviderCLIResolver;
  commandCatalog: ProviderCommandCatalog;
  subscriptionUsage: ClaudeSubscriptionUsageService;
  /** Writes back the models and output styles a live session reported at init. */
  publishSessionCatalog(catalog: ClaudeRuntimeCatalog): Promise<void>;
  /** Publishes the subscription usage reported by a live session. */
  publishSessionUsage(usage: SDKControlGetUsageResponse): void;
  dispose(): Promise<void>;
}

export interface ClaudeWorkspaceServicesOptions {
  readonly commandProbe?: CommandProbe;
  readonly catalogProbe?: ClaudeCatalogProbe;
  readonly usageProbe?: ClaudeUsageProbe;
}

export async function createClaudeWorkspaceServices(
  plugin: ProviderHost,
  options: ClaudeWorkspaceServicesOptions = {},
): Promise<ClaudeWorkspaceServices> {
  const cliResolver = new ClaudeCLIResolver();
  const modelCatalog = createClaudeModels(plugin, signal => discoverClaudeModels(plugin, signal, options.catalogProbe));
  const subscriptionUsage = new ClaudeSubscriptionUsageService(plugin, options.usageProbe);

  const commandCatalog = new ClaudeCommandCatalog(
    options.commandProbe ?? (signal => probeRuntimeCommands(plugin, signal)),
  );
  let transitioning = false;
  let disposed = false;
  const unregisterTransitionHook = plugin.executionLifecycleRegistry
    .registerTransitionHook('claude', {
      beforeTransition: async () => {
        transitioning = true;
        subscriptionUsage.abortInFlight();
        modelCatalog.beginTransition();
        await modelCatalog.quiesce();
        await commandCatalog.beginEnvironmentTransition();
      },
      afterTransition: () => {
        commandCatalog.endEnvironmentTransition();
        modelCatalog.endTransition();
        transitioning = false;
      },
    });
  let disposePromise: Promise<void> | null = null;

  return {
    cliResolver,
    commandCatalog,
    subscriptionUsage,
    settingsTabRenderer: createClaudeSettingsTabRenderer({
      cliResolver,
      modelCatalog,
      subscriptionUsage,
    }),
    modelCatalog,
    async publishSessionCatalog(catalog) {
      // A session reporting across an environment transition may describe the old runtime.
      await applySessionClaudeCatalog(plugin, catalog, () => !disposed && !transitioning);
    },
    publishSessionUsage(usage) {
      if (!disposed && !transitioning) {
        subscriptionUsage.publishUsage(usage);
      }
    },
    dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      unregisterTransitionHook();
      disposePromise = Promise.all([
        commandCatalog.dispose(),
        modelCatalog.dispose(),
        subscriptionUsage.dispose(),
      ]).then(() => undefined);
      return disposePromise;
    },
  };
}

export const claudeWorkspaceRegistration: ProviderWorkspaceRegistration<ClaudeWorkspaceServices> = {
  isSubscriptionUsageEnabled: settings => getClaudeProviderSettings(settings).showUsageInStatusBar,
  initialize: async ({ plugin }) => createClaudeWorkspaceServices(plugin),
};

export function getClaudeWorkspaceServices(): ClaudeWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getIfInitialized('claude') as ClaudeWorkspaceServices | null;
}
