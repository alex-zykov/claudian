import type {
  ProviderSubagentLifecycleAdapter,
  ProviderSubagentWaitResult,
  ProviderSubagentWaitStatus,
} from '../../../core/providers/types';
import type { SubagentInfo, ToolCallInfo } from '../../../core/types';
import {
  GEMINI_SUBAGENT_CLOSE_TOOL_NAMES,
  GEMINI_SUBAGENT_SPAWN_TOOL_NAMES,
  GEMINI_SUBAGENT_WAIT_TOOL_NAMES,
} from './geminiLifecycleToolNames';

const GEMINI_SUBAGENT_SPAWN_TOOLS: ReadonlySet<string> = new Set(GEMINI_SUBAGENT_SPAWN_TOOL_NAMES);
const GEMINI_SUBAGENT_WAIT_TOOLS: ReadonlySet<string> = new Set(GEMINI_SUBAGENT_WAIT_TOOL_NAMES);
const GEMINI_SUBAGENT_CLOSE_TOOLS: ReadonlySet<string> = new Set(GEMINI_SUBAGENT_CLOSE_TOOL_NAMES);

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJSON(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function getRawOutput(toolCall: ToolCallInfo | undefined, raw: string | undefined): unknown {
  return toolCall?.providerPayload?.rawOutput ?? parseJSON(raw);
}

function extractTaskId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.match(/\b(?:task|subagent|agent|conversation)_id\s*[:=]\s*["']?([a-zA-Z0-9._:-]+)/i)?.[1];
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractTaskId(item);
      if (id) return id;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const direct = firstString(value, ['conversationId', 'task_id', 'subagent_id', 'agent_id', 'id']);
  if (direct) return direct;
  for (const key of ['text', 'output', 'message', 'result', 'Result'] as const) {
    const id = extractTaskId(value[key]);
    if (id) return id;
  }
  return undefined;
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    const parts = value.map(extractText).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  if (!isRecord(value)) return undefined;

  const direct = firstString(value, ['output', 'text', 'error', 'message', 'result']);
  if (direct) return direct;
  if (value.Result !== undefined) return extractText(value.Result);
  return undefined;
}

function getTargetIds(toolCall: ToolCallInfo): string[] {
  const result = new Set<string>();
  const singular = toolCall.input.task_id ?? toolCall.input.conversationId;
  if (typeof singular === 'string' && singular) result.add(singular);
  const plural = toolCall.input.task_ids ?? toolCall.input.ConversationIds;
  if (Array.isArray(plural)) {
    for (const value of plural) {
      if (typeof value === 'string' && value) result.add(value);
    }
  }
  return [...result];
}

function getLifecycleTargetIds(toolCall: ToolCallInfo): string[] {
  const targetIds = new Set(getTargetIds(toolCall));
  const waitResult = extractGeminiWaitResult(toolCall.result, toolCall);
  for (const taskId of Object.keys(waitResult.statuses)) {
    targetIds.add(taskId);
  }
  return [...targetIds];
}

export function extractGeminiSpawnResult(
  raw: string | undefined,
  toolCall?: ToolCallInfo,
): { agentId?: string } {
  const inputId = toolCall && typeof toolCall.input.task_id === 'string'
    ? toolCall.input.task_id
    : undefined;
  const outputId = extractTaskId(getRawOutput(toolCall, raw));
  return { ...(inputId || outputId ? { agentId: inputId || outputId } : {}) };
}

export function extractGeminiWaitResult(
  raw: string | undefined,
  toolCall?: ToolCallInfo,
): ProviderSubagentWaitResult {
  const statuses: Record<string, ProviderSubagentWaitStatus> = {};
  const rawOutput = getRawOutput(toolCall, raw);
  const targets = toolCall ? getTargetIds(toolCall) : [];
  const renderedText = extractText(rawOutput) ?? (typeof raw === 'string' ? raw.trim() : '');
  const timedOut = isRecord(rawOutput) && rawOutput.timed_out === true
    || /timed?\s*out|still running|in progress/i.test(renderedText);

  if (targets.length === 1 && !timedOut && renderedText) {
    const id = targets[0];
    if (toolCall?.status === 'error' || /cancel|error|fail|kill/i.test(renderedText)) {
      statuses[id] = { error: renderedText };
    } else {
      statuses[id] = { completed: renderedText };
    }
  }

  return { statuses, timedOut };
}

function getDescription(spawnToolCall: ToolCallInfo): string {
  if (typeof spawnToolCall.input.description === 'string' && spawnToolCall.input.description.trim()) {
    return spawnToolCall.input.description.trim();
  }
  if (typeof spawnToolCall.input.Role === 'string' && spawnToolCall.input.Role.trim()) {
    return spawnToolCall.input.Role.trim();
  }
  if (typeof spawnToolCall.input.subagent_type === 'string' && spawnToolCall.input.subagent_type.trim()) {
    return `${spawnToolCall.input.subagent_type.trim()} subagent`;
  }
  return 'Gemini subagent';
}

function getPrompt(spawnToolCall: ToolCallInfo): string {
  if (typeof spawnToolCall.input.prompt === 'string') return spawnToolCall.input.prompt;
  if (typeof spawnToolCall.input.Prompt === 'string') return spawnToolCall.input.Prompt;
  return '';
}

export function buildGeminiSubagentInfo(
  spawnToolCall: ToolCallInfo,
  _siblingToolCalls: ToolCallInfo[] = [],
): SubagentInfo {
  const launch = extractGeminiSpawnResult(spawnToolCall.result, spawnToolCall);
  const base: SubagentInfo = {
    id: spawnToolCall.id,
    description: getDescription(spawnToolCall),
    prompt: getPrompt(spawnToolCall),
    mode: 'sync',
    isExpanded: false,
    status: 'running',
    toolCalls: [],
    ...(launch.agentId ? { agentId: launch.agentId } : {}),
  };

  if (spawnToolCall.status === 'error') {
    const result = extractText(getRawOutput(spawnToolCall, spawnToolCall.result))
      ?? spawnToolCall.result;
    return {
      ...base,
      result,
      status: 'error',
    };
  }

  if (spawnToolCall.status !== 'completed') return base;
  return {
    ...base,
    result: extractText(getRawOutput(spawnToolCall, spawnToolCall.result))
      ?? spawnToolCall.result,
    status: 'completed',
  };
}

export const geminiSubagentLifecycleAdapter: ProviderSubagentLifecycleAdapter = {
  protocol: 'lifecycle',
  isHiddenTool(name) {
    const normalized = normalizedName(name);
    return GEMINI_SUBAGENT_WAIT_TOOLS.has(normalized)
      || GEMINI_SUBAGENT_CLOSE_TOOLS.has(normalized);
  },
  isToolCallFullyOwned(toolCall, agentIdToSpawnId) {
    const targetIds = getLifecycleTargetIds(toolCall);
    return targetIds.length > 0 && targetIds.every(taskId => agentIdToSpawnId.has(taskId));
  },
  isSpawnTool(name) {
    return GEMINI_SUBAGENT_SPAWN_TOOLS.has(normalizedName(name));
  },
  isWaitTool(name) {
    return GEMINI_SUBAGENT_WAIT_TOOLS.has(normalizedName(name));
  },
  isCloseTool(name) {
    return GEMINI_SUBAGENT_CLOSE_TOOLS.has(normalizedName(name));
  },
  resolveSpawnToolIds(lifecycleToolCall, agentIdToSpawnId) {
    const spawnIds = new Set<string>();
    for (const taskId of getLifecycleTargetIds(lifecycleToolCall)) {
      const spawnId = agentIdToSpawnId.get(taskId);
      if (spawnId) spawnIds.add(spawnId);
    }
    return [...spawnIds];
  },
  buildSubagentInfo: buildGeminiSubagentInfo,
  extractSpawnResult: extractGeminiSpawnResult,
  extractWaitResult: extractGeminiWaitResult,
};
