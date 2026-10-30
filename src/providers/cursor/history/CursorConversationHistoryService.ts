import { copyProviderHistoryState } from '@/core/providers/providerHistory';

import { mergePersistedProviderState } from '../../../core/providers/providerState';
import type {
  ProviderConversationHistoryService,
  ProviderHistoryInput,
  ProviderHistoryPathContext,
  ProviderHistoryResult,
  ProviderHistoryUpdate,
} from '../../../core/providers/types';
import {
  buildPersistedCursorProviderState,
  parseCursorProviderState,
} from '../types';


const CURSOR_PROVIDER_STATE_KEYS = [
  'cwd',
  'nativeConversationContextEstablished',
] as const;

/**
 * Cursor restores transcript content via ACP `session/load` at execution time
 * (replayed `session/update` notifications). Hydration keeps messages already on
 * the conversation and only refreshes small provider state.
 */
export class CursorConversationHistoryService implements ProviderConversationHistoryService {

  async hydrateConversationHistory(
    input: ProviderHistoryInput,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<ProviderHistoryUpdate> {
    const conversation = copyProviderHistoryState(input);
    const state = parseCursorProviderState(conversation.providerState);
    const cwd = resolveCursorCwdHint(state.cwd, pathContext);
    const nextState = buildPersistedCursorProviderState({
      ...state,
      ...(cwd ? { cwd } : {}),
      ...(conversation.sessionId
        && state.nativeConversationContextEstablished !== false
        ? { nativeConversationContextEstablished: true }
        : state.nativeConversationContextEstablished !== undefined
          ? { nativeConversationContextEstablished: state.nativeConversationContextEstablished }
          : {}),
    });
    conversation.providerState = mergePersistedProviderState(
      conversation.providerState,
      CURSOR_PROVIDER_STATE_KEYS,
      nextState as Record<string, unknown> | undefined,
    );
    return conversation;
  }

  resolveSessionIdForConversation(conversation: ProviderHistoryInput | null): string | null {
    return conversation?.sessionId ?? null;
  }

  async resolveMissingConversationSession(
    input: ProviderHistoryInput,
    _vaultPath: string | null,
    missingProviderSessionId?: string,
  ): Promise<ProviderHistoryResult<'delete' | 'reset' | 'preserve'>> {
    const conversation = copyProviderHistoryState(input);
    if (
      !conversation.sessionId
      || !missingProviderSessionId
      || conversation.sessionId !== missingProviderSessionId
    ) {
      return { outcome: 'preserve' };
    }

    const providerState = { ...conversation.providerState };
    for (const key of CURSOR_PROVIDER_STATE_KEYS) delete providerState[key];
    conversation.sessionId = null;
    conversation.providerState = Object.keys(providerState).length > 0
      ? providerState
      : undefined;
    return { outcome: 'reset', changes: conversation };
  }

  isPendingForkConversation(_conversation: ProviderHistoryInput): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    // Cursor ACP has no session/fork; preserve only cwd-like hints if present.
    const sourceState = parseCursorProviderState(sourceProviderState);
    return (buildPersistedCursorProviderState({
      ...(sourceState.cwd ? { cwd: sourceState.cwd } : {}),
    }) as Record<string, unknown> | undefined) ?? {};
  }

  buildPersistedProviderState(
    conversation: ProviderHistoryInput,
  ): Record<string, unknown> | undefined {
    return mergePersistedProviderState(
      conversation.providerState,
      CURSOR_PROVIDER_STATE_KEYS,
      buildPersistedCursorProviderState(
        parseCursorProviderState(conversation.providerState),
      ) as Record<string, unknown> | undefined,
    );
  }
}

function resolveCursorCwdHint(
  persistedCwd: string | undefined,
  pathContext: ProviderHistoryPathContext | undefined,
): string | undefined {
  if (persistedCwd) return persistedCwd;
  const vaultPath = pathContext?.vaultPath?.trim();
  return vaultPath || undefined;
}
