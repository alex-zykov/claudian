export interface CursorReasoningEffort {
  description?: string;
  label: string;
  value: string;
}

export interface CursorDiscoveredModel {
  agentType?: string;
  contextWindow?: number;
  defaultReasoningEffort?: string;
  description?: string;
  displayName: string;
  rawId: string;
  reasoningMetadataResolved?: boolean;
  reasoningEfforts: CursorReasoningEffort[];
  supportsReasoning: boolean;
}

export const CURSOR_MODEL_PREFIX = 'cursor/';

export function isCursorModelSelectionId(model: string): boolean {
  return decodeCursorModelId(model.trim()) !== null;
}

export function encodeCursorModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  if (!normalized || normalized === CURSOR_MODEL_PREFIX) {
    return '';
  }
  return normalized.startsWith(CURSOR_MODEL_PREFIX)
    ? normalized
    : `${CURSOR_MODEL_PREFIX}${normalized}`;
}

export function decodeCursorModelId(model: string): string | null {
  const normalized = model.trim();
  if (!normalized.startsWith(CURSOR_MODEL_PREFIX)) {
    return null;
  }
  const rawModelId = normalized.slice(CURSOR_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeCursorDiscoveredModels(value: unknown): CursorDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedById = new Map<string, CursorDiscoveredModel>();
  for (const entry of value) {
    const model = normalizeCursorDiscoveredModel(entry);
    if (!model) {
      continue;
    }

    const current = normalizedById.get(model.rawId);
    normalizedById.set(
      model.rawId,
      current ? mergeCursorModelMetadata(current, model) : model,
    );
  }
  return Array.from(normalizedById.values());
}

export function mergeCursorDiscoveredModels(
  catalogModels: CursorDiscoveredModel[],
  liveModels: CursorDiscoveredModel[],
): CursorDiscoveredModel[] {
  const merged = normalizeCursorDiscoveredModels(catalogModels);
  const indexes = new Map(merged.map((model, index) => [model.rawId, index] as const));

  for (const incoming of normalizeCursorDiscoveredModels(liveModels)) {
    const index = indexes.get(incoming.rawId);
    if (index === undefined) {
      indexes.set(incoming.rawId, merged.length);
      merged.push(incoming);
      continue;
    }
    merged[index] = mergeCursorModelMetadata(merged[index], incoming);
  }

  return merged;
}

/** Native names win; a bare `composer-*` id keeps its raw id as the label fallback. */
export function getCursorModelLabel(model: Pick<CursorDiscoveredModel, 'displayName' | 'rawId'>): string {
  return model.displayName || model.rawId;
}

export function findCursorModel(
  models: CursorDiscoveredModel[],
  modelId: string,
): CursorDiscoveredModel | null {
  const rawModelId = decodeCursorModelId(modelId) ?? modelId.trim();
  if (!rawModelId) {
    return null;
  }
  return models.find(model => model.rawId === rawModelId) ?? null;
}

/** Cursor ACP advertises no reasoning-effort control (`reasoningControl: 'none'`). */
export function getCursorAvailableReasoningEfforts(
  _model?: CursorDiscoveredModel | null,
): readonly CursorReasoningEffort[] {
  return [];
}

export function resolveCursorDefaultReasoningEffort(
  _model?: CursorDiscoveredModel | null,
  _preferredEffort?: string,
): string {
  return '';
}

export function normalizeCursorReasoningMetadata(_value: unknown): Pick<
  CursorDiscoveredModel,
  'defaultReasoningEffort' | 'reasoningEfforts' | 'supportsReasoning'
> {
  return { reasoningEfforts: [], supportsReasoning: false };
}

function normalizeCursorDiscoveredModel(value: unknown): CursorDiscoveredModel | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawId = readTrimmedString(value.rawId ?? value.modelId ?? value.id);
  if (!rawId) {
    return null;
  }

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
    ...(description ? { description } : {}),
    displayName,
    rawId,
    ...(value.reasoningMetadataResolved === true
      ? { reasoningMetadataResolved: true }
      : {}),
    reasoningEfforts: [],
    supportsReasoning: false,
  };
}

function mergeCursorModelMetadata(
  current: CursorDiscoveredModel,
  incoming: CursorDiscoveredModel,
): CursorDiscoveredModel {
  const incomingDisplayNameIsRich = incoming.displayName !== incoming.rawId;

  return {
    ...(incoming.agentType ?? current.agentType
      ? { agentType: incoming.agentType ?? current.agentType }
      : {}),
    ...(incoming.contextWindow ?? current.contextWindow
      ? { contextWindow: incoming.contextWindow ?? current.contextWindow }
      : {}),
    ...(incoming.description ?? current.description
      ? { description: incoming.description ?? current.description }
      : {}),
    displayName: incomingDisplayNameIsRich ? incoming.displayName : current.displayName,
    rawId: current.rawId,
    ...(incoming.reasoningMetadataResolved || current.reasoningMetadataResolved
      ? { reasoningMetadataResolved: true }
      : {}),
    reasoningEfforts: [],
    supportsReasoning: false,
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
