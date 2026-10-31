import { JSONRPCErrorResponse } from '@/core/rpc/JSONRPCTransport';

import { ProviderModelUnavailableError } from '../../../core/providers/models/ProviderModelUnavailableError';

export type CursorExecutionErrorCategory =
  | 'authentication'
  | 'configuration'
  | 'provider-session-missing'
  | 'transport'
  | 'unknown';

/** Cursor ACP often puts the actionable detail in JSON-RPC `error.data.message`. */
export function getCursorACPErrorDetailMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const data = error instanceof JSONRPCErrorResponse
    ? error.data
    : (error as { data?: unknown }).data;
  if (!isRecord(data)) return null;
  return typeof data.message === 'string' && data.message.trim()
    ? data.message.trim()
    : null;
}

export function formatCursorACPErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const detail = getCursorACPErrorDetailMessage(error);
  if (!detail || detail === error.message) return error.message;
  if (/^invalid params$/i.test(error.message)) return detail;
  return `${error.message}: ${detail}`;
}

export function isCursorSessionMissingError(
  error: unknown,
  expectedSessionId?: string,
): boolean {
  if (error instanceof JSONRPCErrorResponse && error.code === -32601) {
    return false;
  }
  const detail = getCursorACPErrorDetailMessage(error) ?? '';
  const message = error instanceof Error ? error.message : String(error);
  const haystack = `${message}\n${detail}`;
  if (/method\s+not\s+found/i.test(haystack)) {
    return false;
  }
  const match = haystack.match(/session\s+"([^"]+)"\s+not found/i)
    ?? haystack.match(/session\s+([0-9a-f-]{8,})\s+not found/i);
  if (!match) {
    return /\bsession\b[^\n]*\b(?:not found|is missing|does not exist)\b/i.test(haystack)
      || /\b(?:no such|unknown|missing)\s+session\b/i.test(haystack);
  }
  const missingId = match[1];
  return !expectedSessionId || missingId === expectedSessionId;
}

export function classifyCursorExecutionError(
  error: unknown,
  expectedSessionId?: string,
): CursorExecutionErrorCategory {
  if (error instanceof ProviderModelUnavailableError) return 'configuration';
  if (isCursorSessionMissingError(error, expectedSessionId)) {
    return 'provider-session-missing';
  }
  const message = (
    `${error instanceof Error ? error.message : String(error)}\n${getCursorACPErrorDetailMessage(error) ?? ''}`
  ).toLowerCase();
  if (message.includes('auth')) return 'authentication';
  if (message.includes('config') || message.includes('model')) return 'configuration';
  if (message.includes('transport') || message.includes('closed')) return 'transport';
  return 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
