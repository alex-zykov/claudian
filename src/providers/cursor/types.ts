export interface CursorProviderState {
  cwd?: string;
  nativeConversationContextEstablished?: boolean;
}

export function parseCursorProviderState(value: unknown): CursorProviderState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const cwd = normalizeOpaqueString(record.cwd);
  const nativeConversationContextEstablished = typeof record.nativeConversationContextEstablished
    === 'boolean'
    ? record.nativeConversationContextEstablished
    : undefined;
  return {
    ...(cwd ? { cwd } : {}),
    ...(nativeConversationContextEstablished !== undefined
      ? { nativeConversationContextEstablished }
      : {}),
  };
}

export function buildPersistedCursorProviderState(
  state: CursorProviderState,
): CursorProviderState | undefined {
  const persisted = parseCursorProviderState(state);
  return Object.keys(persisted).length > 0 ? persisted : undefined;
}

function normalizeOpaqueString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
