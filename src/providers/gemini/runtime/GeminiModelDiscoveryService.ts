import type { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import crossSpawn from 'cross-spawn';

import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
} from '@/core/process/windowsCmdShim';

import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ProviderTransitionOwnerContext } from '../../../core/providers/types';
import { getVaultPath } from '../../../utils/path';
import {
  GEMINI_FALLBACK_DISCOVERED_MODELS,
  type GeminiDiscoveredModel,
  type GeminiReasoningEffort,
  normalizeGeminiDiscoveredModels,
  sortGeminiReasoningEfforts,
  splitGeminiModelEffortVariant,
} from '../models';
import { getGeminiProviderSettings } from '../settings';
import { buildGeminiRuntimeEnv } from './GeminiRuntimeEnvironment';

const FINGERPRINT_VERSION = '2';
const MODEL_COMMAND_TIMEOUT_MS = 20_000;
const VERSION_COMMAND_TIMEOUT_MS = 5_000;
const MAX_STDOUT_BYTES = 512 * 1024;
const spawn = crossSpawn as typeof nodeSpawn;
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'g',
);

export interface GeminiCatalogCommandRequest {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface GeminiCatalogCommandResult {
  exitCode: number | null;
  stdout: string;
  termination?: 'abort' | 'error' | 'output-limit' | 'timeout';
}

export interface GeminiCatalogCommandRunner {
  run(request: GeminiCatalogCommandRequest): Promise<GeminiCatalogCommandResult>;
}

export type GeminiModelCatalogDiscoveryResult =
  | {
    defaultModelId: string | null;
    diagnostics?: string;
    fingerprint: string;
    kind: 'completed';
    models: GeminiDiscoveredModel[];
  }
  | {
    kind: 'skipped';
    reason: 'provider-disabled';
  };

export interface GeminiModelDiscoveryServiceLike {
  discoverCatalog(
    signal?: AbortSignal,
    context?: ProviderTransitionOwnerContext,
  ): Promise<GeminiModelCatalogDiscoveryResult>;
}

export interface GeminiModelDiscoveryServiceOptions {
  modelCommandTimeoutMs?: number;
  runner?: GeminiCatalogCommandRunner;
  versionCommandTimeoutMs?: number;
}

export interface GeminiCatalogFingerprintInputs {
  command: string;
  environmentKeys: string[];
  version?: string;
}

/**
 * Discovers models through `agy models` without creating an ACP session.
 * Live ACP `session/new` models still merge through the catalog coordinator.
 */
export function buildGeminiCatalogFingerprint(inputs: GeminiCatalogFingerprintInputs): string {
  const payload = [
    FINGERPRINT_VERSION,
    inputs.command.trim(),
    (inputs.version ?? '').trim(),
    Array.from(new Set(inputs.environmentKeys.map(key => key.trim()).filter(Boolean))).sort(),
  ];
  return `${FINGERPRINT_VERSION}:${createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')}`;
}

export class GeminiModelDiscoveryService implements GeminiModelDiscoveryServiceLike {
  private readonly modelCommandTimeoutMs: number;
  private readonly runner: GeminiCatalogCommandRunner;
  private readonly versionCommandTimeoutMs: number;

  constructor(
    private readonly plugin: ProviderHost,
    options: GeminiModelDiscoveryServiceOptions = {},
  ) {
    this.modelCommandTimeoutMs = options.modelCommandTimeoutMs ?? MODEL_COMMAND_TIMEOUT_MS;
    this.runner = options.runner ?? { run: runGeminiCatalogCommand };
    this.versionCommandTimeoutMs = options.versionCommandTimeoutMs ?? VERSION_COMMAND_TIMEOUT_MS;
  }

  async discoverCatalog(
    signal?: AbortSignal,
    _context?: ProviderTransitionOwnerContext,
  ): Promise<GeminiModelCatalogDiscoveryResult> {
    if (!getGeminiProviderSettings(this.plugin.settings).enabled) {
      return { kind: 'skipped', reason: 'provider-disabled' };
    }

    if (signal?.aborted) {
      throw new Error('Gemini model discovery was cancelled.');
    }

    const command = await this.plugin.getResolvedProviderCliPath('gemini');
    if (!command) {
      return {
        defaultModelId: null,
        diagnostics: 'Gemini CLI (`agy`) was not found. Configure the CLI path in settings.',
        fingerprint: buildGeminiCatalogFingerprint({ command: '', environmentKeys: [] }),
        kind: 'completed',
        models: [],
      };
    }

    const cwd = (this.plugin.app ? getVaultPath(this.plugin.app) : null) ?? process.cwd();
    const env = buildGeminiRuntimeEnv(this.plugin.settings, command);
    const environmentKeys = Object.keys(env)
      .filter(key => /^(GEMINI|GOOGLE|ANTIGRAVITY|AGY)_/i.test(key))
      .sort();

    const versionResult = await this.runner.run({
      args: ['--version'],
      command,
      cwd,
      env,
      signal,
      timeoutMs: this.versionCommandTimeoutMs,
    });
    const version = scrubLines(versionResult.stdout)[0] || 'unknown';

    const listResult = await this.runner.run({
      args: ['models'],
      command,
      cwd,
      env,
      signal,
      timeoutMs: this.modelCommandTimeoutMs,
    });

    if (listResult.termination === 'abort' || signal?.aborted) {
      throw new Error('Gemini model discovery was cancelled.');
    }

    const parsed = listResult.exitCode === 0
      ? parseGeminiListModelsOutput(listResult.stdout)
      : { defaultModelId: null, models: [] as GeminiDiscoveredModel[] };

    const models = parsed.models.length > 0
      ? parsed.models
      : GEMINI_FALLBACK_DISCOVERED_MODELS.map(model => ({
        ...model,
        reasoningEfforts: [...model.reasoningEfforts],
      }));
    const defaultModelId = parsed.defaultModelId ?? models[0]?.rawId ?? null;

    return {
      defaultModelId,
      fingerprint: buildGeminiCatalogFingerprint({
        command,
        environmentKeys,
        version,
      }),
      kind: 'completed',
      models,
    };
  }
}

export function parseGeminiListModelsOutput(stdout: string): {
  defaultModelId: string | null;
  diagnostics?: string;
  models: GeminiDiscoveredModel[];
} {
  const lines = scrubLines(stdout);
  if (lines.length === 0) {
    return { defaultModelId: null, models: [] };
  }

  const rawEntries: Array<{ displayName: string; rawId: string }> = [];
  for (const line of lines) {
    if (/fetching available models/i.test(line)) {
      continue;
    }
    const match = line.match(/^([a-z0-9][a-z0-9._-]*)\s{2,}(.+)$/i)
      ?? line.match(/^([a-z0-9][a-z0-9._-]*)\s*(?:-|:)\s*(.+)$/i);
    if (!match) continue;
    const rawId = match[1].trim();
    const displayName = match[2].trim() || rawId;
    if (!rawId || /^(id|model|models|name)$/i.test(rawId)) continue;
    rawEntries.push({ displayName, rawId });
  }

  const grouped = groupGeminiModelEntries(rawEntries);
  return {
    defaultModelId: grouped[0]?.rawId ?? null,
    models: grouped,
    ...(grouped.length === 0 ? { diagnostics: 'No models parsed from `agy models`.' } : {}),
  };
}

export function groupGeminiModelEntries(
  entries: ReadonlyArray<{
    description?: string;
    displayName: string;
    rawId: string;
  }>,
): GeminiDiscoveredModel[] {
  const byBaseId = new Map<string, {
    defaultReasoningEffort?: string;
    description?: string;
    displayName: string;
    efforts: Map<string, GeminiReasoningEffort>;
    rawId: string;
    supportsReasoning: boolean;
  }>();

  for (const entry of entries) {
    const variant = splitGeminiModelEffortVariant(entry.rawId, entry.displayName);
    if (variant) {
      let existing = byBaseId.get(variant.baseRawId);
      if (!existing) {
        existing = {
          defaultReasoningEffort: variant.effort.value,
          ...(entry.description ? { description: entry.description } : {}),
          displayName: variant.baseDisplayName,
          efforts: new Map(),
          rawId: variant.baseRawId,
          supportsReasoning: true,
        };
        byBaseId.set(variant.baseRawId, existing);
      }
      existing.efforts.set(variant.effort.value, variant.effort);
      if (variant.effort.value === 'high') {
        existing.defaultReasoningEffort = 'high';
      }
      continue;
    }

    if (!byBaseId.has(entry.rawId)) {
      byBaseId.set(entry.rawId, {
        ...(entry.description ? { description: entry.description } : {}),
        displayName: entry.displayName || entry.rawId,
        efforts: new Map(),
        rawId: entry.rawId,
        supportsReasoning: false,
      });
    }
  }

  return normalizeGeminiDiscoveredModels(
    Array.from(byBaseId.values()).map((group) => {
      const reasoningEfforts = sortGeminiReasoningEfforts(Array.from(group.efforts.values()));
      return {
        ...(group.defaultReasoningEffort
          ? { defaultReasoningEffort: group.defaultReasoningEffort }
          : {}),
        ...(group.description ? { description: group.description } : {}),
        displayName: group.displayName,
        rawId: group.rawId,
        ...(group.supportsReasoning ? { reasoningMetadataResolved: true } : {}),
        reasoningEfforts,
        supportsReasoning: group.supportsReasoning,
      };
    }),
  );
}

async function runGeminiCatalogCommand(
  request: GeminiCatalogCommandRequest,
): Promise<GeminiCatalogCommandResult> {
  const spawnSpec = resolveWindowsCmdShimSpawnSpec(request);
  return await new Promise((resolve) => {
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: request.cwd,
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let settled = false;
    const finish = (result: GeminiCatalogCommandResult): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const terminate = (): void => {
      terminateSpawnedProcess(child, 'SIGKILL', spawn, spawnSpec);
    };

    const onAbort = (): void => {
      terminate();
      finish({ exitCode: null, stdout, termination: 'abort' });
    };

    const timer = window.setTimeout(() => {
      terminate();
      finish({ exitCode: null, stdout, termination: 'timeout' });
    }, request.timeoutMs);

    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) {
      onAbort();
      return;
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
      if (Buffer.byteLength(stdout, 'utf8') > MAX_STDOUT_BYTES) {
        terminate();
        finish({ exitCode: null, stdout, termination: 'output-limit' });
      }
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.on('error', () => {
      finish({ exitCode: null, stdout, termination: 'error' });
    });
    child.on('close', code => {
      finish({ exitCode: code, stdout });
    });
  });
}

function scrubLines(value: string): string[] {
  const withoutAnsi = value.replace(ANSI_ESCAPE_SEQUENCE, '');
  const cleaned: string[] = [];
  for (const rawLine of withoutAnsi.split('\n')) {
    const afterCarriageReturn = rawLine.split('\r').pop()?.trim() ?? '';
    if (afterCarriageReturn) {
      cleaned.push(afterCarriageReturn);
    }
  }
  return cleaned;
}
