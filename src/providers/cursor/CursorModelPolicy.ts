import type {
  ProviderModelPolicy,
  ProviderUIOption,
} from '../../core/providers/types';
import {
  decodeCursorModelId,
  encodeCursorModelId,
  findCursorModel,
  getCursorAvailableReasoningEfforts,
  getCursorModelLabel,
  isCursorModelSelectionId,
  resolveCursorDefaultReasoningEffort,
} from './models';
import { CURSOR_PERMISSION_MODE_POLICY } from './permissionModes';
import {
  getCursorProviderSettings,
  getOrderedCursorVisibleModelIds,
  updateCursorProviderSettings,
} from './settings';

export const cursorModelPolicy: ProviderModelPolicy = {
  permissionModes: CURSOR_PERMISSION_MODE_POLICY,
  getModelOptions(settings): ProviderUIOption[] {
    const cursorSettings = getCursorProviderSettings(settings);
    const catalogModels = cursorSettings.currentCatalog?.models ?? [];
    const catalogById = new Map(catalogModels.map(model => [model.rawId, model] as const));
    const visibleModelIds = [...getOrderedCursorVisibleModelIds(cursorSettings)];
    const options: ProviderUIOption[] = [];
    const seen = new Set<string>();

    for (const rawId of visibleModelIds) {
      pushModelOption(options, seen, rawId, catalogById, cursorSettings.modelAliases);
    }

    return options;
  },

  getDefaultModel(settings): string | null {
    const cursorSettings = getCursorProviderSettings(settings);
    const firstVisibleModelId = getOrderedCursorVisibleModelIds(cursorSettings).find(id => (
      cursorSettings.currentCatalog?.models.some(model => model.rawId === id)
    ));
    return firstVisibleModelId ? encodeCursorModelId(firstVisibleModelId) : null;
  },

  ownsModel(model): boolean {
    return isCursorModelSelectionId(model);
  },

  supportsReasoningEffort(): boolean {
    return false;
  },

  getReasoningOptions(): ProviderUIOption[] {
    return [];
  },

  getDefaultReasoningValue(): string {
    return '';
  },

  isDefaultModel(): boolean {
    return false;
  },

  applyModelDefaults(model, settings): void {
    if (!isRecord(settings)) {
      return;
    }
    const normalizedModel = normalizeSelection(model);
    if (!isCursorModelSelectionId(normalizedModel)) {
      return;
    }
    clearSavedCursorEffortProjection(settings);
    settings.model = normalizedModel;
    settings.effortLevel = '';
  },

  applyModelProjectionDefaults(model, settings): void {
    if (!isRecord(settings)) {
      return;
    }
    clearSavedCursorEffortProjection(settings);
    const rawId = decodeCursorModelId(model);
    if (!rawId) {
      delete settings.effortLevel;
      return;
    }
    settings.effortLevel = '';
  },

  applyReasoningSelection(model, value, settings): void {
    if (!isRecord(settings)) {
      return;
    }
    const rawId = decodeCursorModelId(model);
    if (!rawId) {
      clearSavedCursorEffortProjection(settings);
      delete settings.effortLevel;
      return;
    }
    const cursorSettings = getCursorProviderSettings(settings);
    const supportedValues = new Set(getCursorAvailableReasoningEfforts(
      getExplicitlySelectedCursorModel(model, settings),
    ).map(option => option.value));
    const preferredReasoningByModel = { ...cursorSettings.preferredReasoningByModel };
    if (supportedValues.has(value)) {
      preferredReasoningByModel[rawId] = value;
    } else {
      delete preferredReasoningByModel[rawId];
    }
    updateCursorProviderSettings(settings, { preferredReasoningByModel });
    settings.effortLevel = resolveCursorDefaultReasoningEffort(
      getExplicitlySelectedCursorModel(model, settings),
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
  const value = encodeCursorModelId(rawId);
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  const model = catalogById.get(rawId);
  if (!model) return;
  options.push({
    value,
    label: aliases[rawId] ?? getCursorModelLabel(model),
    description: model.description ?? 'Selected in an existing session',
  });
}

function normalizeSelection(model: string): string {
  const normalized = model.trim();
  const rawId = decodeCursorModelId(normalized);
  return rawId ? encodeCursorModelId(rawId) : model;
}

function getExplicitlySelectedCursorModel(
  model: string,
  settings: Record<string, unknown>,
) {
  const rawId = decodeCursorModelId(model);
  if (!rawId) {
    return null;
  }
  const cursorSettings = getCursorProviderSettings(settings);
  const catalogModels = cursorSettings.currentCatalog?.models ?? [];
  const visibleModels = cursorSettings.visibleModels
    ?? catalogModels.map(entry => entry.rawId);
  if (!visibleModels.includes(rawId)) {
    return null;
  }
  return findCursorModel(catalogModels, rawId) ?? {
    displayName: rawId,
    rawId,
    reasoningEfforts: [],
    supportsReasoning: false,
  };
}

function clearSavedCursorEffortProjection(settings: Record<string, unknown>): void {
  if (isRecord(settings.savedProviderEffort)) {
    delete settings.savedProviderEffort.cursor;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
