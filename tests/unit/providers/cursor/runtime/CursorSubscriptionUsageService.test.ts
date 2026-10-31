import type { ProviderHost } from '@/core/providers/ProviderHost';
import { CursorSubscriptionUsageService } from '@/providers/cursor/runtime/CursorSubscriptionUsageService';
import { normalizeCursorSubscriptionUsage, probeCursorUsage } from '@/providers/cursor/runtime/probeCursorUsage';

function createHost(environment = ''): ProviderHost {
  return {
    app: {},
    settings: { providerConfigs: { cursor: { enabled: true } } },
    getActiveEnvironmentVariables: () => environment,
  } as unknown as ProviderHost;
}

describe('probeCursorUsage', () => {
  it('fetches current period usage using CURSOR_AUTH_TOKEN and normalizes Auto and API percentages', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        billingCycleStart: '1791307396000',
        billingCycleEnd: '1793985796000',
        planUsage: {
          autoPercentUsed: 12.89,
          apiPercentUsed: 60.2,
          totalPercentUsed: 17.18,
        },
      }),
    });

    const windows = await probeCursorUsage(createHost('CURSOR_AUTH_TOKEN=test-access-token'), undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      readStoredCredentials: async () => ({}),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-access-token',
          'Connect-Protocol-Version': '1',
          'Content-Type': 'application/json',
        }),
        body: '{}',
      }),
    );
    expect(windows).toEqual([
      {
        id: 'auto',
        labelKey: 'statusBar.usage.cursor.autoModels',
        percentUsed: 13,
        resetsAt: new Date(1793985796000).toISOString(),
      },
      {
        id: 'api',
        labelKey: 'statusBar.usage.cursor.apiModels',
        percentUsed: 60,
        resetsAt: new Date(1793985796000).toISOString(),
      },
    ]);
  });

  it('exchanges CURSOR_API_KEY for an access token when no valid access token is present', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'exchanged-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          billingCycleEnd: '1793985796000',
          planUsage: {
            autoPercentUsed: 30,
            apiPercentUsed: 50,
          },
        }),
      });

    const windows = await probeCursorUsage(createHost('CURSOR_API_KEY=crsr_key'), undefined, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      readStoredCredentials: async () => ({}),
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api2.cursor.sh/auth/exchange_user_api_key',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer crsr_key',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer exchanged-token',
        }),
      }),
    );
    expect(windows?.map(w => w.percentUsed)).toEqual([30, 50]);
  });

  it('returns null when planUsage is absent', () => {
    expect(normalizeCursorSubscriptionUsage({})).toBeNull();
  });
});

describe('CursorSubscriptionUsageService', () => {
  it('publishes usage snapshots and marks unavailable when no credentials or plan usage exist', async () => {
    const probe = jest.fn()
      .mockResolvedValueOnce([
        { id: 'auto', labelKey: 'statusBar.usage.cursor.autoModels', percentUsed: 30, resetsAt: null },
        { id: 'api', labelKey: 'statusBar.usage.cursor.apiModels', percentUsed: 50, resetsAt: null },
      ])
      .mockResolvedValueOnce(null);
    const service = new CursorSubscriptionUsageService(createHost(), probe);

    const first = await service.refresh();
    expect(first.status).toBe('ready');
    expect(first.windows.map(w => w.percentUsed)).toEqual([30, 50]);

    const second = await service.refresh();
    expect(second.status).toBe('unavailable');
    expect(second.windows).toEqual([]);

    await service.dispose();
  });
});
