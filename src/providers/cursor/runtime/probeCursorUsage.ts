import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseEnvironmentVariables } from '@/core/process/env';
import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { ProviderSubscriptionUsageWindow } from '@/core/providers/types';

const DEFAULT_CURSOR_API_BASE_URL = 'https://api2.cursor.sh';
const KEYCHAIN_ACCOUNT = 'cursor-user';
const KEYCHAIN_ACCESS_TOKEN_SERVICE = 'cursor-access-token';
const KEYCHAIN_API_KEY_SERVICE = 'cursor-api-key';
const JWT_EXPIRY_BUFFER_MS = 300_000;

export interface CursorStoredCredentials {
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly apiKey?: string;
}

export interface CursorUsageHttpResponse {
  readonly ok: boolean;
  readonly status?: number;
  json(): Promise<unknown>;
}

export type CursorUsageFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<CursorUsageHttpResponse>;

export interface ProbeCursorUsageDeps {
  readonly fetchImpl?: CursorUsageFetch;
  readonly readStoredCredentials?: (env: NodeJS.ProcessEnv) => Promise<CursorStoredCredentials>;
}

function clampPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseBillingCycleEnd(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

/**
 * Normalizes Cursor's `GetCurrentPeriodUsage` response into the two status bar
 * windows: Auto + Composer models and API / all models.
 */
export function normalizeCursorSubscriptionUsage(
  response: unknown,
): readonly [ProviderSubscriptionUsageWindow, ProviderSubscriptionUsageWindow] | null {
  if (!response || typeof response !== 'object') {
    return null;
  }
  const record = response as Record<string, unknown>;
  const planUsage = record.planUsage;
  if (!planUsage || typeof planUsage !== 'object') {
    return null;
  }
  const planRecord = planUsage as Record<string, unknown>;
  if (
    typeof planRecord.autoPercentUsed !== 'number'
    && typeof planRecord.apiPercentUsed !== 'number'
  ) {
    return null;
  }
  const resetsAt = parseBillingCycleEnd(record.billingCycleEnd);
  return [
    {
      id: 'auto',
      labelKey: 'statusBar.usage.cursor.autoModels',
      percentUsed: clampPercent(planRecord.autoPercentUsed),
      resetsAt,
    },
    {
      id: 'api',
      labelKey: 'statusBar.usage.cursor.apiModels',
      percentUsed: clampPercent(planRecord.apiPercentUsed),
      resetsAt,
    },
  ];
}

function isJwtExpiringSoon(token: string, bufferMs = JWT_EXPIRY_BUFFER_MS): boolean {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return false;
  }
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return false;
    }
    return payload.exp * 1000 <= Date.now() + bufferMs;
  } catch {
    return false;
  }
}

function readMacKeychainSecret(service: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/security',
      ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', service, '-w'],
      { timeout: 3_000 },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const trimmed = stdout.trim();
        resolve(trimmed || undefined);
      },
    );
  });
}

function getCursorAuthFileCandidates(env: NodeJS.ProcessEnv): string[] {
  const home = os.homedir();
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Cursor', 'auth.json'));
    candidates.push(path.join(appData, 'cursor', 'auth.json'));
  } else {
    const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, '.config');
    candidates.push(path.join(xdgConfig, 'cursor', 'auth.json'));
    candidates.push(path.join(xdgConfig, 'Cursor', 'auth.json'));
  }
  candidates.push(path.join(home, '.cursor', 'auth.json'));
  return candidates;
}

async function readCursorAuthJson(env: NodeJS.ProcessEnv): Promise<CursorStoredCredentials> {
  for (const filePath of getCursorAuthFileCandidates(env)) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : undefined,
        refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined,
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : undefined,
      };
    } catch {
      // Continue to next candidate path.
    }
  }
  return {};
}

async function defaultReadStoredCredentials(
  env: NodeJS.ProcessEnv,
): Promise<CursorStoredCredentials> {
  let keychainAccessToken: string | undefined;
  let keychainApiKey: string | undefined;
  if (process.platform === 'darwin' && env.AGENT_CLI_CREDENTIAL_STORE !== 'file') {
    [keychainAccessToken, keychainApiKey] = await Promise.all([
      readMacKeychainSecret(KEYCHAIN_ACCESS_TOKEN_SERVICE),
      readMacKeychainSecret(KEYCHAIN_API_KEY_SERVICE),
    ]);
  }
  if (keychainAccessToken || keychainApiKey) {
    return {
      accessToken: keychainAccessToken,
      apiKey: keychainApiKey,
    };
  }
  return readCursorAuthJson(env);
}

function resolveCursorProbeEnv(host: ProviderHost): NodeJS.ProcessEnv {
  const settingsEnv = parseEnvironmentVariables(
    getRuntimeEnvironmentText(host.settings, 'cursor'),
  );
  const hostEnv = parseEnvironmentVariables(
    host.getActiveEnvironmentVariables?.('cursor') ?? '',
  );
  return {
    ...process.env,
    ...settingsEnv,
    ...hostEnv,
  };
}

const defaultCursorUsageFetch: CursorUsageFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const requestFn = parsed.protocol === 'http:' ? http.request : https.request;
    const req = requestFn(
      parsed,
      {
        method: init.method,
        headers: init.headers,
        signal: init.signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(JSON.parse(text) as unknown),
          });
        });
      },
    );
    req.on('error', reject);
    req.write(init.body);
    req.end();
  });

/**
 * Fetches Cursor's current billing period subscription usage using the active
 * Cursor credentials (environment variable, macOS Keychain, or `auth.json`).
 */
export async function probeCursorUsage(
  host: ProviderHost,
  signal?: AbortSignal,
  deps: ProbeCursorUsageDeps = {},
): Promise<readonly [ProviderSubscriptionUsageWindow, ProviderSubscriptionUsageWindow] | null> {
  if (signal?.aborted) {
    return null;
  }
  const fetchImpl = deps.fetchImpl ?? defaultCursorUsageFetch;
  const env = resolveCursorProbeEnv(host);
  const baseUrl = (env.CURSOR_API_BASE_URL || DEFAULT_CURSOR_API_BASE_URL).replace(/\/+$/, '');
  const readCredentials = deps.readStoredCredentials ?? defaultReadStoredCredentials;
  const stored = await readCredentials(env);
  if (signal?.aborted) {
    return null;
  }

  let accessToken = env.CURSOR_AUTH_TOKEN?.trim() || stored.accessToken?.trim();
  const apiKey = env.CURSOR_API_KEY?.trim() || stored.apiKey?.trim();

  if ((!accessToken || isJwtExpiringSoon(accessToken)) && apiKey) {
    const exchangeResponse = await fetchImpl(`${baseUrl}/auth/exchange_user_api_key`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal,
    });
    if (exchangeResponse.ok) {
      const exchanged = (await exchangeResponse.json()) as { accessToken?: unknown };
      if (typeof exchanged?.accessToken === 'string' && exchanged.accessToken.trim()) {
        accessToken = exchanged.accessToken.trim();
      }
    }
  }

  if (!accessToken || signal?.aborted) {
    return null;
  }

  const response = await fetchImpl(
    `${baseUrl}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Connect-Protocol-Version': '1',
        'Content-Type': 'application/json',
        'x-cursor-client-type': 'cli',
        'x-ghost-mode': 'true',
      },
      body: '{}',
      signal,
    },
  );
  if (!response.ok) {
    return null;
  }
  const payload: unknown = await response.json();
  return normalizeCursorSubscriptionUsage(payload);
}
