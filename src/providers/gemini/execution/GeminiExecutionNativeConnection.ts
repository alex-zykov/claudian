import {
  ACPClientConnection,
  ACPJSONRPCTransport,
  ACPSubprocess,
} from '../../acp';
import type {
  GeminiExecutionNativeConnection,
  GeminiExecutionNativeCreateOptions,
} from './GeminiExecutionBackend';

const GEMINI_BLOCKING_EXTENSION_METHODS = [
  'gemini/ask_question',
  'agy/ask_question',
] as const;

export class GeminiExecutionNativeConnectionImpl
implements GeminiExecutionNativeConnection {
  private readonly connection: ACPClientConnection;
  private readonly listeners = new Set<Parameters<GeminiExecutionNativeConnection['onNotification']>[0]>();
  private readonly process: ACPSubprocess;
  private readonly transport: ACPJSONRPCTransport;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly options: GeminiExecutionNativeCreateOptions) {
    this.process = new ACPSubprocess({
      args: ['acp'],
      command: options.command,
      cwd: options.cwd,
      env: options.env,
    });
    this.process.start();
    this.transport = new ACPJSONRPCTransport({
      input: this.process.stdout,
      onClose: listener => this.process.onClose(listener),
      output: this.process.stdin,
    });
    this.connection = new ACPClientConnection({
      clientInfo: { name: 'claudian', version: options.version },
      delegate: {
        onSessionNotification: notification => this.notify(notification, 'standard'),
        requestPermission: request => options.requestPermission(request),
      },
      transport: this.transport,
    });

    for (const method of GEMINI_BLOCKING_EXTENSION_METHODS) {
      this.unsubscribers.push(this.transport.onRequest(
        method,
        params => options.requestExtension(method, params),
      ));
    }
  }

  cancel(sessionId: string): void {
    this.connection.cancel({ sessionId });
  }

  flush(): Promise<void> {
    return this.transport.flush();
  }

  async initialize(): Promise<void> {
    await this.connection.initialize();
  }

  isAlive(): boolean {
    return this.process.isAlive();
  }

  listSessions: NonNullable<GeminiExecutionNativeConnection['listSessions']> = request => (
    this.connection.listSessions(request ?? {})
  );

  loadSession: GeminiExecutionNativeConnection['loadSession'] = request => (
    this.connection.loadSession(request)
  );

  newSession: GeminiExecutionNativeConnection['newSession'] = request => (
    this.connection.newSession(request)
  );

  onClose(listener: (error?: Error) => void): () => void {
    return this.process.onClose(listener);
  }

  onNotification(
    listener: Parameters<GeminiExecutionNativeConnection['onNotification']>[0],
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  prompt: GeminiExecutionNativeConnection['prompt'] = request => (
    this.connection.prompt(request)
  );

  setConfigOption: NonNullable<GeminiExecutionNativeConnection['setConfigOption']> = request => (
    this.connection.setConfigOption(request)
  );

  setMode: GeminiExecutionNativeConnection['setMode'] = request => (
    this.connection.setMode(request)
  );

  setModel: GeminiExecutionNativeConnection['setModel'] = request => (
    this.connection.setModel(request)
  );

  async shutdown(): Promise<void> {
    while (this.unsubscribers.length > 0) this.unsubscribers.pop()?.();
    this.listeners.clear();
    this.connection.dispose();
    this.transport.dispose();
    await this.process.shutdown();
  }

  private notify(
    notification: Parameters<Parameters<GeminiExecutionNativeConnection['onNotification']>[0]>[0],
    source: 'extension' | 'standard',
  ): void {
    for (const listener of this.listeners) listener(notification, source);
  }
}
