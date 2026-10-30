import { getInstallationKey } from '@/core/device/InstallationKey';

import { selectModelMetadata } from '../../core/providers/models/selectedModelMetadata';
import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import type { HostnameCLIPaths } from '../../core/types/settings';
import {
  type CursorDiscoveredModel,
  decodeCursorModelId,
  getCursorAvailableReasoningEfforts,
  normalizeCursorDiscoveredModels,
} from './models';

export interface CursorCatalogSnapshot {
  models: CursorDiscoveredModel[];
  defaultModelId: string | null;
  fingerprint: string;
  refreshedAt: number;
}

export interface PersistedCursorProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCLIPaths;
  catalogsByHost: Record<string, CursorCatalogSnapshot>;
  environmentVariables: string;
  environmentHash: string;
  visibleModels: string[] | null;
  modelAliases: Record<string, string>;
  preferredReasoningByModel: Record<string, string>;
}

export interface CursorProviderSettings extends PersistedCursorProviderSettings {
  currentCatalog: CursorCatalogSnapshot | null;
}

export const DEFAULT_CURSOR_PROVIDER_SETTINGS: Readonly<PersistedCursorProviderSettings> = Object.freeze({
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

export function getOrderedCursorVisibleModelIds(
  settings: CursorProviderSettings,
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

export function normalizeCursorCatalogSnapshot(value: unknown): CursorCatalogSnapshot | null {
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
    models: normalizeCursorDiscoveredModels(value.models),
    refreshedAt,
  };
}

export function getCursorProviderSettings(
  settings: Record<string, unknown>,
): CursorProviderSettings {
  const config = getProviderConfig(settings, 'cursor');
  const currentHostKey = getInstallationKey();
  const cliPathsByHost = normalizeHostnameStringMap(config.cliPathsByHost);
  const catalogsByHost = normalizeCursorCatalogsByHost(config.catalogsByHost ?? config.selectedModelsByHost);
  const currentCatalog = catalogsByHost[currentHostKey] ?? null;
  const selectedModelIds = collectSelectedCursorRawModelIds(settings);
  const catalogModels = currentCatalog?.models ?? [];
  const allowedModelIds = new Set(catalogModels.map(model => model.rawId));
  for (const id of normalizeCursorVisibleModels(config.visibleModels) ?? []) allowedModelIds.add(id);
  for (const modelId of selectedModelIds) {
    allowedModelIds.add(modelId);
  }

  const visibleModels = normalizeCursorVisibleModels(
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
      || DEFAULT_CURSOR_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    currentCatalog,
    enabled: typeof config.enabled === 'boolean'
      ? config.enabled
      : DEFAULT_CURSOR_PROVIDER_SETTINGS.enabled,
    environmentHash: readTrimmedString(config.environmentHash),
    environmentVariables: typeof config.environmentVariables === 'string'
      ? config.environmentVariables
      : getProviderEnvironmentVariables(settings, 'cursor')
        ?? DEFAULT_CURSOR_PROVIDER_SETTINGS.environmentVariables,
    modelAliases: normalizeCursorModelAliases(
      config.modelAliases,
      allowedModelIds,
      catalogModels.length > 0,
    ),
    preferredReasoningByModel: normalizeCursorPreferredReasoningByModel(
      config.preferredReasoningByModel,
      enabledModelIds,
      catalogModels,
      true,
    ),
    visibleModels,
  };
}

export function updateCursorProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedCursorProviderSettings>,
): CursorProviderSettings {
  const current = getCursorProviderSettings(settings);
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
    cliPath = DEFAULT_CURSOR_PROVIDER_SETTINGS.cliPath;
  }

  const catalogsByHost = updates.catalogsByHost !== undefined
    ? normalizeCursorCatalogsByHost(updates.catalogsByHost)
    : { ...current.catalogsByHost };
  const currentCatalog = catalogsByHost[currentHostKey] ?? null;
  const catalogModels = currentCatalog?.models ?? [];
  const allowedModelIds = new Set(catalogModels.map(model => model.rawId));
  for (const id of normalizeCursorVisibleModels(updates.visibleModels ?? current.visibleModels) ?? []) allowedModelIds.add(id);
  for (const modelId of collectSelectedCursorRawModelIds(settings)) {
    allowedModelIds.add(modelId);
  }
  const hasCatalog = catalogModels.length > 0;
  const visibleModels = normalizeCursorVisibleModels(
    updates.visibleModels === undefined ? current.visibleModels : updates.visibleModels,
    allowedModelIds,
    hasCatalog,
  );
  const enabledModelIds = new Set(
    visibleModels ?? catalogModels.map(model => model.rawId),
  );

  const next: PersistedCursorProviderSettings = {
    catalogsByHost,
    cliPath,
    cliPathsByHost,
    enabled: updates.enabled ?? current.enabled,
    environmentHash: updates.environmentHash !== undefined
      ? readTrimmedString(updates.environmentHash)
      : current.environmentHash,
    environmentVariables: updates.environmentVariables ?? current.environmentVariables,
    modelAliases: normalizeCursorModelAliases(
      updates.modelAliases ?? current.modelAliases,
      allowedModelIds,
      hasCatalog,
    ),
    preferredReasoningByModel: normalizeCursorPreferredReasoningByModel(
      updates.preferredReasoningByModel ?? current.preferredReasoningByModel,
      enabledModelIds,
      catalogModels,
      true,
    ),
    visibleModels,
  };

  setProviderConfig(settings, 'cursor', next as unknown as Record<string, unknown>);
  return { ...next, currentCatalog };
}

export function getCurrentCursorCatalog(
  settings: Record<string, unknown>,
): CursorCatalogSnapshot | null {
  return getCursorProviderSettings(settings).currentCatalog;
}

export function updateCurrentCursorCatalog(
  settings: Record<string, unknown>,
  snapshot: CursorCatalogSnapshot,
): CursorCatalogSnapshot | null {
  const normalized = normalizeCursorCatalogSnapshot(snapshot);
  if (!normalized) {
    return null;
  }
  const current = getCursorProviderSettings(settings);
  updateCursorProviderSettings(settings, {
    catalogsByHost: {
      ...current.catalogsByHost,
      [getInstallationKey()]: normalized,
    },
  });
  return normalized;
}

export function normalizeCursorVisibleModels(
  value: unknown,
  allowedModelIds: ReadonlySet<string> = new Set(),
  restrictToAllowed = allowedModelIds.size > 0,
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
    if (
      !rawModelId
      || seen.has(rawModelId)
    ) {
      continue;
    }
    seen.add(rawModelId);
    normalized.push(rawModelId);
  }
  return normalized;
}

export function normalizeCursorModelAliases(
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

export function normalizeCursorPreferredReasoningByModel(
  value: unknown,
  allowedModelIds: ReadonlySet<string> = new Set(),
  catalogModels: CursorDiscoveredModel[] = [],
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
      && !getCursorAvailableReasoningEfforts(catalogModel).some(option => option.value === effort)) {
      continue;
    }
    normalized[rawModelId] = effort;
  }
  return normalized;
}

function normalizeCursorCatalogsByHost(
  value: unknown,
): Record<string, CursorCatalogSnapshot> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, CursorCatalogSnapshot> = {};
  for (const [hostKey, snapshot] of Object.entries(value)) {
    const normalizedHostKey = hostKey.trim();
    const normalizedSnapshot = normalizeCursorCatalogSnapshot(snapshot);
    if (normalizedHostKey && normalizedSnapshot) {
      normalized[normalizedHostKey] = normalizedSnapshot;
    }
  }
  return normalized;
}

function collectSelectedCursorRawModelIds(settings: Record<string, unknown>): Set<string> {
  const selected = new Set<string>();
  addSelectedCursorRawModelId(selected, settings.model);
  addSelectedCursorRawModelId(selected, settings.titleGenerationModel);

  if (isRecord(settings.savedProviderModel)) {
    addSelectedCursorRawModelId(selected, settings.savedProviderModel.cursor);
  }
  return selected;
}

function addSelectedCursorRawModelId(target: Set<string>, value: unknown): void {
  if (typeof value !== 'string') {
    return;
  }
  const rawModelId = decodeCursorModelId(value.trim());
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
  return decodeCursorModelId(normalized) ?? normalized;
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function projectCursorModelSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const current = getCursorProviderSettings(settings);
  const visibleModels = getCursorMigratedVisibleModelIds(current);
  const selected = new Set(visibleModels);
  const selectedModelsByHost = Object.fromEntries(Object.entries(current.catalogsByHost).map(([host, catalog]) => [host, {
    ...catalog,
    models: catalog.models.filter(model => selected.has(model.rawId)),
    defaultModelId: catalog.defaultModelId && selected.has(catalog.defaultModelId) ? catalog.defaultModelId : null,
  }]));
  const config: Record<string, unknown> = {
    ...getProviderConfig(settings, 'cursor'),
    visibleModels,
    selectedModelsByHost,
    modelAliases: selectModelMetadata(current.modelAliases, selected),
    preferredReasoningByModel: selectModelMetadata(current.preferredReasoningByModel, selected),
  };
  delete config.catalogsByHost;
  delete config.currentCatalog;
  return config;
}

export function getCursorMigratedVisibleModelIds(current: CursorProviderSettings): string[] {
  return current.visibleModels ?? [...new Set([
    ...getOrderedCursorVisibleModelIds(current),
    ...Object.values(current.catalogsByHost).flatMap(catalog => catalog.models.map(model => model.rawId)),
  ])];
}
