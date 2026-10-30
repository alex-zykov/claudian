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
  type CursorDiscoveredModel,
  normalizeCursorDiscoveredModels,
} from '../models';
import { getCursorProviderSettings } from '../settings';
import { buildCursorRuntimeEnv } from './CursorRuntimeEnvironment';

const FINGERPRINT_VERSION = '1';
const MODEL_COMMAND_TIMEOUT_MS = 20_000;
const VERSION_COMMAND_TIMEOUT_MS = 5_000;
const MAX_STDOUT_BYTES = 512 * 1024;
const spawn = crossSpawn as typeof nodeSpawn;
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'g',
);

export interface CursorCatalogCommandRequest {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface CursorCatalogCommandResult {
  exitCode: number | null;
  stdout: string;
  termination?: 'abort' | 'error' | 'output-limit' | 'timeout';
}

export interface CursorCatalogCommandRunner {
  run(request: CursorCatalogCommandRequest): Promise<CursorCatalogCommandResult>;
}

export type CursorModelCatalogDiscoveryResult =
  | {
    defaultModelId: string | null;
    diagnostics?: string;
    fingerprint: string;
    kind: 'completed';
    models: CursorDiscoveredModel[];
  }
  | {
    kind: 'skipped';
    reason: 'provider-disabled';
  };

export interface CursorModelDiscoveryServiceLike {
  discoverCatalog(
    signal?: AbortSignal,
    context?: ProviderTransitionOwnerContext,
  ): Promise<CursorModelCatalogDiscoveryResult>;
}

export interface CursorModelDiscoveryServiceOptions {
  modelCommandTimeoutMs?: number;
  runner?: CursorCatalogCommandRunner;
  versionCommandTimeoutMs?: number;
}

export interface CursorCatalogFingerprintInputs {
  command: string;
  environmentKeys: string[];
  version: string;
}

/**
 * Discovers models through `agent --list-models` without creating an ACP session.
 * Live session/new models still merge through the catalog coordinator.
 */
export function buildCursorCatalogFingerprint(inputs: CursorCatalogFingerprintInputs): string {
  const payload = [
    FINGERPRINT_VERSION,
    inputs.command.trim(),
    inputs.version.trim(),
    Array.from(new Set(inputs.environmentKeys.map(key => key.trim()).filter(Boolean))).sort(),
  ];
  return `${FINGERPRINT_VERSION}:${createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')}`;
}

export class CursorModelDiscoveryService implements CursorModelDiscoveryServiceLike {
  private readonly modelCommandTimeoutMs: number;
  private readonly runner: CursorCatalogCommandRunner;
  private readonly versionCommandTimeoutMs: number;

  constructor(
    private readonly plugin: ProviderHost,
    options: CursorModelDiscoveryServiceOptions = {},
  ) {
    this.modelCommandTimeoutMs = options.modelCommandTimeoutMs ?? MODEL_COMMAND_TIMEOUT_MS;
    this.runner = options.runner ?? { run: runCursorCatalogCommand };
    this.versionCommandTimeoutMs = options.versionCommandTimeoutMs ?? VERSION_COMMAND_TIMEOUT_MS;
  }

  async discoverCatalog(
    signal?: AbortSignal,
    _context?: ProviderTransitionOwnerContext,
  ): Promise<CursorModelCatalogDiscoveryResult> {
    if (!getCursorProviderSettings(this.plugin.settings).enabled) {
      return { kind: 'skipped', reason: 'provider-disabled' };
    }

    const command = await this.plugin.getResolvedProviderCliPath('cursor') ?? 'agent';
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildCursorRuntimeEnv(this.plugin.settings, command);
    const environmentKeys = Object.keys(env).filter(key => /^CURSOR_/i.test(key)).sort();

    const versionResult = await this.runner.run({
      args: ['--version'],
      command,
      cwd,
      env,
      signal,
      timeoutMs: this.versionCommandTimeoutMs,
    });
    const version = scrub(versionResult.stdout).split('\n')[0]?.trim() || 'unknown';

    const listResult = await this.runner.run({
      args: ['--list-models'],
      command,
      cwd,
      env,
      signal,
      timeoutMs: this.modelCommandTimeoutMs,
    });

    if (listResult.termination === 'abort' || signal?.aborted) {
      throw new Error('Cursor model discovery was cancelled.');
    }

    const stdout = scrub(listResult.stdout);
    if (listResult.exitCode !== 0) {
      const diagnostics = stdout || listResult.termination || `exit ${listResult.exitCode}`;
      if (/authentication required|not logged in|agent login/i.test(diagnostics)) {
        throw new Error(
          'Cursor is not authenticated. Run `agent login` or set CURSOR_API_KEY / CURSOR_AUTH_TOKEN, then retry.',
        );
      }
      throw new Error(`Cursor model discovery failed: ${diagnostics}`);
    }

    const parsed = parseCursorListModelsOutput(stdout);
    const fingerprint = buildCursorCatalogFingerprint({
      command,
      environmentKeys,
      version,
    });

    return {
      defaultModelId: parsed.defaultModelId,
      fingerprint,
      kind: 'completed',
      models: parsed.models,
      ...(parsed.diagnostics ? { diagnostics: parsed.diagnostics } : {}),
    };
  }
}

export function parseCursorListModelsOutput(stdout: string): {
  defaultModelId: string | null;
  diagnostics?: string;
  models: CursorDiscoveredModel[];
} {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { defaultModelId: null, models: [] };
  }

  try {
    const json = JSON.parse(trimmed) as unknown;
    if (Array.isArray(json)) {
      const models = normalizeCursorDiscoveredModels(json.flatMap(entry => {
        if (!isRecord(entry)) return [];
        const rawId = readString(entry.id ?? entry.modelId);
        if (!rawId) return [];
        return [{
          displayName: readString(entry.name ?? entry.displayName) ?? rawId,
          rawId,
          ...(readString(entry.description) ? { description: readString(entry.description)! } : {}),
        }];
      }));
      return { defaultModelId: models[0]?.rawId ?? null, models };
    }
    if (isRecord(json) && Array.isArray(json.models)) {
      const models = normalizeCursorDiscoveredModels(json.models);
      const defaultModelId = readString(json.defaultModelId ?? json.defaultModel)
        ?? models[0]?.rawId
        ?? null;
      return { defaultModelId, models };
    }
  } catch {
    // Fall through to line parsing.
  }

  const models: CursorDiscoveredModel[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(/^\s*([^\s]+)\s*(?:-|:)?\s*(.*)$/);
    if (!match) continue;
    const rawId = match[1].trim();
    if (!rawId || /^(id|model|name)$/i.test(rawId)) continue;
    const displayName = match[2].trim() || rawId;
    models.push({
      displayName,
      rawId,
      reasoningEfforts: [],
      supportsReasoning: false,
    });
  }

  const normalized = normalizeCursorDiscoveredModels(models);
  return {
    defaultModelId: normalized[0]?.rawId ?? null,
    models: normalized,
    ...(normalized.length === 0 ? { diagnostics: 'No models parsed from `agent --list-models`.' } : {}),
  };
}

async function runCursorCatalogCommand(
  request: CursorCatalogCommandRequest,
): Promise<CursorCatalogCommandResult> {
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
    const finish = (result: CursorCatalogCommandResult): void => {
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

function scrub(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCE, '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
