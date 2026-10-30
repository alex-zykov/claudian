import {
  ACPClientConnection,
  ACPJSONRPCTransport,
  ACPSubprocess,
} from '../../acp';
import type {
  CursorExecutionNativeConnection,
  CursorExecutionNativeCreateOptions,
} from './CursorExecutionBackend';

const CURSOR_AUTH_METHOD_ID = 'cursor_login';
/** Unauthenticated authenticate() can hang waiting for login; fail closed with guidance. */
const CURSOR_AUTHENTICATE_TIMEOUT_MS = 15_000;

const CURSOR_BLOCKING_EXTENSION_METHODS = [
  'cursor/ask_question',
  'cursor/create_plan',
] as const;

const CURSOR_EXTENSION_NOTIFICATION_METHODS = [
  'cursor/update_todos',
  'cursor/task',
  'cursor/generate_image',
] as const;

const CURSOR_AUTH_GUIDANCE = [
  'Cursor authentication failed or timed out.',
  'Run `agent login`, or set CURSOR_API_KEY / CURSOR_AUTH_TOKEN in the process or provider environment, then retry.',
  'Claudian never stores a Cursor token in plugin settings.',
].join(' ');

export class CursorExecutionNativeConnectionImpl
implements CursorExecutionNativeConnection {
  private readonly connection: ACPClientConnection;
  private readonly listeners = new Set<Parameters<CursorExecutionNativeConnection['onNotification']>[0]>();
  private readonly process: ACPSubprocess;
  private readonly transport: ACPJSONRPCTransport;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly options: CursorExecutionNativeCreateOptions) {
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

    for (const method of CURSOR_BLOCKING_EXTENSION_METHODS) {
      this.unsubscribers.push(this.transport.onRequest(
        method,
        params => options.requestExtension(method, params),
      ));
    }

    for (const method of CURSOR_EXTENSION_NOTIFICATION_METHODS) {
      this.unsubscribers.push(this.transport.onNotification(method, params => {
        void options.handleExtensionNotification?.(method, params);
        void options.requestExtension(method, params).catch(() => {
          // Extension notifications are best-effort presentation hooks.
        });
      }));
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
    try {
      await this.transport.request(
        'authenticate',
        { methodId: CURSOR_AUTH_METHOD_ID },
        { timeoutMs: CURSOR_AUTHENTICATE_TIMEOUT_MS },
      );
    } catch (error) {
      throw new Error(CURSOR_AUTH_GUIDANCE, { cause: error });
    }
  }

  isAlive(): boolean {
    return this.process.isAlive();
  }

  listSessions: NonNullable<CursorExecutionNativeConnection['listSessions']> = request => (
    this.connection.listSessions(request ?? {})
  );

  loadSession: CursorExecutionNativeConnection['loadSession'] = request => (
    this.connection.loadSession(request)
  );

  newSession: CursorExecutionNativeConnection['newSession'] = request => (
    this.connection.newSession(request)
  );

  onClose(listener: (error?: Error) => void): () => void {
    return this.process.onClose(listener);
  }

  onNotification(
    listener: Parameters<CursorExecutionNativeConnection['onNotification']>[0],
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  prompt: CursorExecutionNativeConnection['prompt'] = request => (
    this.connection.prompt(request)
  );

  setConfigOption: NonNullable<CursorExecutionNativeConnection['setConfigOption']> = request => (
    this.connection.setConfigOption(request)
  );

  setMode: CursorExecutionNativeConnection['setMode'] = request => (
    this.connection.setMode(request)
  );

  setModel: CursorExecutionNativeConnection['setModel'] = request => (
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
    notification: Parameters<Parameters<CursorExecutionNativeConnection['onNotification']>[0]>[0],
    source: 'extension' | 'standard',
  ): void {
    for (const listener of this.listeners) listener(notification, source);
  }
}
