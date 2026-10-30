import { randomUUID } from 'node:crypto';

import {
  buildContextFromHistory,
  buildPromptWithHistoryContext,
} from '@/core/prompt/historyContext';
import { appendLinkedContent, appendSelectionContexts, appendSessionReferences } from '@/core/prompt/promptContext';

import {
  type ProviderExecutionRequest,
  type ProviderExecutionRun,
  type ProviderExecutionSession,
  type ProviderSessionConfig,
  type ProviderSessionEvent,
  type ProviderSessionInvalidation,
  type ProviderSessionSnapshot,
  type ProviderSessionStatus,
  RequestedRunChannel,
  SessionSnapshotState,
} from '../../../core/execution';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ChatMessage } from '../../../core/types';
import {
  type ACPContentBlock,
  ACPInteractionController,
  type ACPPromptResponse,
  ACPRequestedTurn,
  type ACPSessionNotification,
  ACPToolStreamAdapter,
  type ACPUsage,
  buildACPUsageInfo,
  mapACPApprovalDecision,
} from '../../acp';
import type { CursorCommandCatalog } from '../commands/CursorCommandCatalog';
import { computeCursorEnvironmentHash } from '../env/CursorSettingsReconciler';
import {
  type CursorDiscoveredModel,
  decodeCursorModelId,
  findCursorModel,
} from '../models';
import {
  buildCursorToolProviderPayload,
  normalizeCursorToolInput,
  normalizeCursorToolName,
  normalizeCursorToolResultDetails,
  normalizeCursorToolUpdate,
  resolveCursorRawToolName,
} from '../normalization/cursorToolNormalization';
import { parseCursorPromptUsage, parseCursorUsage } from '../normalization/cursorUsage';
import { isCursorReadOnlyPermissionMode, toCursorSessionModeId } from '../permissionModes';
import { assertCursorModelAvailable } from '../runtime/CursorModelAvailability';
import type { CursorModelCatalogCoordinator } from '../runtime/CursorModelCatalogCoordinator';
import { buildCursorRuntimeEnv } from '../runtime/CursorRuntimeEnvironment';
import { getCursorProviderSettings } from '../settings';
import { parseCursorProviderState } from '../types';
import {
  classifyCursorExecutionError,
  formatCursorACPErrorMessage,
  isCursorSessionMissingError,
} from './cursorACPErrors';
import type {
  CursorExecutionNativeConnection,
  CursorExecutionNativeFactory,
} from './CursorExecutionBackend';
import { CursorExecutionInteractionRouter } from './CursorExecutionInteractionRouter';
import {
  normalizeCursorSessionModelMetadata,
  normalizeCursorSetModelMetadata,
} from './CursorSessionModelMetadata';
import { resolveCursorACPModelID } from './resolveCursorACPModelID';

interface CursorExecutionSessionOptions {
  readonly commandCatalog?: Pick<CursorCommandCatalog, 'setCommandSnapshot'>;
  readonly modelCatalogCoordinator?: Pick<CursorModelCatalogCoordinator, 'mergeLiveModels'>;
  readonly nativeFactory: CursorExecutionNativeFactory;
}

interface ActiveExecution {
  readonly abortController: AbortController;
  readonly cancellationGeneration: number;
  readonly request: ProviderExecutionRequest;
  readonly run: RequestedRunChannel;
  readonly turn: ACPRequestedTurn;
  promptUsage: ACPUsage | null;
  promptResponse?: ACPPromptResponse;
  observedTurnCompletions: number;
  requiredTurnCompletions: number;
}

interface CursorNativeSession {
  readonly native: CursorExecutionNativeConnection;
  readonly sessionId: string;
}

interface CursorNativeOwner {
  availableModelIds: string[];
  readonly generation: number;
  initialized: boolean;
  loadedSessionConfigurationKey: string | null;
  loadedSessionId: string | null;
  readonly modelContextKey: string;
  readonly native: CursorExecutionNativeConnection;
  notificationUnsubscribe: () => void;
  shutdownFlight: Promise<void> | null;
}

export class CursorExecutionSession implements ProviderExecutionSession {
  readonly providerId = 'cursor' as const;
  readonly sessionInstanceId = randomUUID();

  private active: ActiveExecution | null = null;
  private cancellationFlight: Promise<void> | null = null;
  private cancellationGeneration = 0;
  private disposalFlight: Promise<void> | null = null;
  private disposed = false;
  private nativeGeneration = 0;
  private nativeOwner: CursorNativeOwner | null = null;
  private nativeStartupFlight: Promise<CursorExecutionNativeConnection> | null = null;
  private quarantineGeneration = 0;
  private readonly interactionController: ACPInteractionController;
  private readonly interactionRouter: CursorExecutionInteractionRouter;
  private nativeConversationContextEstablished: boolean;
  private providerSessionId: string | undefined;
  private readonly state: SessionSnapshotState;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly config: ProviderSessionConfig,
    private readonly options: CursorExecutionSessionOptions,
  ) {
    this.providerSessionId = config.resumeSeed?.providerSessionId;
    const providerState = parseCursorProviderState(config.resumeSeed?.providerState);
    this.state = new SessionSnapshotState({
      providerId: this.providerId,
      providerState: { ...providerState },
      readProviderSessionId: () => this.providerSessionId,
      sessionInstanceId: this.sessionInstanceId,
    });
    this.nativeConversationContextEstablished = Boolean(
      this.providerSessionId
      && providerState.nativeConversationContextEstablished !== false,
    );
    this.interactionController = new ACPInteractionController({
      getTurnId: () => this.active?.run.turnId ?? null,
      interactionPort: config.interactionPort,
      sessionInstanceId: this.sessionInstanceId,
    });
    this.interactionRouter = new CursorExecutionInteractionRouter(
      config.interactionPort,
      this.sessionInstanceId,
      () => this.active?.run.turnId ?? null,
      () => this.providerSessionId,
    );
  }

  execute(request: ProviderExecutionRequest): ProviderExecutionRun {
    if (this.disposed) throw new Error('Cursor execution session is disposed.');
    if (this.active) throw new Error('Cursor execution session is already executing.');
    const run = new RequestedRunChannel({
      onCancel: source => {
        void this.#cancelRun(run, source === 'abort-signal' ? 'aborted' : 'cancelled');
      },
      sessionInstanceId: this.sessionInstanceId,
    });
    const active: ActiveExecution = {
      abortController: new AbortController(),
      cancellationGeneration: this.cancellationGeneration,
      observedTurnCompletions: 0,
      promptUsage: null,
      request,
      requiredTurnCompletions: 0,
      run,
      turn: new ACPRequestedTurn({
        acceptsSilentUpdates: true,
        onAccept: () => {
          if (this.nativeConversationContextEstablished) return;
          this.#setNativeConversationContextEstablished(true);
          this.#updateSnapshot('executing');
          this.#emitCurrentSnapshot();
        },
        run,
        toolStreamAdapter: createCursorToolStreamAdapter(),
      }),
    };
    this.active = active;
    this.#updateSnapshot('executing');
    this.#emitCurrentSnapshot();
    run.attachAbortSignal(request.signal);
    if (!run.isCancellationRequested) void this.#performExecution(active);
    return run;
  }

  cancel(): void {
    const run = this.active?.run;
    if (run) void this.#cancelRun(run, 'cancelled');
  }

  getSnapshot(): ProviderSessionSnapshot {
    return this.state.getSnapshot();
  }

  getStatus(): ProviderSessionStatus {
    return this.state.status;
  }

  onEvent(listener: (event: ProviderSessionEvent) => void): () => void {
    return this.state.onEvent(listener);
  }

  dispose(): Promise<void> {
    if (this.disposalFlight) return this.disposalFlight;
    this.disposed = true;
    this.quarantineGeneration += 1;
    this.disposalFlight = (async () => {
      const active = this.active;
      if (active) await this.#cancelRun(active.run, 'session-disposed');
      if (this.cancellationFlight) await this.cancellationFlight;
      await this.#shutdownNative();
      this.interactionController.dispose();
      this.interactionRouter.dismissAll('session-disposed');
      this.state.clearListeners();
      this.#updateSnapshot('disposed');
    })();
    return this.disposalFlight;
  }

  async #performExecution(active: ActiveExecution): Promise<void> {
    if (active.request.toolPolicy.kind === 'allow-list') {
      this.#updateSnapshot('invalidated', {
        message: 'Exact Cursor tool allow-list enforcement is unavailable.',
        reason: 'configuration-changed',
        recoverable: false,
      });
      this.#emitCurrentSnapshot();
      active.run.finish({
        category: 'configuration',
        message: 'Cursor does not support reliable exact allow-list enforcement.',
        recoverable: false,
        type: 'execution_error',
      });
      active.turn.dispose();
      if (this.active === active) this.active = null;
      return;
    }

    let unsubscribeClose: (() => void) | undefined;
    try {
      assertCursorModelAvailable(this.plugin.settings, active.request.configuration.model);
      if (this.cancellationFlight) await this.cancellationFlight;
      if (this.#isCancellationRequested(active)) return;
      const { native, sessionId } = await this.#ensureSession(
        await this.#ensureNative(active),
        active.request,
        active,
      );
      if (this.#isCancellationRequested(active)) return;
      await this.#applyConfiguration(native, sessionId, active.request, active);
      if (this.#isCancellationRequested(active)) return;
      assertCursorModelAvailable(this.plugin.settings, active.request.configuration.model);

      active.turn.beginLiveOutput();
      const closed = new Promise<never>((_resolve, reject) => {
        unsubscribeClose = native.onClose?.(error => {
          reject(new Error('Cursor transport closed', { cause: error }));
        });
      });
      const response = await Promise.race([closed, native.prompt({
        prompt: buildPromptBlocks(active.request, !this.nativeConversationContextEstablished),
        sessionId,
      })]);
      if (this.#isCancellationRequested(active)) return;
      active.turn.accept(response.userMessageId);
      active.promptResponse = response;
      active.promptUsage = parseCursorPromptUsage(response) ?? active.promptUsage;
      this.#finishCompletedIfReady(active);
      await Promise.race([closed, active.run.terminated]);
    } catch (error) {
      if (this.#isCancellationRequested(active)) return;
      const category = classifyCursorExecutionError(error, this.providerSessionId);
      const message = formatCursorACPErrorMessage(error);
      this.#updateSnapshot('invalidated', {
        message,
        reason: category === 'provider-session-missing'
          ? 'provider-session-missing'
          : category === 'transport'
            ? 'transport-closed'
            : 'provider-error',
        recoverable: true,
      });
      this.#emitCurrentSnapshot();
      active.run.finish({
        category,
        message,
        ...(category === 'provider-session-missing' && this.providerSessionId
          ? { missingProviderSessionId: this.providerSessionId }
          : {}),
        recoverable: true,
        type: 'execution_error',
      });
      active.turn.dispose();
      this.active = null;
    } finally {
      unsubscribeClose?.();
    }
  }

  async #ensureNative(
    active?: ActiveExecution,
  ): Promise<CursorExecutionNativeConnection> {
    const currentOwner = this.nativeOwner;
    if (
      !this.nativeStartupFlight
      && currentOwner?.initialized
      && currentOwner.native.isAlive?.() !== false
    ) return currentOwner.native;
    let startupFlight = this.nativeStartupFlight;
    if (!startupFlight) {
      startupFlight = this.#startNative(this.quarantineGeneration);
      this.nativeStartupFlight = startupFlight;
      startupFlight.then(
        () => {
          if (this.nativeStartupFlight === startupFlight) this.nativeStartupFlight = null;
        },
        () => {
          if (this.nativeStartupFlight === startupFlight) this.nativeStartupFlight = null;
        },
      );
    }
    const native = await startupFlight;
    this.#throwIfCancellationRequested(active);
    return native;
  }

  async #startNative(
    quarantineGeneration: number,
  ): Promise<CursorExecutionNativeConnection> {
    const previousOwner = this.nativeOwner;
    if (previousOwner) await this.#shutdownNativeOwner(previousOwner);
    const command = await this.plugin.getResolvedProviderCliPath('cursor') ?? 'agent';
    if (quarantineGeneration !== this.quarantineGeneration || this.disposed) {
      throw new Error('Cursor native startup was cancelled.');
    }
    const generation = ++this.nativeGeneration;
    const native = this.options.nativeFactory.create({
      command,
      cwd: this.config.vaultWorkingDirectory,
      env: buildCursorRuntimeEnv(this.plugin.settings, command),
      requestPermission: (request, signal) => {
        const policy = this.active?.request.toolPolicy.kind;
        if (policy === 'passive' || policy === 'read-only') {
          return Promise.resolve({ outcome: { outcome: 'cancelled' } });
        }
        if (isCursorReadOnlyPermissionMode(this.active?.request.configuration.permissionMode)) {
          return Promise.resolve(
            mapACPApprovalDecision('deny', request.options),
          );
        }
        return this.interactionController.requestPermission(
          request,
          signal ?? this.active?.abortController.signal,
        );
      },
      requestExtension: (method, params, signal) => this.interactionRouter.handle(
        method,
        params,
        signal ?? this.active?.abortController.signal,
      ),
      version: this.plugin.manifest?.version ?? '0.0.0',
    });
    const owner: CursorNativeOwner = {
      availableModelIds: [],
      generation,
      initialized: false,
      loadedSessionConfigurationKey: null,
      loadedSessionId: null,
      modelContextKey: computeCursorEnvironmentHash(this.plugin.settings),
      native,
      notificationUnsubscribe: () => {},
      shutdownFlight: null,
    };
    this.nativeOwner = owner;
    try {
      owner.notificationUnsubscribe = native.onNotification((notification, source) => {
        if (this.#isCurrentNativeOwner(owner)) this.#handleNotification(notification, source);
      });
      await native.initialize();
      if (
        quarantineGeneration !== this.quarantineGeneration
        || this.disposed
        || !this.#isCurrentNativeOwner(owner)
      ) {
        throw new Error('Cursor native startup was cancelled.');
      }
      owner.initialized = true;
      return native;
    } catch (error) {
      try {
        await this.#shutdownNativeOwner(owner);
      } catch {
        // Startup cleanup cannot replace the initiating error.
      }
      throw error;
    }
  }

  async #ensureSession(
    native: CursorExecutionNativeConnection,
    request: ProviderExecutionRequest | undefined,
    active?: ActiveExecution,
  ): Promise<CursorNativeSession> {
    const owner = this.#getNativeOwner(native);
    const sessionConfigurationKey = request
      ? this.#buildSessionConfigurationKey(request)
      : null;
    if (this.providerSessionId) {
      if (owner.loadedSessionId === this.providerSessionId) {
        if (
          request
          && owner.loadedSessionConfigurationKey !== sessionConfigurationKey
        ) {
          await this.#shutdownNative();
          this.#throwIfCancellationRequested(active);
          const replacement = await this.#ensureNative(active);
          return this.#ensureSession(replacement, request, active);
        }
        return { native, sessionId: this.providerSessionId };
      }
      try {
        return {
          native,
          sessionId: await this.#loadProviderSession(
            native,
            this.providerSessionId,
            request,
            active,
            sessionConfigurationKey,
          ),
        };
      } catch (error) {
        if (!isCursorSessionMissingError(error, this.providerSessionId)) {
          throw error;
        }
        // Stale ACP ids are common after process restart; Claudian chat history
        // is replayed into the next prompt when native context is not established.
        this.#forgetProviderSession();
      }
    }

    const response = await native.newSession({
      cwd: this.config.vaultWorkingDirectory,
      mcpServers: [],
    });
    this.#throwIfCancellationRequested(active);
    this.#captureProviderSession(response.sessionId);
    this.#setNativeConversationContextEstablished(false);
    owner.loadedSessionId = response.sessionId;
    owner.loadedSessionConfigurationKey = sessionConfigurationKey;
    this.#updateSnapshot(this.active ? 'executing' : 'idle');
    this.#emitCurrentSnapshot();
    await this.#publishSessionModels(response, owner.modelContextKey);
    this.#throwIfCancellationRequested(active);
    return { native, sessionId: response.sessionId };
  }

  async #loadProviderSession(
    native: CursorExecutionNativeConnection,
    targetSessionId: string,
    request: ProviderExecutionRequest | undefined,
    active: ActiveExecution | undefined,
    sessionConfigurationKey: string | null,
  ): Promise<string> {
    const owner = this.#getNativeOwner(native);
    const response = await native.loadSession({
      cwd: this.config.vaultWorkingDirectory,
      mcpServers: [],
      sessionId: targetSessionId,
    });
    this.#throwIfCancellationRequested(active);
    const loadedSessionId = response.sessionId ?? targetSessionId;
    this.#captureProviderSession(loadedSessionId);
    owner.loadedSessionId = loadedSessionId;
    owner.loadedSessionConfigurationKey = sessionConfigurationKey;
    this.#updateSnapshot(this.active ? 'executing' : 'idle');
    this.#emitCurrentSnapshot();
    await this.#publishSessionModels(response, owner.modelContextKey);
    this.#throwIfCancellationRequested(active);
    return loadedSessionId;
  }

  async #applyConfiguration(
    native: CursorExecutionNativeConnection,
    sessionId: string,
    request: ProviderExecutionRequest,
    active: ActiveExecution,
  ): Promise<void> {
    const owner = this.#getNativeOwner(native);
    const configurationModel = request.configuration.model ?? '';
    const rawModel = decodeCursorModelId(configurationModel);
    const modelId = rawModel
      ? resolveCursorACPModelID(rawModel, owner.availableModelIds)
      : null;
    if (modelId) {
      await native.setModel({
        modelId,
        sessionId,
      });
      this.#throwIfCancellationRequested(active);
      // Response metadata is best-effort; session/new already seeds the catalog.
      void normalizeCursorSetModelMetadata;
    }

    const modeId = toCursorSessionModeId(request.configuration.permissionMode);
    await native.setMode({
      modeId,
      sessionId,
    });
    this.#throwIfCancellationRequested(active);
  }

  #handleNotification(
    notification: ACPSessionNotification,
    _source: 'extension' | 'standard',
  ): void {
    const active = this.active;
    if (
      this.disposed
      || !active
      || this.#isCancellationRequested(active)
      || notification.sessionId !== this.providerSessionId
    ) return;

    if (isTurnCompleted(notification.update)) {
      if (active.turn.acceptingLiveOutput) {
        active.promptUsage = parseCursorUsage((notification.update as { usage?: unknown }).usage)
          ?? active.promptUsage;
        active.observedTurnCompletions += 1;
        this.#finishCompletedIfReady(active);
      }
      return;
    }

    let update = notification.update;
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      update = normalizeCursorToolUpdate(update);
    }
    active.turn.handleUpdate(update);
  }

  #finishCompletedIfReady(active: ActiveExecution): void {
    if (this.#isCancellationRequested(active)
      || !active.promptResponse
      || active.observedTurnCompletions < active.requiredTurnCompletions) return;
    const response = active.promptResponse;
    if (active.promptUsage) {
      const model = active.request.configuration.model ?? '';
      const advertisedWindow = findCursorModel(
        getCursorProviderSettings(this.plugin.settings).currentCatalog?.models ?? [],
        model,
      )?.contextWindow;
      const size = active.turn.contextUsage?.size || advertisedWindow;
      const usage = buildACPUsageInfo({
        model: decodeCursorModelId(model) ?? undefined,
        contextWindow: size ? { size, used: active.promptUsage.totalTokens } : null,
        promptUsage: active.promptUsage,
      });
      if (usage) active.run.emit({ type: 'usage_updated', usage });
    }
    this.#updateSnapshot('idle');
    this.#emitCurrentSnapshot();
    active.run.finish({
      providerPayload: response,
      reason: mapStopReason(response.stopReason),
      type: 'turn_completed',
    });
    active.turn.dispose();
    this.active = null;
  }

  async #cancelRun(run: RequestedRunChannel, reason: string): Promise<void> {
    const active = this.active;
    if (!active || active.run !== run || run.isTerminal) return;
    if (this.cancellationFlight) return this.cancellationFlight;
    this.cancellationGeneration += 1;
    this.#updateSnapshot('cancelling');
    this.#emitCurrentSnapshot();
    this.quarantineGeneration += 1;
    active.abortController.abort();
    this.interactionController.dismissAll('cancelled');
    this.interactionRouter.dismissAll('cancelled');
    const native = this.nativeOwner?.native ?? null;
    this.cancellationFlight = (async () => {
      const sessionId = this.providerSessionId;
      if (native && sessionId) native.cancel(sessionId);
      try {
        await native?.flush?.();
      } catch {
        // Cancellation flush is best-effort.
      }
      if (this.active === active) {
        this.#updateSnapshot('idle');
        this.#emitCurrentSnapshot();
        active.run.finish({
          reason: reason === 'aborted' ? 'aborted' : 'cancelled',
          type: 'cancelled',
        });
        active.turn.dispose();
        this.active = null;
      }
    })().finally(() => {
      this.cancellationFlight = null;
    });
    return this.cancellationFlight;
  }

  async #publishSessionModels(
    response: Parameters<typeof normalizeCursorSessionModelMetadata>[0],
    modelContextKey: string,
  ): Promise<void> {
    const normalized = normalizeCursorSessionModelMetadata(response);
    if (this.nativeOwner) {
      this.nativeOwner.availableModelIds = normalized.models.map(model => model.rawId);
    }
    if (normalized.models.length === 0) return;
    await this.#mergeModelMetadataBestEffort(normalized.models, normalized.currentModelId, modelContextKey);
  }

  #forgetProviderSession(): void {
    this.providerSessionId = undefined;
    this.#setNativeConversationContextEstablished(false);
    if (this.nativeOwner) {
      this.nativeOwner.loadedSessionId = null;
      this.nativeOwner.loadedSessionConfigurationKey = null;
      this.nativeOwner.availableModelIds = [];
    }
  }

  async #mergeModelMetadataBestEffort(
    models: CursorDiscoveredModel[],
    defaultModelId: string | null | undefined,
    modelContextKey: string,
  ): Promise<void> {
    try {
      await this.options.modelCatalogCoordinator?.mergeLiveModels(
        models,
        defaultModelId ?? undefined,
        modelContextKey,
      );
    } catch {
      // Catalog merge cannot disrupt the turn.
    }
  }

  #captureProviderSession(sessionId: string): void {
    this.providerSessionId = sessionId;
    this.state.setProviderStateValue('cwd', this.config.vaultWorkingDirectory);
    this.state.setProviderStateValue(
      'nativeConversationContextEstablished',
      this.nativeConversationContextEstablished,
    );
    this.state.bumpRevision();
  }

  #setNativeConversationContextEstablished(value: boolean): void {
    this.nativeConversationContextEstablished = value;
    this.state.setProviderStateValue('nativeConversationContextEstablished', value);
    this.state.bumpRevision();
  }

  #buildSessionConfigurationKey(request: ProviderExecutionRequest): string {
    return JSON.stringify({
      env: computeCursorEnvironmentHash(this.plugin.settings),
      model: request.configuration.model ?? null,
      permissionMode: toCursorSessionModeId(request.configuration.permissionMode),
      cwd: this.config.vaultWorkingDirectory,
    });
  }

  #getNativeOwner(native: CursorExecutionNativeConnection): CursorNativeOwner {
    const owner = this.nativeOwner;
    if (!owner || owner.native !== native) {
      throw new Error('Cursor native owner mismatch.');
    }
    return owner;
  }

  #isCurrentNativeOwner(owner: CursorNativeOwner): boolean {
    return this.nativeOwner === owner && owner.generation === this.nativeGeneration;
  }

  async #shutdownNative(): Promise<void> {
    const owner = this.nativeOwner;
    if (owner) await this.#shutdownNativeOwner(owner);
  }

  async #shutdownNativeOwner(owner: CursorNativeOwner): Promise<void> {
    if (owner.shutdownFlight) return owner.shutdownFlight;
    owner.shutdownFlight = (async () => {
      owner.notificationUnsubscribe();
      if (this.nativeOwner === owner) this.nativeOwner = null;
      await owner.native.shutdown();
    })();
    return owner.shutdownFlight;
  }

  #isCancellationRequested(active: ActiveExecution): boolean {
    return active.run.isCancellationRequested
      || active.cancellationGeneration !== this.cancellationGeneration
      || this.disposed;
  }

  #throwIfCancellationRequested(active?: ActiveExecution): void {
    if (active && this.#isCancellationRequested(active)) {
      throw new CursorExecutionCancellationError();
    }
    if (this.disposed) throw new CursorExecutionCancellationError();
  }

  #updateSnapshot(
    status: ProviderSessionStatus,
    invalidation?: ProviderSessionInvalidation,
  ): void {
    if (status === 'invalidated') this.state.invalidate(invalidation!);
    else this.state.setStatus(status);
  }

  #emitCurrentSnapshot(): void {
    const active = this.active;
    const event = {
      snapshot: this.state.getSnapshot(),
      type: 'session_state_changed' as const,
    };
    if (active && !active.run.isTerminal) {
      active.run.emit(event);
      return;
    }
    this.state.emit(event);
  }
}

class CursorExecutionCancellationError extends Error {
  constructor() {
    super('Cursor execution was cancelled.');
    this.name = 'CursorExecutionCancellationError';
  }
}

function createCursorToolStreamAdapter(): ACPToolStreamAdapter {
  return new ACPToolStreamAdapter({
    normalizeToolInput(rawName, input, rawOutput) {
      return normalizeCursorToolInput(rawName ?? 'tool', input, rawOutput);
    },
    normalizeToolName(rawName, rawInput, rawOutput) {
      return normalizeCursorToolName(rawName ?? 'tool', rawInput, rawOutput);
    },
    normalizeToolResultDetails(rawName, input, rawOutput) {
      return normalizeCursorToolResultDetails(rawName ?? 'tool', input, rawOutput);
    },
    buildToolProviderPayload(rawName, rawInput, rawOutput) {
      return buildCursorToolProviderPayload({
        rawInput,
        rawName: rawName ?? 'tool',
        rawOutput,
      });
    },
    resolveRawToolName(currentRawName, update) {
      return resolveCursorRawToolName(currentRawName, update);
    },
  });
}

function getInputText(request: ProviderExecutionRequest): string {
  return request.input
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

function buildPromptBlocks(
  request: ProviderExecutionRequest,
  replayConversationHistory = false,
): ACPContentBlock[] {
  const blocks: ACPContentBlock[] = [];
  let text = getInputText(request);
  const context = request.context;
  if (context?.linkedContent) {
    text = appendLinkedContent(text, context.linkedContent.path);
  }
  text = appendSelectionContexts(text, context);
  text = appendSessionReferences(text, context?.sessionReferences);
  if (replayConversationHistory && request.conversationHistory?.length) {
    const history = [...request.conversationHistory] as ChatMessage[];
    text = buildPromptWithHistoryContext(
      buildContextFromHistory(history),
      text,
      text,
      history,
    );
  }
  if (text) blocks.push({ text, type: 'text' });
  for (const block of request.input) {
    if (block.type === 'image' && block.image.data) {
      blocks.push({
        data: block.image.data,
        mimeType: block.image.mediaType,
        type: 'image',
      });
    }
  }
  return blocks;
}

function isTurnCompleted(update: unknown): boolean {
  return Boolean(
    update
    && typeof update === 'object'
    && (
      (update as Record<string, unknown>).sessionUpdate === 'turn_completed'
      || (update as Record<string, unknown>).type === 'turn_completed'
    ),
  );
}

function mapStopReason(reason: string): 'completed' | 'max-tokens' | 'provider-ended' {
  if (reason === 'max_tokens' || reason === 'max-tokens') return 'max-tokens';
  return reason === 'end_turn' || reason === 'completed' ? 'completed' : 'provider-ended';
}
