import {
  GeminiModelDiscoveryService,
  parseGeminiListModelsOutput,
} from '@/providers/gemini/runtime/GeminiModelDiscoveryService';

describe('GeminiModelDiscoveryService', () => {
  it('discovers live models from agy models output and groups reasoning efforts', async () => {
    const runner = {
      run: jest.fn(async ({ args }: { args: string[] }) => {
        if (args[0] === '--version') {
          return { exitCode: 0, stdout: 'Antigravity CLI 0.1.32\n' };
        }
        return {
          exitCode: 0,
          stdout: [
            '\r⠋ Fetching available models...\r                              \rgemini-4-argon-high       Gemini 4 Argon (High)',
            'gemini-4-argon-medium     Gemini 4 Argon (Medium)',
            'gemini-4-argon-low        Gemini 4 Argon (Low)',
            'gemini-3.8-flash-high     Gemini 3.8 Flash (High)',
            'gemini-3.8-flash-medium   Gemini 3.8 Flash (Medium)',
            'gemini-3.8-flash-low      Gemini 3.8 Flash (Low)',
            'gemini-3.1-pro-low        Gemini 3.1 Pro (Low)',
            'gemini-3.1-pro-high       Gemini 3.1 Pro (High)',
          ].join('\n'),
        };
      }),
    };
    const service = new GeminiModelDiscoveryService({
      getResolvedProviderCliPath: async () => '/usr/local/bin/agy',
      settings: {
        providerConfigs: {
          gemini: { enabled: true },
        },
      },
    } as never, { runner });

    const result = await service.discoverCatalog();

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') {
      throw new Error('Expected completed discovery result');
    }
    expect(result.defaultModelId).toBe('gemini-4-argon');
    expect(result.models.map(model => ({
      defaultReasoningEffort: model.defaultReasoningEffort,
      displayName: model.displayName,
      efforts: model.reasoningEfforts.map(e => e.value),
      rawId: model.rawId,
      supportsReasoning: model.supportsReasoning,
    }))).toEqual([
      {
        defaultReasoningEffort: 'high',
        displayName: 'Gemini 4 Argon',
        efforts: ['low', 'medium', 'high'],
        rawId: 'gemini-4-argon',
        supportsReasoning: true,
      },
      {
        defaultReasoningEffort: 'high',
        displayName: 'Gemini 3.8 Flash',
        efforts: ['low', 'medium', 'high'],
        rawId: 'gemini-3.8-flash',
        supportsReasoning: true,
      },
      {
        defaultReasoningEffort: 'high',
        displayName: 'Gemini 3.1 Pro',
        efforts: ['low', 'high'],
        rawId: 'gemini-3.1-pro',
        supportsReasoning: true,
      },
    ]);
  });

  it('parses spinner frames and variant suffixes in parseGeminiListModelsOutput', () => {
    const parsed = parseGeminiListModelsOutput(
      '\r⠋ Fetching available models...\rgemini-4-argon-high       Gemini 4 Argon (High)\ngemini-4-argon-low        Gemini 4 Argon (Low)\n',
    );
    expect(parsed.defaultModelId).toBe('gemini-4-argon');
    expect(parsed.models[0]?.displayName).toBe('Gemini 4 Argon');
    expect(parsed.models[0]?.reasoningEfforts.map(e => e.value)).toEqual(['low', 'high']);
  });

  it('reports diagnostics when the agy CLI cannot be resolved', async () => {
    const service = new GeminiModelDiscoveryService({
      getResolvedProviderCliPath: async () => null,
      settings: {
        providerConfigs: {
          gemini: { enabled: true },
        },
      },
    } as never);

    const result = await service.discoverCatalog();

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') {
      throw new Error('Expected completed discovery result');
    }
    expect(result.models).toEqual([]);
    expect(result.diagnostics).toContain('agy');
  });
});
