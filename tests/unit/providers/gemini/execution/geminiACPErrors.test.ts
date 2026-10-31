import { JSONRPCErrorResponse } from '@/core/rpc/JSONRPCTransport';
import {
  classifyGeminiExecutionError,
  formatGeminiACPErrorMessage,
  isGeminiSessionMissingError,
} from '@/providers/gemini/execution/geminiACPErrors';

describe('geminiACPErrors', () => {
  const missing = new JSONRPCErrorResponse(
    'session/load',
    -32602,
    'Invalid params',
    { message: 'Session "00923b9e-6469-4631-9783-0494e4e5051c" not found' },
  );

  it('detects Gemini session-missing Invalid params from error.data', () => {
    expect(isGeminiSessionMissingError(missing, '00923b9e-6469-4631-9783-0494e4e5051c')).toBe(true);
    expect(classifyGeminiExecutionError(missing, '00923b9e-6469-4631-9783-0494e4e5051c'))
      .toBe('provider-session-missing');
    expect(formatGeminiACPErrorMessage(missing))
      .toBe('Session "00923b9e-6469-4631-9783-0494e4e5051c" not found');
  });

  it('rejects a different expected session id', () => {
    expect(isGeminiSessionMissingError(missing, 'other-session')).toBe(false);
  });

  it('does not misclassify Method not found: session/set_mode as session-missing', () => {
    const methodNotFound = new JSONRPCErrorResponse(
      'session/set_mode',
      -32601,
      'Method not found: session/set_mode',
    );
    expect(isGeminiSessionMissingError(methodNotFound, '00923b9e-6469-4631-9783-0494e4e5051c')).toBe(false);
    expect(classifyGeminiExecutionError(methodNotFound, '00923b9e-6469-4631-9783-0494e4e5051c'))
      .not.toBe('provider-session-missing');
  });
});
