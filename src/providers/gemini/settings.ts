import { getInstallationKey } from '@/core/device/InstallationKey';

import { selectModelMetadata } from '../../core/providers/models/selectedModelMetadata';
import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import type { HostnameCLIPaths } from '../../core/types/settings';
import {
  decodeGeminiModelId,
  type GeminiDiscoveredModel,
  getGeminiAvailableReasoningEfforts,
  normalizeGeminiDiscoveredModels,
} from './models';

export interface GeminiCatalogSnapshot {
  models: GeminiDiscoveredModel[];
  defaultModelId: string | null;
  fingerprint: string;
  refreshedAt: number;
}

export interface PersistedGeminiProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCLIPaths;
  catalogsByHost: Record<string, GeminiCatalogSnapshot>;
  environmentVariables: string;
  environmentHash: string;
  visibleModels: string[] | null;
  modelAliases: Record<string, string>;
  preferredReasoningByModel: Record<string, string>;
}

export interface GeminiProviderSettings extends PersistedGeminiProviderSettings {
  currentCatalog: GeminiCatalogSnapshot | null;
}

export const DEFAULT_GEMINI_PROVIDER_SETTINGS: Readonly<PersistedGeminiProviderSettings> = Object.freeze({
  catalogsByHost: {},
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  preferredReasoningByModel: {},
  visibleModels: [],
});

export function getOrderedGeminiVisibleModelIds(
  settings: GeminiProviderSettings,
): string[] {
  if (settings.visibleModels !== null) {
    return [...settings.visibleModels];
  }

  const models = settings.currentCatalog?.models ?? [];
  const defaultModelId = settings.currentCatalog?.defaultModelId;
  if (!defaultModelId || !models.some(model => model.rawId === defaultModelId)) {
    return models.map(model => model.rawId);
  }

  return [
    defaultModelId,
    ...models.filter(model => model.rawId !== defaultModelId).map(model => model.rawId),
  ];
}

export function normalizeGeminiCatalogSnapshot(value: unknown): GeminiCatalogSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const defaultModelId = normalizeRawModelId(value.defaultModelId);
  const fingerprint = readTrimmedString(value.fingerprint);
  const refreshedAt = typeof value.refreshedAt === 'number'
    && Number.isFinite(value.refreshedAt)
    && value.refreshedAt >= 0
    ? Math.floor(value.refreshedAt)
    : 0;

  return {
    defaultModelId,
    fingerprint,
    models: normalizeGeminiDiscoveredModels(value.models),
    refreshedAt,
  };
}

export function getGeminiProviderSettings(
  settings: Record<string, unknown>,
): GeminiProviderSettings {
  const config = getProviderConfig(settings, 'gemini');
  const currentHostKey = getInstallationKey();
  const cliPathsByHost = normalizeHostnameStringMap(config.cliPathsByHost);
  const catalogsByHost = normalizeGeminiCatalogsByHost(config.catalogsByHost ?? config.selectedModelsByHost);
  const currentCatalog = catalogsByHost[currentHostKey] ?? null;
  const selectedModelIds = collectSelectedGeminiRawModelIds(settings);
  const catalogModels = currentCatalog?.models ?? [];
  const allowedModelIds = new Set(catalogModels.map(model => model.rawId));
  for (const id of normalizeGeminiVisibleModels(config.visibleModels) ?? []) allowedModelIds.add(id);
  for (const modelId of selectedModelIds) {
    allowedModelIds.add(modelId);
  }

  const visibleModels = normalizeGeminiVisibleModels(
    config.visibleModels,
    allowedModelIds,
    catalogModels.length > 0,
  );
  const enabledModelIds = new Set(
    visibleModels ?? catalogModels.map(model => model.rawId),
  );

  return {
    catalogsByHost,
    cliPath: readTrimmedString(config.cliPath)
      || DEFAULT_GEMINI_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    currentCatalog,
    enabled: typeof config.enabled === 'boolean'
      ? config.enabled
      : DEFAULT_GEMINI_PROVIDER_SETTINGS.enabled,
    environmentHash: readTrimmedString(config.environmentHash),
    environmentVariables: typeof config.environmentVariables === 'string'
      ? config.environmentVariables
      : getProviderEnvironmentVariables(settings, 'gemini')
        ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.environmentVariables,
    modelAliases: normalizeGeminiModelAliases(
      config.modelAliases,
      allowedModelIds,
      catalogModels.length > 0,
    ),
    preferredReasoningByModel: normalizeGeminiPreferredReasoningByModel(
      config.preferredReasoningByModel,
      enabledModelIds,
      catalogModels,
      true,
    ),
    visibleModels,
  };
}

export function updateGeminiProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedGeminiProviderSettings>,
): GeminiProviderSettings {
  const current = getGeminiProviderSettings(settings);
  const currentHostKey = getInstallationKey();
  const cliPathsByHost = updates.cliPathsByHost !== undefined
    ? normalizeHostnameStringMap(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let cliPath = updates.cliPathsByHost !== undefined
    ? readTrimmedString(updates.cliPath)
    : current.cliPath;

  if ('cliPath' in updates && updates.cliPathsByHost === undefined) {
    const hostCliPath = readTrimmedString(updates.cliPath);
    if (hostCliPath) {
      cliPathsByHost[currentHostKey] = hostCliPath;
    } else {
      delete cliPathsByHost[currentHostKey];
    }
    cliPath = DEFAULT_GEMINI_PROVIDER_SETTINGS.cliPath;
  }

  const catalogsByHost = updates.catalogsByHost !== undefined
    ? normalizeGeminiCatalogsByHost(updates.catalogsByHost)
    : { ...current.catalogsByHost };
  const currentCatalog = catalogsByHost[currentHostKey] ?? null;
  const catalogModels = currentCatalog?.models ?? [];
  const allowedModelIds = new Set(catalogModels.map(model => model.rawId));
  for (const id of normalizeGeminiVisibleModels(updates.visibleModels ?? current.visibleModels) ?? []) allowedModelIds.add(id);
  for (const modelId of collectSelectedGeminiRawModelIds(settings)) {
    allowedModelIds.add(modelId);
  }
  const hasCatalog = catalogModels.length > 0;
  const visibleModels = normalizeGeminiVisibleModels(
    updates.visibleModels === undefined ? current.visibleModels : updates.visibleModels,
    allowedModelIds,
    hasCatalog,
  );
  const enabledModelIds = new Set(
    visibleModels ?? catalogModels.map(model => model.rawId),
  );

  const next: PersistedGeminiProviderSettings = {
    catalogsByHost,
    cliPath,
    cliPathsByHost,
    enabled: updates.enabled ?? current.enabled,
    environmentHash: updates.environmentHash !== undefined
      ? readTrimmedString(updates.environmentHash)
      : current.environmentHash,
    environmentVariables: updates.environmentVariables ?? current.environmentVariables,
    modelAliases: normalizeGeminiModelAliases(
      updates.modelAliases ?? current.modelAliases,
      allowedModelIds,
      hasCatalog,
    ),
    preferredReasoningByModel: normalizeGeminiPreferredReasoningByModel(
      updates.preferredReasoningByModel ?? current.preferredReasoningByModel,
      enabledModelIds,
      catalogModels,
      true,
    ),
    visibleModels,
  };

  setProviderConfig(settings, 'gemini', next as unknown as Record<string, unknown>);
  return { ...next, currentCatalog };
}

export function getCurrentGeminiCatalog(
  settings: Record<string, unknown>,
): GeminiCatalogSnapshot | null {
  return getGeminiProviderSettings(settings).currentCatalog;
}

export function updateCurrentGeminiCatalog(
  settings: Record<string, unknown>,
  snapshot: GeminiCatalogSnapshot,
): GeminiCatalogSnapshot | null {
  const normalized = normalizeGeminiCatalogSnapshot(snapshot);
  if (!normalized) {
    return null;
  }
  const current = getGeminiProviderSettings(settings);
  updateGeminiProviderSettings(settings, {
    catalogsByHost: {
      ...current.catalogsByHost,
      [getInstallationKey()]: normalized,
    },
  });
  return normalized;
}

export function normalizeGeminiVisibleModels(
  value: unknown,
  allowedModelIds: ReadonlySet<string> = new Set(),
  _restrictToAllowed = allowedModelIds.size > 0,
): string[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const rawModelId = normalizeRawModelId(entry);
    if (!rawModelId || seen.has(rawModelId)) {
      continue;
    }
    seen.add(rawModelId);
    normalized.push(rawModelId);
  }
  return normalized;
}

export function normalizeGeminiModelAliases(
  value: unknown,
  allowedModelIds: ReadonlySet<string> = new Set(),
  restrictToAllowed = allowedModelIds.size > 0,
): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [modelId, aliasValue] of Object.entries(value)) {
    const rawModelId = normalizeRawModelId(modelId);
    const alias = readTrimmedString(aliasValue);
    if (
      !rawModelId
      || !alias
      || (restrictToAllowed && !allowedModelIds.has(rawModelId))
    ) {
      continue;
    }
    normalized[rawModelId] = alias;
  }
  return normalized;
}

export function normalizeGeminiPreferredReasoningByModel(
  value: unknown,
  allowedModelIds: ReadonlySet<string> = new Set(),
  catalogModels: GeminiDiscoveredModel[] = [],
  restrictToAllowed = catalogModels.length > 0,
): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const catalogById = new Map(catalogModels.map(model => [model.rawId, model] as const));
  const normalized: Record<string, string> = {};
  for (const [modelId, effortValue] of Object.entries(value)) {
    const rawModelId = normalizeRawModelId(modelId);
    const effort = readTrimmedString(effortValue);
    if (
      !rawModelId
      || !effort
      || (restrictToAllowed && !allowedModelIds.has(rawModelId))
    ) {
      continue;
    }

    const catalogModel = catalogById.get(rawModelId);
    if (catalogModel?.reasoningMetadataResolved === true
      && !getGeminiAvailableReasoningEfforts(catalogModel).some(option => option.value === effort)) {
      continue;
    }
    normalized[rawModelId] = effort;
  }
  return normalized;
}

function normalizeGeminiCatalogsByHost(
  value: unknown,
): Record<string, GeminiCatalogSnapshot> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, GeminiCatalogSnapshot> = {};
  for (const [hostKey, snapshot] of Object.entries(value)) {
    const normalizedHostKey = hostKey.trim();
    const normalizedSnapshot = normalizeGeminiCatalogSnapshot(snapshot);
    if (normalizedHostKey && normalizedSnapshot) {
      normalized[normalizedHostKey] = normalizedSnapshot;
    }
  }
  return normalized;
}

function collectSelectedGeminiRawModelIds(settings: Record<string, unknown>): Set<string> {
  const selected = new Set<string>();
  addSelectedGeminiRawModelId(selected, settings.model);
  addSelectedGeminiRawModelId(selected, settings.titleGenerationModel);

  if (isRecord(settings.savedProviderModel)) {
    addSelectedGeminiRawModelId(selected, settings.savedProviderModel.gemini);
  }
  return selected;
}

function addSelectedGeminiRawModelId(target: Set<string>, value: unknown): void {
  if (typeof value !== 'string') {
    return;
  }
  const rawModelId = decodeGeminiModelId(value.trim());
  if (rawModelId) {
    target.add(rawModelId);
  }
}

function normalizeRawModelId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return decodeGeminiModelId(normalized) ?? normalized;
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function projectGeminiModelSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const current = getGeminiProviderSettings(settings);
  const visibleModels = getGeminiMigratedVisibleModelIds(current);
  const selected = new Set(visibleModels);
  const selectedModelsByHost = Object.fromEntries(Object.entries(current.catalogsByHost).map(([host, catalog]) => [host, {
    ...catalog,
    models: catalog.models.filter(model => selected.has(model.rawId)),
    defaultModelId: catalog.defaultModelId && selected.has(catalog.defaultModelId) ? catalog.defaultModelId : null,
  }]));
  const config: Record<string, unknown> = {
    ...getProviderConfig(settings, 'gemini'),
    visibleModels,
    selectedModelsByHost,
    modelAliases: selectModelMetadata(current.modelAliases, selected),
    preferredReasoningByModel: selectModelMetadata(current.preferredReasoningByModel, selected),
  };
  delete config.catalogsByHost;
  delete config.currentCatalog;
  return config;
}

export function getGeminiMigratedVisibleModelIds(current: GeminiProviderSettings): string[] {
  return current.visibleModels ?? [...new Set([
    ...getOrderedGeminiVisibleModelIds(current),
    ...Object.values(current.catalogsByHost).flatMap(catalog => catalog.models.map(model => model.rawId)),
  ])];
}
