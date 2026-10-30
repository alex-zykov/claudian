import { ProviderModelCatalogController } from '../../../core/providers/models/ProviderModelCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { getCursorModelLabel } from '../models';
import { getCursorProviderSettings, getOrderedCursorVisibleModelIds, updateCursorProviderSettings } from '../settings';
import type { CursorModelCatalogCoordinator } from './CursorModelCatalogCoordinator';

export function createCursorModels(host: ProviderHost, native: Pick<CursorModelCatalogCoordinator, 'refresh'>): ProviderModelCatalogController {
  return new ProviderModelCatalogController({
    providerId: 'cursor',
    host,
    update: updateCursorProviderSettings,
    providerName: 'Cursor',
    read: (settings = host.settings) => {
      const current = getCursorProviderSettings(settings);
      return {
        enabled: current.enabled,
        models: (current.currentCatalog?.models ?? []).map(model => ({
          id: model.rawId, name: getCursorModelLabel(model), description: model.description,
        })),
        selectedIds: getOrderedCursorVisibleModelIds(current),
        aliases: current.modelAliases,
      };
    },
    discover: async signal => {
      const result = await native.refresh(undefined, signal);
      return { changed: result.changed, diagnostics: result.diagnostics };
    },
  });
}
