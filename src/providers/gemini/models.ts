import {
  DEFAULT_REASONING_VALUE,
  formatReasoningValueLabel,
  STANDARD_REASONING_VALUES,
} from '../../core/providers/reasoning';

export interface GeminiReasoningEffort {
  description?: string;
  label: string;
  value: string;
}

export interface GeminiDiscoveredModel {
  agentType?: string;
  contextWindow?: number;
  defaultReasoningEffort?: string;
  description?: string;
  displayName: string;
  rawId: string;
  reasoningMetadataResolved?: boolean;
  reasoningEfforts: GeminiReasoningEffort[];
  supportsReasoning: boolean;
}

export const GEMINI_MODEL_PREFIX = 'gemini/';

const GEMINI_STANDARD_EFFORTS: readonly GeminiReasoningEffort[] = Object.freeze([
  Object.freeze({ label: 'Low', value: 'low' }),
  Object.freeze({ label: 'Medium', value: 'medium' }),
  Object.freeze({ label: 'High', value: 'high' }),
]);

const GEMINI_PRO_EFFORTS: readonly GeminiReasoningEffort[] = Object.freeze([
  Object.freeze({ label: 'Low', value: 'low' }),
  Object.freeze({ label: 'High', value: 'high' }),
]);

const GEMINI_MAX_EFFORTS: readonly GeminiReasoningEffort[] = Object.freeze([
  Object.freeze({ label: 'Low', value: 'low' }),
  Object.freeze({ label: 'Medium', value: 'medium' }),
  Object.freeze({ label: 'High', value: 'high' }),
  Object.freeze({ label: 'Max', value: 'max' }),
]);

export const GEMINI_FALLBACK_DISCOVERED_MODELS: readonly GeminiDiscoveredModel[] = Object.freeze([
  {
    defaultReasoningEffort: 'high',
    displayName: 'Gemini 4 Argon',
    rawId: 'gemini-4-argon',
    reasoningEfforts: [...GEMINI_STANDARD_EFFORTS],
    reasoningMetadataResolved: true,
    supportsReasoning: true,
  },
  {
    defaultReasoningEffort: 'high',
    displayName: 'Gemini 3.8 Flash',
    rawId: 'gemini-3.8-flash',
    reasoningEfforts: [...GEMINI_STANDARD_EFFORTS],
    reasoningMetadataResolved: true,
    supportsReasoning: true,
  },
  {
    defaultReasoningEffort: 'high',
    displayName: 'Gemini 3.7 Flash',
    rawId: 'gemini-3.7-flash',
    reasoningEfforts: [...GEMINI_STANDARD_EFFORTS],
    reasoningMetadataResolved: true,
    supportsReasoning: true,
  },
  {
    defaultReasoningEffort: 'high',
    displayName: 'Gemini 3.6 Flash',
    rawId: 'gemini-3.6-flash',
    reasoningEfforts: [...GEMINI_STANDARD_EFFORTS],
    reasoningMetadataResolved: true,
    supportsReasoning: true,
  },
  {
    defaultReasoningEffort: 'high',
    displayName: 'Gemini 3.1 Pro',
    rawId: 'gemini-3.1-pro',
    reasoningEfforts: [...GEMINI_PRO_EFFORTS],
    reasoningMetadataResolved: true,
    supportsReasoning: true,
  },
  {
    defaultReasoningEffort: 'high',
    displayName: 'Claude Opus 5.5',
    rawId: 'claude-opus-5-5',
    reasoningEfforts: [...GEMINI_MAX_EFFORTS],
    reasoningMetadataResolved: true,
    supportsReasoning: true,
  },
  {
    defaultReasoningEffort: 'high',
    displayName: 'Claude Sonnet 5.5',
    rawId: 'claude-sonnet-5-5',
    reasoningEfforts: [...GEMINI_MAX_EFFORTS],
    reasoningMetadataResolved: true,
    supportsReasoning: true,
  },
]);

const GEMINI_EFFORT_ORDER: Readonly<Record<string, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  max: 3,
});

export interface GeminiModelEffortVariant {
  baseDisplayName: string;
  baseRawId: string;
  effort: GeminiReasoningEffort;
}

export function splitGeminiModelEffortVariant(
  rawId: string,
  displayName?: string,
): GeminiModelEffortVariant | null {
  const match = rawId.trim().match(/^(.+)-(low|medium|high|max)$/i);
  if (!match) {
    return null;
  }
  const baseRawId = match[1].trim();
  const effortValue = match[2].toLowerCase();
  if (!baseRawId) {
    return null;
  }
  const rawDisplay = (displayName ?? '').trim();
  const baseDisplayName = rawDisplay
    ? rawDisplay.replace(/\s*\((?:low|medium|high|max)\)\s*$/i, '').trim() || baseRawId
    : baseRawId;
  return {
    baseDisplayName,
    baseRawId,
    effort: {
      label: formatReasoningValueLabel(effortValue),
      value: effortValue,
    },
  };
}

export function sortGeminiReasoningEfforts(
  efforts: readonly GeminiReasoningEffort[],
): GeminiReasoningEffort[] {
  return [...efforts].sort((left, right) => {
    const leftOrder = GEMINI_EFFORT_ORDER[left.value] ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = GEMINI_EFFORT_ORDER[right.value] ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

export const GEMINI_DEFAULT_REASONING_EFFORTS: readonly GeminiReasoningEffort[] = Object.freeze(
  STANDARD_REASONING_VALUES.map(value => Object.freeze({
    label: formatReasoningValueLabel(value),
    value,
  })),
);

export function isGeminiModelSelectionId(model: string): boolean {
  return decodeGeminiModelId(model.trim()) !== null;
}

export function encodeGeminiModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  if (!normalized || normalized === GEMINI_MODEL_PREFIX) {
    return '';
  }
  return normalized.startsWith(GEMINI_MODEL_PREFIX)
    ? normalized
    : `${GEMINI_MODEL_PREFIX}${normalized}`;
}

export function decodeGeminiModelId(model: string): string | null {
  const normalized = model.trim();
  if (!normalized.startsWith(GEMINI_MODEL_PREFIX)) {
    return null;
  }
  const rawModelId = normalized.slice(GEMINI_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeGeminiDiscoveredModels(value: unknown): GeminiDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedById = new Map<string, GeminiDiscoveredModel>();
  for (const entry of value) {
    const model = normalizeGeminiDiscoveredModel(entry);
    if (!model) {
      continue;
    }

    const current = normalizedById.get(model.rawId);
    normalizedById.set(
      model.rawId,
      current ? mergeGeminiModelMetadata(current, model) : model,
    );
  }
  return Array.from(normalizedById.values());
}

export function mergeGeminiDiscoveredModels(
  catalogModels: GeminiDiscoveredModel[],
  liveModels: GeminiDiscoveredModel[],
): GeminiDiscoveredModel[] {
  const merged = normalizeGeminiDiscoveredModels(catalogModels);
  const indexes = new Map(merged.map((model, index) => [model.rawId, index] as const));

  for (const incoming of normalizeGeminiDiscoveredModels(liveModels)) {
    const index = indexes.get(incoming.rawId);
    if (index === undefined) {
      indexes.set(incoming.rawId, merged.length);
      merged.push(incoming);
      continue;
    }
    merged[index] = mergeGeminiModelMetadata(merged[index], incoming);
  }

  return merged;
}

export function getGeminiModelLabel(model: Pick<GeminiDiscoveredModel, 'displayName' | 'rawId'>): string {
  return model.displayName || model.rawId;
}

export function findGeminiModel(
  models: GeminiDiscoveredModel[],
  modelId: string,
): GeminiDiscoveredModel | null {
  const rawModelId = decodeGeminiModelId(modelId) ?? modelId.trim();
  if (!rawModelId) {
    return null;
  }
  return models.find(model => model.rawId === rawModelId) ?? null;
}

export function getGeminiAvailableReasoningEfforts(
  model?: GeminiDiscoveredModel | null,
): readonly GeminiReasoningEffort[] {
  if (!model || !model.supportsReasoning) {
    return [];
  }
  if (model.reasoningEfforts.length > 0) {
    return model.reasoningEfforts;
  }
  return GEMINI_DEFAULT_REASONING_EFFORTS;
}

export function resolveGeminiDefaultReasoningEffort(
  model?: GeminiDiscoveredModel | null,
  preferredEffort?: string,
): string {
  const efforts = getGeminiAvailableReasoningEfforts(model);
  if (efforts.length === 0) {
    return '';
  }
  const availableValues = efforts.map(effort => effort.value);
  const normalizedPreferred = preferredEffort?.trim();
  if (normalizedPreferred && availableValues.includes(normalizedPreferred)) {
    return normalizedPreferred;
  }
  const modelDefault = model?.defaultReasoningEffort?.trim();
  if (modelDefault && availableValues.includes(modelDefault)) {
    return modelDefault;
  }
  if (availableValues.includes(DEFAULT_REASONING_VALUE)) {
    return DEFAULT_REASONING_VALUE;
  }
  return availableValues[0] ?? '';
}

export function normalizeGeminiReasoningMetadata(value: unknown): Pick<
  GeminiDiscoveredModel,
  'defaultReasoningEffort' | 'reasoningEfforts' | 'supportsReasoning'
> {
  if (!isRecord(value)) {
    return { reasoningEfforts: [], supportsReasoning: false };
  }
  const explicitEfforts = normalizeGeminiReasoningEfforts(
    value.reasoningEfforts ?? value.reasoning_efforts,
  );
  const defaultReasoningEffort = readTrimmedString(
    value.reasoningEffort
      ?? value.reasoning_effort
      ?? value.defaultReasoningEffort
      ?? value.default_reasoning_effort,
  );
  const supportsReasoning = value.supportsReasoning === true
    || value.supports_reasoning === true
    || value.supportsReasoningEffort === true
    || value.supports_reasoning_effort === true
    || explicitEfforts.length > 0
    || Boolean(defaultReasoningEffort);
  const reasoningEfforts = explicitEfforts.length > 0
    ? explicitEfforts
    : supportsReasoning
      ? [...GEMINI_DEFAULT_REASONING_EFFORTS]
      : [];
  return {
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    reasoningEfforts,
    supportsReasoning,
  };
}

function normalizeGeminiDiscoveredModel(value: unknown): GeminiDiscoveredModel | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawId = readTrimmedString(value.rawId ?? value.modelId ?? value.id);
  if (!rawId) {
    return null;
  }

  const reasoning = normalizeGeminiReasoningMetadata(value);
  const agentType = readTrimmedString(value.agentType ?? value.agent_type);
  const contextWindow = readPositiveFiniteNumber(
    value.contextWindow
      ?? value.context_window
      ?? value.totalContextTokens
      ?? value.total_context_tokens,
  );
  const description = readTrimmedString(value.description);
  const displayName = readTrimmedString(
    value.displayName ?? value.display_name ?? value.name ?? value.label,
  ) || rawId;
  return {
    ...(agentType ? { agentType } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(reasoning.defaultReasoningEffort
      ? { defaultReasoningEffort: reasoning.defaultReasoningEffort }
      : {}),
    ...(description ? { description } : {}),
    displayName,
    rawId,
    ...(value.reasoningMetadataResolved === true
      ? { reasoningMetadataResolved: true }
      : {}),
    reasoningEfforts: reasoning.reasoningEfforts,
    supportsReasoning: reasoning.supportsReasoning,
  };
}

function normalizeGeminiReasoningEfforts(value: unknown): GeminiReasoningEffort[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const efforts: GeminiReasoningEffort[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const record = isRecord(entry) ? entry : null;
    const effortValue = readTrimmedString(record?.value ?? record?.id ?? entry);
    if (!effortValue || seen.has(effortValue)) {
      continue;
    }
    seen.add(effortValue);
    const label = readTrimmedString(record?.label ?? record?.name)
      || formatReasoningValueLabel(effortValue);
    const description = readTrimmedString(record?.description);
    efforts.push({
      ...(description ? { description } : {}),
      label,
      value: effortValue,
    });
  }
  return efforts;
}

function mergeGeminiModelMetadata(
  current: GeminiDiscoveredModel,
  incoming: GeminiDiscoveredModel,
): GeminiDiscoveredModel {
  const incomingReasoningIsAuthoritative = incoming.reasoningMetadataResolved === true;
  const reasoningEfforts = incomingReasoningIsAuthoritative
    ? incoming.reasoningEfforts
    : incoming.reasoningEfforts.length > 0
      ? incoming.reasoningEfforts
      : current.reasoningEfforts;
  const defaultReasoningEffort = incomingReasoningIsAuthoritative
    ? incoming.defaultReasoningEffort
    : incoming.defaultReasoningEffort ?? current.defaultReasoningEffort;
  const incomingDisplayNameIsRich = incoming.displayName !== incoming.rawId;

  return {
    ...(incoming.agentType ?? current.agentType
      ? { agentType: incoming.agentType ?? current.agentType }
      : {}),
    ...(incoming.contextWindow ?? current.contextWindow
      ? { contextWindow: incoming.contextWindow ?? current.contextWindow }
      : {}),
    ...(defaultReasoningEffort
      ? { defaultReasoningEffort }
      : {}),
    ...(incoming.description ?? current.description
      ? { description: incoming.description ?? current.description }
      : {}),
    displayName: incomingDisplayNameIsRich ? incoming.displayName : current.displayName,
    rawId: current.rawId,
    ...(incoming.reasoningMetadataResolved || current.reasoningMetadataResolved
      ? { reasoningMetadataResolved: true }
      : {}),
    reasoningEfforts,
    supportsReasoning: incomingReasoningIsAuthoritative
      ? incoming.supportsReasoning || reasoningEfforts.length > 0
      : incoming.supportsReasoning
        || current.supportsReasoning
        || reasoningEfforts.length > 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPositiveFiniteNumber(value: unknown): number | undefined {
  return isPositiveFiniteNumber(value) ? Math.floor(value) : undefined;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
