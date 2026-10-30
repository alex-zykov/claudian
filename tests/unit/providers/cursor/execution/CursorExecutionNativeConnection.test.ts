import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import askQuestionFixture from '@test/fixtures/providers/cursor/extensions/ask-question.json';
import createPlanFixture from '@test/fixtures/providers/cursor/extensions/create-plan.json';
import initializeFixture from '@test/fixtures/providers/cursor/runtime/initialize.json';
import spawn from 'cross-spawn';

import { ACPJSONRPCTransport } from '@/providers/acp';
import { CursorExecutionNativeConnectionImpl } from '@/providers/cursor/execution/CursorExecutionNativeConnection';

jest.mock('cross-spawn', () => jest.fn());

function createNativeProcess() {
  const proc = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    killed: false,
    pid: 12345,
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: () => {
      proc.exitCode = 0;
      proc.killed = true;
      proc.emit('exit', 0, null);
      return true;
    },
  });
  jest.mocked(spawn).mockReturnValue(proc as unknown as ChildProcessWithoutNullStreams);
  return proc;
}

describe('CursorExecutionNativeConnection', () => {
  let mockTransport: ACPJSONRPCTransport;
  let connection: CursorExecutionNativeConnectionImpl;
  let proc: ReturnType<typeof createNativeProcess>;
  const extensionCalls: Array<{ method: string; params: unknown }> = [];

  beforeEach(() => {
    extensionCalls.length = 0;
    proc = createNativeProcess();
    // Mirror agent stdout/stdin so we can drive inbound requests.
    mockTransport = new ACPJSONRPCTransport({
      input: proc.stdin,
      output: proc.stdout,
    });
    mockTransport.onRequest('initialize', () => initializeFixture);
    mockTransport.onRequest('authenticate', () => ({}));
    mockTransport.start();
    connection = new CursorExecutionNativeConnectionImpl({
      command: '/home/user/.local/bin/agent',
      cwd: '/vault',
      env: {},
      requestExtension: async (method, params) => {
        extensionCalls.push({ method, params });
        return { outcome: 'accepted' };
      },
      requestPermission: async () => ({
        outcome: { outcome: 'selected', optionId: 'allow-once' },
      }),
      version: 'test',
    });
  });

  afterEach(async () => {
    await connection.shutdown();
    mockTransport.dispose();
  });

  it('initializes then authenticates with cursor_login', async () => {
    const authCalls: unknown[] = [];
    mockTransport.onRequest('authenticate', params => {
      authCalls.push(params);
      return {};
    });

    await connection.initialize();

    expect(authCalls).toEqual([{ methodId: 'cursor_login' }]);
  });

  it('surfaces actionable guidance when authenticate fails', async () => {
    mockTransport.onRequest('authenticate', () => {
      throw Object.assign(new Error('Authentication required'), {
        code: -32000,
      });
    });

    await expect(connection.initialize()).rejects.toThrow(/agent login|CURSOR_API_KEY/);
  });

  it('routes blocking cursor extension requests from the agent', async () => {
    await connection.initialize();

    proc.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 42,
      method: 'cursor/ask_question',
      params: askQuestionFixture,
    })}\n`);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    proc.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 43,
      method: 'cursor/create_plan',
      params: createPlanFixture,
    })}\n`);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    expect(extensionCalls.map(call => call.method)).toEqual([
      'cursor/ask_question',
      'cursor/create_plan',
    ]);
  });
});
