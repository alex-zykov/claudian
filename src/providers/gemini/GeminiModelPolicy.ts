import type {
  ProviderModelPolicy,
  ProviderUIOption,
} from '../../core/providers/types';
import {
  decodeGeminiModelId,
  encodeGeminiModelId,
  findGeminiModel,
  getGeminiAvailableReasoningEfforts,
  getGeminiModelLabel,
  isGeminiModelSelectionId,
  resolveGeminiDefaultReasoningEffort,
} from './models';
import { GEMINI_PERMISSION_MODE_POLICY } from './permissionModes';
import {
  getGeminiProviderSettings,
  getOrderedGeminiVisibleModelIds,
  updateGeminiProviderSettings,
} from './settings';

export const geminiModelPolicy: ProviderModelPolicy = {
  permissionModes: GEMINI_PERMISSION_MODE_POLICY,
  getModelOptions(settings): ProviderUIOption[] {
    const geminiSettings = getGeminiProviderSettings(settings);
    const catalogModels = geminiSettings.currentCatalog?.models ?? [];
    const catalogById = new Map(catalogModels.map(model => [model.rawId, model] as const));
    const visibleModelIds = [...getOrderedGeminiVisibleModelIds(geminiSettings)];
    const options: ProviderUIOption[] = [];
    const seen = new Set<string>();

    for (const rawId of visibleModelIds) {
      pushModelOption(options, seen, rawId, catalogById, geminiSettings.modelAliases);
    }

    return options;
  },

  getDefaultModel(settings): string | null {
    const geminiSettings = getGeminiProviderSettings(settings);
    const firstVisibleModelId = getOrderedGeminiVisibleModelIds(geminiSettings).find(id => (
      geminiSettings.currentCatalog?.models.some(model => model.rawId === id)
    ));
    return firstVisibleModelId ? encodeGeminiModelId(firstVisibleModelId) : null;
  },

  ownsModel(model): boolean {
    return isGeminiModelSelectionId(model);
  },

  supportsReasoningEffort(model, settings): boolean {
    return getGeminiAvailableReasoningEfforts(
      getExplicitlySelectedGeminiModel(model, settings),
    ).length > 0;
  },

  getReasoningOptions(model, settings): ProviderUIOption[] {
    return getGeminiAvailableReasoningEfforts(
      getExplicitlySelectedGeminiModel(model, settings),
    ).map(option => ({
      ...(option.description ? { description: option.description } : {}),
      label: option.label,
      value: option.value,
    }));
  },

  getDefaultReasoningValue(model, settings): string {
    const geminiSettings = getGeminiProviderSettings(settings);
    const rawId = decodeGeminiModelId(model);
    if (!rawId) {
      return '';
    }
    const selectedModel = getExplicitlySelectedGeminiModel(model, settings);
    const efforts = getGeminiAvailableReasoningEfforts(selectedModel);
    if (efforts.length === 0) {
      return '';
    }
    return resolveGeminiDefaultReasoningEffort(
      selectedModel ? { ...selectedModel, reasoningEfforts: [...efforts] } : null,
      geminiSettings.preferredReasoningByModel[rawId],
    );
  },

  isDefaultModel(): boolean {
    return false;
  },

  applyModelDefaults(model, settings): void {
    if (!isRecord(settings)) {
      return;
    }
    const normalizedModel = normalizeSelection(model);
    if (!isGeminiModelSelectionId(normalizedModel)) {
      return;
    }
    clearSavedGeminiEffortProjection(settings);
    settings.model = normalizedModel;
    settings.effortLevel = this.getDefaultReasoningValue(normalizedModel, settings);
  },

  applyModelProjectionDefaults(model, settings): void {
    if (!isRecord(settings)) {
      return;
    }
    clearSavedGeminiEffortProjection(settings);
    const rawId = decodeGeminiModelId(model);
    if (!rawId) {
      delete settings.effortLevel;
      return;
    }
    settings.effortLevel = this.getDefaultReasoningValue(model, settings);
  },

  applyReasoningSelection(model, value, settings): void {
    if (!isRecord(settings)) {
      return;
    }
    const rawId = decodeGeminiModelId(model);
    if (!rawId) {
      clearSavedGeminiEffortProjection(settings);
      delete settings.effortLevel;
      return;
    }
    const geminiSettings = getGeminiProviderSettings(settings);
    const supportedValues = new Set(getGeminiAvailableReasoningEfforts(
      getExplicitlySelectedGeminiModel(model, settings),
    ).map(option => option.value));
    const preferredReasoningByModel = { ...geminiSettings.preferredReasoningByModel };
    if (supportedValues.has(value)) {
      preferredReasoningByModel[rawId] = value;
    } else {
      delete preferredReasoningByModel[rawId];
    }
    updateGeminiProviderSettings(settings, { preferredReasoningByModel });
    settings.effortLevel = resolveGeminiDefaultReasoningEffort(
      getExplicitlySelectedGeminiModel(model, settings),
      preferredReasoningByModel[rawId],
    );
  },

  normalizeModelVariant(model): string {
    return normalizeSelection(model);
  },

  getCustomModelIds(): Set<string> {
    return new Set();
  },
};

function pushModelOption(
  options: ProviderUIOption[],
  seen: Set<string>,
  rawId: string,
  catalogById: ReadonlyMap<string, { description?: string; displayName: string; rawId: string }>,
  aliases: Record<string, string>,
): void {
  const value = encodeGeminiModelId(rawId);
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  const model = catalogById.get(rawId);
  if (!model) return;
  options.push({
    value,
    label: aliases[rawId] ?? getGeminiModelLabel(model),
    description: model.description ?? 'Selected in an existing session',
  });
}

function normalizeSelection(model: string): string {
  const normalized = model.trim();
  const rawId = decodeGeminiModelId(normalized);
  return rawId ? encodeGeminiModelId(rawId) : model;
}

function getExplicitlySelectedGeminiModel(
  model: string,
  settings: Record<string, unknown>,
) {
  const rawId = decodeGeminiModelId(model);
  if (!rawId) {
    return null;
  }
  const geminiSettings = getGeminiProviderSettings(settings);
  const catalogModels = geminiSettings.currentCatalog?.models ?? [];
  const visibleModels = geminiSettings.visibleModels
    ?? catalogModels.map(entry => entry.rawId);
  if (!visibleModels.includes(rawId)) {
    return null;
  }
  return findGeminiModel(catalogModels, rawId) ?? {
    displayName: rawId,
    rawId,
    reasoningEfforts: [],
    supportsReasoning: false,
  };
}

function clearSavedGeminiEffortProjection(settings: Record<string, unknown>): void {
  if (isRecord(settings.savedProviderEffort)) {
    delete settings.savedProviderEffort.gemini;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
