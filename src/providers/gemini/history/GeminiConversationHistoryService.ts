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
  buildPersistedGeminiProviderState,
  parseGeminiProviderState,
} from '../types';

const GEMINI_PROVIDER_STATE_KEYS = [
  'cwd',
  'nativeConversationContextEstablished',
] as const;

/**
 * Gemini (`agy acp`) restores transcript content via ACP `session/load` at execution
 * time. Hydration keeps messages already on the conversation and refreshes small
 * provider state.
 */
export class GeminiConversationHistoryService implements ProviderConversationHistoryService {

  async hydrateConversationHistory(
    input: ProviderHistoryInput,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<ProviderHistoryUpdate> {
    const conversation = copyProviderHistoryState(input);
    const state = parseGeminiProviderState(conversation.providerState);
    const cwd = resolveGeminiCwdHint(state.cwd, pathContext);
    const nextState = buildPersistedGeminiProviderState({
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
      GEMINI_PROVIDER_STATE_KEYS,
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
    for (const key of GEMINI_PROVIDER_STATE_KEYS) delete providerState[key];
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
    const sourceState = parseGeminiProviderState(sourceProviderState);
    return (buildPersistedGeminiProviderState({
      ...(sourceState.cwd ? { cwd: sourceState.cwd } : {}),
    }) as Record<string, unknown> | undefined) ?? {};
  }

  buildPersistedProviderState(
    conversation: ProviderHistoryInput,
  ): Record<string, unknown> | undefined {
    return mergePersistedProviderState(
      conversation.providerState,
      GEMINI_PROVIDER_STATE_KEYS,
      buildPersistedGeminiProviderState(
        parseGeminiProviderState(conversation.providerState),
      ) as Record<string, unknown> | undefined,
    );
  }
}

function resolveGeminiCwdHint(
  persistedCwd: string | undefined,
  pathContext: ProviderHistoryPathContext | undefined,
): string | undefined {
  if (persistedCwd) return persistedCwd;
  const vaultPath = pathContext?.vaultPath?.trim();
  return vaultPath || undefined;
}
