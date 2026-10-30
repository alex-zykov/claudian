import { ProviderModelUnavailableError } from '../../../core/providers/models/ProviderModelUnavailableError';
import { decodeCursorModelId } from '../models';
import { getCursorProviderSettings, getOrderedCursorVisibleModelIds } from '../settings';

export function assertCursorModelAvailable(settings: Record<string, unknown>, requestedModel: string | undefined): void {
  const model = requestedModel ?? (typeof settings.model === 'string' ? settings.model : '');
  const config = getCursorProviderSettings(settings);
  const id = decodeCursorModelId(model) ?? '';
  if (!(config.enabled && getOrderedCursorVisibleModelIds(config).includes(id)
    && Boolean(config.currentCatalog?.models.some(candidate => candidate.rawId === id)))) {
    throw new ProviderModelUnavailableError('Cursor');
  }
}
