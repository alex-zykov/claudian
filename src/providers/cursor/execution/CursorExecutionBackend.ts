import type {
  ProviderExecutionBackend,
  ProviderExecutionSession,
  ProviderSessionConfig,
} from '../../../core/execution';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type {
  ACPListSessionsRequest,
  ACPListSessionsResponse,
  ACPLoadSessionRequest,
  ACPLoadSessionResponse,
  ACPNewSessionRequest,
  ACPNewSessionResponse,
  ACPPromptRequest,
  ACPPromptResponse,
  ACPRequestPermissionRequest,
  ACPRequestPermissionResponse,
  ACPSessionNotification,
  ACPSetSessionConfigOptionRequest,
  ACPSetSessionConfigOptionResponse,
  ACPSetSessionModelRequest,
  ACPSetSessionModelResponse,
  ACPSetSessionModeRequest,
} from '../../acp';
import type { CursorCommandCatalog } from '../commands/CursorCommandCatalog';
import type { CursorModelCatalogCoordinator } from '../runtime/CursorModelCatalogCoordinator';
import { CursorExecutionNativeConnectionImpl } from './CursorExecutionNativeConnection';
import { CursorExecutionSession } from './CursorExecutionSession';

export interface CursorExecutionNativeConnection {
  cancel(sessionId: string): void;
  flush(): Promise<void>;
  initialize(): Promise<void>;
  isAlive(): boolean;
  listSessions?(request?: ACPListSessionsRequest): Promise<ACPListSessionsResponse>;
  loadSession(request: ACPLoadSessionRequest): Promise<ACPLoadSessionResponse>;
  newSession(request: ACPNewSessionRequest): Promise<ACPNewSessionResponse>;
  onClose(listener: (error?: Error) => void): () => void;
  onNotification(
    listener: (
      notification: ACPSessionNotification,
      source: 'extension' | 'standard',
    ) => void,
  ): () => void;
  prompt(request: ACPPromptRequest): Promise<ACPPromptResponse>;
  setConfigOption?(
    request: ACPSetSessionConfigOptionRequest,
  ): Promise<ACPSetSessionConfigOptionResponse>;
  setMode(request: ACPSetSessionModeRequest): Promise<unknown>;
  setModel(request: ACPSetSessionModelRequest): Promise<ACPSetSessionModelResponse>;
  shutdown(): Promise<void>;
}

export interface CursorExecutionNativeCreateOptions {
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly handleExtensionNotification?: (
    method: string,
    params: unknown,
  ) => void | Promise<void>;
  readonly requestPermission: (
    request: ACPRequestPermissionRequest,
    signal?: AbortSignal,
  ) => Promise<ACPRequestPermissionResponse>;
  readonly requestExtension: (
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  readonly version: string;
}

export interface CursorExecutionNativeFactory {
  create(options: CursorExecutionNativeCreateOptions): CursorExecutionNativeConnection;
}

export interface CursorExecutionBackendOptions {
  readonly commandCatalog?: Pick<CursorCommandCatalog, 'setCommandSnapshot'>;
  readonly modelCatalogCoordinator?: Pick<CursorModelCatalogCoordinator, 'mergeLiveModels'>;
  readonly nativeFactory?: CursorExecutionNativeFactory;
}

export class CursorExecutionBackend implements ProviderExecutionBackend {
  readonly providerId = 'cursor' as const;
  private readonly nativeFactory: CursorExecutionNativeFactory;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly options: CursorExecutionBackendOptions = {},
  ) {
    this.nativeFactory = options.nativeFactory ?? {
      create: nativeOptions => new CursorExecutionNativeConnectionImpl(nativeOptions),
    };
  }

  createSession(config: ProviderSessionConfig): ProviderExecutionSession {
    return new CursorExecutionSession(this.plugin, config, {
      commandCatalog: this.options.commandCatalog,
      modelCatalogCoordinator: this.options.modelCatalogCoordinator,
      nativeFactory: this.nativeFactory,
    });
  }
}
