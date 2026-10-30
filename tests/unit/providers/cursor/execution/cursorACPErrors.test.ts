import { JSONRPCErrorResponse } from '@/core/rpc/JSONRPCTransport';
import {
  classifyCursorExecutionError,
  formatCursorACPErrorMessage,
  isCursorSessionMissingError,
} from '@/providers/cursor/execution/cursorACPErrors';

describe('cursorACPErrors', () => {
  const missing = new JSONRPCErrorResponse(
    'session/load',
    -32602,
    'Invalid params',
    { message: 'Session "00923b9e-6469-4631-9783-0494e4e5051c" not found' },
  );

  it('detects Cursor session-missing Invalid params from error.data', () => {
    expect(isCursorSessionMissingError(missing, '00923b9e-6469-4631-9783-0494e4e5051c')).toBe(true);
    expect(classifyCursorExecutionError(missing, '00923b9e-6469-4631-9783-0494e4e5051c'))
      .toBe('provider-session-missing');
    expect(formatCursorACPErrorMessage(missing))
      .toBe('Session "00923b9e-6469-4631-9783-0494e4e5051c" not found');
  });

  it('rejects a different expected session id', () => {
    expect(isCursorSessionMissingError(missing, 'other-session')).toBe(false);
  });
});
