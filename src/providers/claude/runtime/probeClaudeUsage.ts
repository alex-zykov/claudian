import type {
  Query,
  SDKControlGetUsageResponse,
} from '@anthropic-ai/claude-agent-sdk';

import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ProviderSubscriptionUsageWindow } from '../../../core/providers/types';
import { throwIfAborted, toAbortError } from '../../../utils/abort';
import { getVaultPath } from '../../../utils/path';
import { loadClaudeAgentQuery } from '../loadClaudeAgentSDK';
import { getClaudeProviderSettings } from '../settings';
import { buildClaudeLaunchOptions } from './probeClaudeRuntime';

const PROBE_CANCELLED = 'Claude Code usage discovery cancelled';
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_MCP_TIMEOUT_MS = '5000';

function clampPercent(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Normalizes Claude Code's control usage response into the two status bar windows (5h and weekly). */
export function normalizeClaudeSubscriptionUsage(
  usage: SDKControlGetUsageResponse | null | undefined,
): readonly [ProviderSubscriptionUsageWindow, ProviderSubscriptionUsageWindow] | null {
  if (!usage?.rate_limits_available || !usage.rate_limits) {
    return null;
  }
  const { five_hour: fiveHour, seven_day: sevenDay } = usage.rate_limits;
  if (!fiveHour && !sevenDay) {
    return null;
  }
  return [
    {
      id: 'five_hour',
      labelKey: 'statusBar.usage.claude.fiveHour',
      percentUsed: clampPercent(fiveHour?.utilization),
      resetsAt: fiveHour?.resets_at ?? null,
    },
    {
      id: 'seven_day',
      labelKey: 'statusBar.usage.claude.weekly',
      percentUsed: clampPercent(sevenDay?.utilization),
      resetsAt: sevenDay?.resets_at ?? null,
    },
  ];
}

/**
 * Queries Claude Code's subscription rate-limit utilization without persisting
 * a session or running an inference turn.
 */
export async function probeClaudeUsage(
  host: ProviderHost,
  signal?: AbortSignal,
): Promise<readonly [ProviderSubscriptionUsageWindow, ProviderSubscriptionUsageWindow] | null> {
  throwIfAborted(signal, PROBE_CANCELLED);
  const controller = new AbortController();
  const cancel = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = window.setTimeout(
    () => controller.abort(new Error('Claude Code usage discovery timed out')),
    PROBE_TIMEOUT_MS,
  );
  let conversation: Query | undefined;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(toAbortError(controller.signal, PROBE_CANCELLED));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });

  const queryUsage = async (): Promise<
    readonly [ProviderSubscriptionUsageWindow, ProviderSubscriptionUsageWindow] | null
  > => {
    const cwd = getVaultPath(host.app);
    if (!cwd) return null;
    const cliPath = await host.getResolvedProviderCliPath('claude');
    throwIfAborted(controller.signal, PROBE_CANCELLED);
    if (!cliPath) return null;
    const agentQuery = await loadClaudeAgentQuery();
    throwIfAborted(controller.signal, PROBE_CANCELLED);
    const config = getClaudeProviderSettings(host.settings);
    const extraArgs = {
      'enable-auto-mode': null,
      ...(config.enableChrome ? { chrome: null } : {}),
    };
    conversation = agentQuery({
      prompt: '',
      options: {
        ...buildClaudeLaunchOptions(host, cwd, cliPath, {
          envDefaults: { MCP_TIMEOUT: PROBE_MCP_TIMEOUT_MS },
        }),
        extraArgs,
        abortController: controller,
        maxTurns: 1,
        persistSession: false,
      },
    });
    if (typeof conversation.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !== 'function') {
      return null;
    }
    const response = await conversation.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    });
    return normalizeClaudeSubscriptionUsage(response);
  };

  try {
    return await Promise.race([queryUsage(), aborted]);
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
    controller.abort();
    conversation?.close();
  }
}
