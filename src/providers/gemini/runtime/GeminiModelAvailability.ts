import { ProviderModelUnavailableError } from '../../../core/providers/models/ProviderModelUnavailableError';
import { decodeGeminiModelId } from '../models';
import { getGeminiProviderSettings, getOrderedGeminiVisibleModelIds } from '../settings';

export function assertGeminiModelAvailable(settings: Record<string, unknown>, requestedModel: string | undefined): void {
  const model = requestedModel ?? (typeof settings.model === 'string' ? settings.model : '');
  const config = getGeminiProviderSettings(settings);
  const id = decodeGeminiModelId(model) ?? '';
  if (!(config.enabled && getOrderedGeminiVisibleModelIds(config).includes(id)
    && Boolean(config.currentCatalog?.models.some(candidate => candidate.rawId === id)))) {
    throw new ProviderModelUnavailableError('Gemini');
  }
}
