import {
  type ACPMetadata,
  type ACPModelInfo,
  type ACPSessionConfigOption,
  type ACPSessionModelState,
  extractACPSessionModelState,
  extractACPSessionThoughtLevelState,
} from '../../acp';
import {
  type GeminiDiscoveredModel,
  type GeminiReasoningEffort,
  normalizeGeminiDiscoveredModels,
  normalizeGeminiReasoningMetadata,
  sortGeminiReasoningEfforts,
  splitGeminiModelEffortVariant,
} from '../models';
import { groupGeminiModelEntries } from '../runtime/GeminiModelDiscoveryService';

export interface NormalizedGeminiSessionModels {
  availableModelIds: string[];
  currentModelId: string | null;
  models: GeminiDiscoveredModel[];
}

export function normalizeGeminiSessionModelMetadata(response: {
  _meta?: ACPMetadata | null;
  configOptions?: ACPSessionConfigOption[] | null;
  models?: ACPSessionModelState | null;
}): NormalizedGeminiSessionModels {
  const state = extractACPSessionModelState(response);
  const thoughtState = extractACPSessionThoughtLevelState({
    configOptions: response.configOptions,
  });
  const rawModelsList = response.models?.availableModels ?? [];
  const rawModelsById = new Map(
    rawModelsList.flatMap(model => {
      const id = resolveACPModelId(model);
      return id ? [[id, model] as const] : [];
    }),
  );

  const variantEffortsByBaseId = new Map<string, Map<string, GeminiReasoningEffort>>();
  for (const rawModel of rawModelsList) {
    const id = resolveACPModelId(rawModel);
    if (!id) continue;
    const variant = splitGeminiModelEffortVariant(id, rawModel.name);
    if (!variant) continue;
    let efforts = variantEffortsByBaseId.get(variant.baseRawId);
    if (!efforts) {
      efforts = new Map();
      variantEffortsByBaseId.set(variant.baseRawId, efforts);
    }
    efforts.set(variant.effort.value, variant.effort);
  }

  const thoughtLevelEfforts: GeminiReasoningEffort[] = thoughtState.availableLevels.map(level => ({
    ...(level.description ? { description: level.description } : {}),
    label: level.name,
    value: level.id,
  }));

  const hasVariantOnlyModels = state.availableModels.length > 0
    && state.availableModels.every(model => splitGeminiModelEffortVariant(model.id, model.name) !== null);

  let models: GeminiDiscoveredModel[];
  if (hasVariantOnlyModels) {
    models = groupGeminiModelEntries(
      state.availableModels.map(model => ({
        ...(model.description ? { description: model.description } : {}),
        displayName: model.name,
        rawId: model.id,
      })),
    );
  } else {
    models = state.availableModels.flatMap(model => {
      const rawModel = rawModelsById.get(model.id);
      const variantEfforts = variantEffortsByBaseId.get(model.id);
      const resolvedEfforts = variantEfforts && variantEfforts.size > 0
        ? sortGeminiReasoningEfforts(Array.from(variantEfforts.values()))
        : thoughtLevelEfforts;
      const defaultEffort = thoughtState.currentLevelId
        ?? (resolvedEfforts.some(e => e.value === 'high') ? 'high' : resolvedEfforts[0]?.value);
      const metadata: Record<string, unknown> = {
        ...(model.id === state.currentModelId && isRecord(response._meta)
          ? response._meta
          : {}),
        ...(isRecord(rawModel?._meta) ? rawModel._meta : {}),
        ...(isRecord(model._meta) ? model._meta : {}),
        ...(resolvedEfforts.length > 0
          ? {
            ...(defaultEffort ? { defaultReasoningEffort: defaultEffort } : {}),
            reasoningEfforts: resolvedEfforts,
            supportsReasoning: true,
          }
          : {}),
      };
      return normalizeGeminiDiscoveredModels([{
        ...metadata,
        description: model.description ?? rawModel?.description ?? undefined,
        displayName: model.name,
        rawId: model.id,
        ...(hasReasoningOptions(metadata) ? { reasoningMetadataResolved: true } : {}),
      }]);
    });
  }

  const availableModelIds = Array.from(new Set([
    ...Array.from(rawModelsById.keys()),
    ...state.availableModels.map(model => model.id),
    ...models.map(model => model.rawId),
  ]));

  const currentVariant = state.currentModelId
    ? splitGeminiModelEffortVariant(state.currentModelId)
    : null;
  const currentModelId = currentVariant && models.some(m => m.rawId === currentVariant.baseRawId)
    ? currentVariant.baseRawId
    : state.currentModelId;

  return {
    availableModelIds,
    currentModelId,
    models,
  };
}

export function normalizeGeminiSetModelMetadata(
  rawModelId: string,
  metadata: ACPMetadata | null | undefined,
): GeminiDiscoveredModel | null {
  if (!isRecord(metadata?.model)) return null;
  return normalizeGeminiDiscoveredModels([{
    ...metadata.model,
    rawId: readModelId(metadata.model) ?? rawModelId,
    ...(hasReasoningOptions(metadata.model) ? { reasoningMetadataResolved: true } : {}),
  }])[0] ?? null;
}

export function normalizeGeminiModelUpdateMetadata(
  value: unknown,
): NormalizedGeminiSessionModels | null {
  const state = parseGeminiModelUpdateState(value);
  return state ? normalizeGeminiSessionModelMetadata({ models: state }) : null;
}

export function parseGeminiModelUpdateState(
  value: unknown,
): ACPSessionModelState | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.models) ? value.models : value;
  if (
    !Array.isArray(candidate.availableModels)
    || typeof candidate.currentModelId !== 'string'
    || !candidate.currentModelId.trim()
    || !candidate.availableModels.every(isACPModelInfo)
  ) {
    return null;
  }

  return candidate as unknown as ACPSessionModelState;
}

function isACPModelInfo(value: unknown): value is ACPModelInfo {
  return isRecord(value)
    && typeof value.name === 'string'
    && readModelId(value) !== null;
}

function resolveACPModelId(model: ACPModelInfo): string | null {
  return readModelId(model);
}

function readModelId(value: Record<string, unknown>): string | null {
  const id = typeof value.modelId === 'string'
    ? value.modelId
    : typeof value.id === 'string'
      ? value.id
      : '';
  return id.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Omitted reasoning fields are a partial update, not an empty capability list. */
function hasReasoningOptions(metadata: Record<string, unknown>): boolean {
  return Array.isArray(metadata.reasoningEfforts ?? metadata.reasoning_efforts)
    || metadata.supportsReasoningEffort === false
    || metadata.supports_reasoning_effort === false
    || metadata.supportsReasoning === false
    || metadata.supports_reasoning === false
    || normalizeGeminiReasoningMetadata(metadata).reasoningEfforts.length > 0;
}
