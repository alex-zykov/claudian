import type {
  ProviderExecutionEvent,
  ProviderExecutionRequest,
  ProviderInteractionPort,
} from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { ACPRequestPermissionRequest } from '@/providers/acp';
import type {
  GeminiExecutionNativeConnection,
  GeminiExecutionNativeCreateOptions,
  GeminiExecutionNativeFactory,
} from '@/providers/gemini/execution/GeminiExecutionBackend';
import { GeminiExecutionSession } from '@/providers/gemini/execution/GeminiExecutionSession';
import {
  updateCurrentGeminiCatalog,
  updateGeminiProviderSettings,
} from '@/providers/gemini/settings';

function createGeminiHostSettings(): Record<string, unknown> {
  const settings: Record<string, unknown> = { providerConfigs: {} };
  updateGeminiProviderSettings(settings, {
    enabled: true,
    visibleModels: ['gemini-4-argon'],
  });
  updateCurrentGeminiCatalog(settings, {
    defaultModelId: 'gemini-4-argon',
    fingerprint: 'fp-1',
    models: [
      {
        displayName: 'Gemini 4 Argon',
        rawId: 'gemini-4-argon',
        reasoningEfforts: [
          { label: 'Low', value: 'low' },
          { label: 'Medium', value: 'medium' },
          { label: 'High', value: 'high' },
        ],
        reasoningMetadataResolved: true,
        supportsReasoning: true,
      },
    ],
    refreshedAt: 1,
  });
  return settings;
}

function createPermissionRequest(
  kind: 'edit' | 'execute' | 'read',
  title: string,
): ACPRequestPermissionRequest {
  return {
    options: [
      { kind: 'allow_once', name: 'Allow once', optionId: 'allow-1' },
      { kind: 'reject_once', name: 'Reject once', optionId: 'reject-1' },
    ],
    sessionId: 'sess-1',
    toolCall: {
      kind,
      rawInput: kind === 'execute' ? { command: 'rm -rf build' } : { path: 'note.md' },
      title,
      toolCallId: 'tool-1',
    },
  };
}

function createExecutionRequest(
  permissionMode: 'autoEdit' | 'default' | 'plan' | 'yolo',
  reasoning = 'medium',
): ProviderExecutionRequest {
  return {
    configuration: {
      model: 'gemini/gemini-4-argon',
      permissionMode,
      reasoning,
      systemInstructions: { kind: 'provider-default' },
    },
    input: [{ text: 'Hello', type: 'text' }],
    signal: new AbortController().signal,
    toolPolicy: { kind: 'unrestricted' },
  };
}

async function collect(events: AsyncIterable<ProviderExecutionEvent>): Promise<ProviderExecutionEvent[]> {
  const collected: ProviderExecutionEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe('GeminiExecutionSession', () => {
  it('resolves model effort variant and skips session/set_mode when modes are not advertised', async () => {
    let capturedOptions: GeminiExecutionNativeCreateOptions | null = null;
    const setModel = jest.fn().mockResolvedValue({});
    const setMode = jest.fn().mockResolvedValue({});
    const requestApproval = jest.fn(async (request: { interactionId: string }) => ({
      decision: 'allow' as const,
      interactionId: request.interactionId,
    }));

    const native: GeminiExecutionNativeConnection = {
      cancel: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      initialize: jest.fn().mockResolvedValue({ protocolVersion: 1 }),
      isAlive: () => true,
      loadSession: jest.fn(),
      newSession: jest.fn().mockResolvedValue({
        models: {
          availableModels: [
            { modelId: 'gemini-4-argon-low', name: 'Gemini 4 Argon (Low)' },
            { modelId: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)' },
            { modelId: 'gemini-4-argon-high', name: 'Gemini 4 Argon (High)' },
          ],
          currentModelId: 'gemini-4-argon-high',
        },
        sessionId: 'sess-1',
      }),
      onClose: () => () => {},
      onNotification: () => () => {},
      prompt: jest.fn().mockImplementation(async () => {
        if (!capturedOptions) throw new Error('Missing native options');
        const editDecision = await capturedOptions.requestPermission(
          createPermissionRequest('edit', 'edit_file'),
        );
        const bashDecision = await capturedOptions.requestPermission(
          createPermissionRequest('execute', 'bash'),
        );
        expect(editDecision).toEqual({
          outcome: { optionId: 'allow-1', outcome: 'selected' },
        });
        expect(bashDecision).toEqual({
          outcome: { optionId: 'allow-1', outcome: 'selected' },
        });
        return { stopReason: 'end_turn', userMessageId: 'msg-1' };
      }),
      setMode,
      setModel,
      shutdown: jest.fn().mockResolvedValue(undefined),
    };

    const nativeFactory: GeminiExecutionNativeFactory = {
      create(options) {
        capturedOptions = options;
        return native;
      },
    };

    const interactionPort: ProviderInteractionPort = {
      askUserQuestion: jest.fn(),
      dismissInteraction: jest.fn(),
      requestApproval,
    };

    const host = {
      getResolvedProviderCliPath: jest.fn().mockResolvedValue('/usr/local/bin/agy'),
      manifest: { version: '1.0.0' },
      settings: createGeminiHostSettings(),
    } as unknown as ProviderHost;

    const session = new GeminiExecutionSession(
      host,
      {
        interactionPort,
        lifecycle: 'persistent',
        nativePersistence: 'enabled',
        vaultWorkingDirectory: '/vault',
      },
      { nativeFactory },
    );

    await collect(session.execute(createExecutionRequest('autoEdit', 'medium')).events);

    expect(session.getSnapshot().invalidation).toBeUndefined();
    expect(setModel).toHaveBeenCalledWith({
      modelId: 'gemini-4-argon-medium',
      sessionId: 'sess-1',
    });
    expect(setMode).not.toHaveBeenCalled();
    // In autoEdit mode, edit_file was auto-approved without prompting interactionPort, while bash prompted interactionPort once.
    expect(requestApproval).toHaveBeenCalledTimes(1);

    await session.dispose();
  });

  it('auto-allows all tools in yolo mode and auto-denies all tools in plan mode', async () => {
    let capturedOptions: GeminiExecutionNativeCreateOptions | null = null;
    const requestApproval = jest.fn();
    let currentDecision: unknown = null;

    const native: GeminiExecutionNativeConnection = {
      cancel: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      initialize: jest.fn().mockResolvedValue({ protocolVersion: 1 }),
      isAlive: () => true,
      loadSession: jest.fn(),
      newSession: jest.fn().mockResolvedValue({
        models: {
          availableModels: [{ modelId: 'gemini-4-argon', name: 'Gemini 4 Argon' }],
          currentModelId: 'gemini-4-argon',
        },
        sessionId: 'sess-1',
      }),
      onClose: () => () => {},
      onNotification: () => () => {},
      prompt: jest.fn().mockImplementation(async () => {
        currentDecision = await capturedOptions!.requestPermission(
          createPermissionRequest('execute', 'bash'),
        );
        return { stopReason: 'end_turn', userMessageId: 'msg-1' };
      }),
      setMode: jest.fn().mockResolvedValue({}),
      setModel: jest.fn().mockResolvedValue({}),
      shutdown: jest.fn().mockResolvedValue(undefined),
    };

    const session = new GeminiExecutionSession(
      {
        getResolvedProviderCliPath: jest.fn().mockResolvedValue('/usr/local/bin/agy'),
        manifest: { version: '1.0.0' },
        settings: createGeminiHostSettings(),
      } as unknown as ProviderHost,
      {
        interactionPort: {
          askUserQuestion: jest.fn(),
          dismissInteraction: jest.fn(),
          requestApproval,
        },
        lifecycle: 'persistent',
        nativePersistence: 'enabled',
        vaultWorkingDirectory: '/vault',
      },
      {
        nativeFactory: {
          create(options) {
            capturedOptions = options;
            return native;
          },
        },
      },
    );

    await collect(session.execute(createExecutionRequest('yolo')).events);
    expect(currentDecision).toEqual({
      outcome: { optionId: 'allow-1', outcome: 'selected' },
    });

    await collect(session.execute(createExecutionRequest('plan')).events);
    expect(currentDecision).toEqual({
      outcome: { optionId: 'reject-1', outcome: 'selected' },
    });
    expect(requestApproval).not.toHaveBeenCalled();

    await session.dispose();
  });
});
