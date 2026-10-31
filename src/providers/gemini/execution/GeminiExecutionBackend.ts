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
import type { GeminiCommandCatalog } from '../commands/GeminiCommandCatalog';
import type { GeminiModelCatalogCoordinator } from '../runtime/GeminiModelCatalogCoordinator';
import { GeminiExecutionNativeConnectionImpl } from './GeminiExecutionNativeConnection';
import { GeminiExecutionSession } from './GeminiExecutionSession';

export interface GeminiExecutionNativeConnection {
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

export interface GeminiExecutionNativeCreateOptions {
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

export interface GeminiExecutionNativeFactory {
  create(options: GeminiExecutionNativeCreateOptions): GeminiExecutionNativeConnection;
}

export interface GeminiExecutionBackendOptions {
  readonly commandCatalog?: Pick<GeminiCommandCatalog, 'setCommandSnapshot'>;
  readonly modelCatalogCoordinator?: Pick<GeminiModelCatalogCoordinator, 'mergeLiveModels'>;
  readonly nativeFactory?: GeminiExecutionNativeFactory;
}

export class GeminiExecutionBackend implements ProviderExecutionBackend {
  readonly providerId = 'gemini' as const;
  private readonly nativeFactory: GeminiExecutionNativeFactory;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly options: GeminiExecutionBackendOptions = {},
  ) {
    this.nativeFactory = options.nativeFactory ?? {
      create: nativeOptions => new GeminiExecutionNativeConnectionImpl(nativeOptions),
    };
  }

  createSession(config: ProviderSessionConfig): ProviderExecutionSession {
    return new GeminiExecutionSession(this.plugin, config, {
      commandCatalog: this.options.commandCatalog,
      modelCatalogCoordinator: this.options.modelCatalogCoordinator,
      nativeFactory: this.nativeFactory,
    });
  }
}
