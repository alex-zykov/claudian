import { ProviderModelCatalogController } from '../../../core/providers/models/ProviderModelCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { getGeminiModelLabel } from '../models';
import { getGeminiProviderSettings, getOrderedGeminiVisibleModelIds, updateGeminiProviderSettings } from '../settings';
import type { GeminiModelCatalogCoordinator } from './GeminiModelCatalogCoordinator';

export function createGeminiModels(host: ProviderHost, native: Pick<GeminiModelCatalogCoordinator, 'refresh'>): ProviderModelCatalogController {
  return new ProviderModelCatalogController({
    providerId: 'gemini',
    host,
    update: updateGeminiProviderSettings,
    providerName: 'Gemini',
    read: (settings = host.settings) => {
      const current = getGeminiProviderSettings(settings);
      return {
        enabled: current.enabled,
        models: (current.currentCatalog?.models ?? []).map(model => ({
          id: model.rawId, name: getGeminiModelLabel(model), description: model.description,
        })),
        selectedIds: getOrderedGeminiVisibleModelIds(current),
        aliases: current.modelAliases,
      };
    },
    discover: async signal => {
      const result = await native.refresh(undefined, signal);
      return { changed: result.changed, diagnostics: result.diagnostics };
    },
  });
}
