import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import initializeFixture from '@test/fixtures/providers/cursor/runtime/initialize.json';
import spawn from 'cross-spawn';

import { ACPJSONRPCTransport } from '@/providers/acp';
import { GeminiExecutionNativeConnectionImpl } from '@/providers/gemini/execution/GeminiExecutionNativeConnection';

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

describe('GeminiExecutionNativeConnection', () => {
  let mockTransport: ACPJSONRPCTransport;
  let connection: GeminiExecutionNativeConnectionImpl;
  let proc: ReturnType<typeof createNativeProcess>;

  beforeEach(() => {
    proc = createNativeProcess();
    mockTransport = new ACPJSONRPCTransport({
      input: proc.stdin,
      output: proc.stdout,
    });
    mockTransport.onRequest('initialize', () => initializeFixture);
    mockTransport.onRequest('authenticate', () => ({}));
    mockTransport.start();
    connection = new GeminiExecutionNativeConnectionImpl({
      command: '/Users/user/.antigravity/antigravity/bin/agy',
      cwd: '/vault',
      env: {},
      requestExtension: async () => ({ outcome: 'accepted' }),
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

  it('spawns agy with acp and initializes without sending ACP authenticate requests', async () => {
    const authCalls: unknown[] = [];
    mockTransport.onRequest('authenticate', params => {
      authCalls.push(params);
      return {};
    });

    await connection.initialize();

    expect(spawn).toHaveBeenCalledWith(
      '/Users/user/.antigravity/antigravity/bin/agy',
      ['acp'],
      expect.objectContaining({ cwd: '/vault' }),
    );
    expect(authCalls).toEqual([]);
  });
});
