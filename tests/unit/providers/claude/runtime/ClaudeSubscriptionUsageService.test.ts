import type { Options, SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';

import type { ProviderHost } from '@/core/providers/ProviderHost';
import { ClaudeSubscriptionUsageService } from '@/providers/claude/runtime/ClaudeSubscriptionUsageService';
import { normalizeClaudeSubscriptionUsage, probeClaudeUsage } from '@/providers/claude/runtime/probeClaudeUsage';

const mockQuery = jest.fn();
jest.mock('@/providers/claude/loadClaudeAgentSDK', () => ({ loadClaudeAgentQuery: async () => mockQuery }));
jest.mock('@/utils/path', () => ({ ...jest.requireActual('@/utils/path'), getVaultPath: () => '/vault' }));
jest.mock('@/core/process/env', () => ({
  ...jest.requireActual('@/core/process/env'),
  getEnhancedPath: () => '/enhanced/bin',
}));

function createHost(config: Record<string, unknown> = {}, environment = ''): ProviderHost {
  return {
    app: {},
    settings: { model: 'chat-model', providerConfigs: { claude: config } },
    getResolvedProviderCliPath: jest.fn().mockResolvedValue('/bin/claude'),
    getActiveEnvironmentVariables: () => environment,
  } as unknown as ProviderHost;
}

describe('probeClaudeUsage', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('queries Claude Code usage without persisting a session and normalizes 5h and weekly limits', async () => {
    const usageResponse: SDKControlGetUsageResponse = {
      subscription_type: 'pro',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 19.6, resets_at: '2026-11-01T03:00:00Z' },
        seven_day: { utilization: 42.4, resets_at: '2026-11-05T00:00:00Z' },
        seven_day_opus: null,
        seven_day_sonnet: null,
        overage: null,
      },
      overage_settings: null,
      passes_eligibility: null,
      litellm_spend: null,
    } as unknown as SDKControlGetUsageResponse;
    const close = jest.fn();
    const getUsage = jest.fn().mockResolvedValue(usageResponse);
    mockQuery.mockReturnValue({
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: getUsage,
      close,
    });

    const windows = await probeClaudeUsage(createHost());

    expect(getUsage).toHaveBeenCalledWith({ skipBehaviors: true });
    expect(close).toHaveBeenCalledTimes(1);
    const launch = mockQuery.mock.calls[0]?.[0] as { options: Options; prompt: string };
    expect(launch.prompt).toBe('');
    expect(launch.options.persistSession).toBe(false);
    expect(windows).toEqual([
      {
        id: 'five_hour',
        labelKey: 'statusBar.usage.claude.fiveHour',
        percentUsed: 20,
        resetsAt: '2026-11-01T03:00:00Z',
      },
      {
        id: 'seven_day',
        labelKey: 'statusBar.usage.claude.weekly',
        percentUsed: 42,
        resetsAt: '2026-11-05T00:00:00Z',
      },
    ]);
  });

  it('returns null when rate limits are unavailable', () => {
    expect(normalizeClaudeSubscriptionUsage({
      subscription_type: 'api',
      rate_limits_available: false,
      rate_limits: null,
    } as unknown as SDKControlGetUsageResponse)).toBeNull();
  });
});

describe('ClaudeSubscriptionUsageService', () => {
  it('publishes probe snapshots, coalesces concurrent refreshes, and accepts live session updates', async () => {
    let resolveProbe!: (value: ReturnType<typeof normalizeClaudeSubscriptionUsage>) => void;
    const probe = jest.fn(() => new Promise<ReturnType<typeof normalizeClaudeSubscriptionUsage>>(resolve => {
      resolveProbe = resolve;
    }));
    const service = new ClaudeSubscriptionUsageService(createHost(), probe);
    const observed: string[] = [];
    const unsubscribe = service.subscribe(snapshot => {
      observed.push(`${snapshot.status}:${snapshot.windows.map(w => w.percentUsed).join('/')}`);
    });

    const first = service.refresh();
    const second = service.refresh();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().status).toBe('loading');

    resolveProbe([
      { id: 'five_hour', labelKey: 'statusBar.usage.claude.fiveHour', percentUsed: 15, resetsAt: null },
      { id: 'seven_day', labelKey: 'statusBar.usage.claude.weekly', percentUsed: 35, resetsAt: '2026-11-05T00:00:00Z' },
    ]);

    const snapshot = await Promise.all([first, second]);
    expect(snapshot[0].status).toBe('ready');
    expect(snapshot[0].windows.map(w => w.percentUsed)).toEqual([15, 35]);

    service.publishUsage({
      subscription_type: 'pro',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 25, resets_at: null },
        seven_day: { utilization: 40, resets_at: '2026-11-05T00:00:00Z' },
      },
    } as unknown as SDKControlGetUsageResponse);

    expect(service.getSnapshot().windows.map(w => w.percentUsed)).toEqual([25, 40]);
    expect(observed).toEqual(['loading:', 'ready:15/35', 'ready:25/40']);

    unsubscribe();
    await service.dispose();
  });
});
