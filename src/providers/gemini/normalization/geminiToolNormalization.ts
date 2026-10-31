import { stringifyUnknown } from '@/utils/stringify';

import {
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_BASH_OUTPUT,
  TOOL_EDIT,
  TOOL_EDIT_IMAGE,
  TOOL_ENTER_PLAN_MODE,
  TOOL_EXIT_PLAN_MODE,
  TOOL_GENERATE_IMAGE,
  TOOL_GENERATE_VIDEO,
  TOOL_GREP,
  TOOL_KILL_SHELL,
  TOOL_LS,
  TOOL_NOTEBOOK_EDIT,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TODO_WRITE,
  TOOL_TOOL_SEARCH,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WORKFLOW,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import { normalizeToolResultDetails } from '../../../core/tools/toolResultDetails';
import type { ToolResultDetails } from '../../../core/types';
import type { ACPToolRawNameProvenance } from '../../acp/ACPToolStreamAdapter';
import { GEMINI_SUBAGENT_LIFECYCLE_TOOL_NAMES } from './geminiLifecycleToolNames';

const GEMINI_TOOL_NAME_MAP: Readonly<Record<string, string>> = {
  apply_patch: TOOL_APPLY_PATCH,
  ask_question: TOOL_ASK_USER_QUESTION,
  ask_user_question: TOOL_ASK_USER_QUESTION,
  edit_file: TOOL_EDIT,
  edit_notebook: TOOL_NOTEBOOK_EDIT,
  enter_plan_mode: TOOL_ENTER_PLAN_MODE,
  exit_plan_mode: TOOL_EXIT_PLAN_MODE,
  get_terminal_command_output: TOOL_BASH_OUTPUT,
  grep: TOOL_GREP,
  grep_search: TOOL_GREP,
  image_edit: TOOL_EDIT_IMAGE,
  image_gen: TOOL_GENERATE_IMAGE,
  image_to_video: TOOL_GENERATE_VIDEO,
  kill_terminal_command: TOOL_KILL_SHELL,
  list_dir: TOOL_LS,
  read_file: TOOL_READ,
  reference_to_video: TOOL_GENERATE_VIDEO,
  run_command: TOOL_BASH,
  run_terminal_command: TOOL_BASH,
  search_replace: TOOL_EDIT,
  search_tool: TOOL_TOOL_SEARCH,
  search_web: TOOL_WEB_SEARCH,
  skill: TOOL_SKILL,
  todo_write: TOOL_TODO_WRITE,
  web_fetch: TOOL_WEB_FETCH,
  web_search: TOOL_WEB_SEARCH,
  workflow: TOOL_WORKFLOW,
  write: TOOL_WRITE,
  write_file: TOOL_WRITE,
};

export interface GeminiNormalizedToolCall {
  input: Record<string, unknown>;
  name: string;
  output: string;
  rawInput: unknown;
  rawName: string;
  rawOutput: unknown;
}

export interface GeminiToolProviderPayload {
  rawInput?: unknown;
  rawName: string;
  rawOutput?: unknown;
}

export interface GeminiRawToolNameResolution {
  provenance: ACPToolRawNameProvenance;
  rawName: string;
}

export function normalizeGeminiToolName(rawName: string, rawInput?: unknown): string {
  const normalized = rawName.trim();
  const lookup = normalized.toLowerCase();
  if (GEMINI_SUBAGENT_LIFECYCLE_TOOL_NAMES.has(lookup)) {
    return normalized || 'tool';
  }
  if (lookup === 'use_tool' && isRecord(rawInput) && typeof rawInput.tool_name === 'string' && rawInput.tool_name.trim()) {
    return `mcp__${rawInput.tool_name.trim()}`;
  }
  return GEMINI_TOOL_NAME_MAP[lookup] ?? (normalized || 'tool');
}

export function resolveGeminiRawToolName(
  currentRawName: GeminiRawToolNameResolution | undefined,
  update: { kind?: string | null; title?: string | null },
): GeminiRawToolNameResolution {
  const title = update.title?.trim();
  const normalizedTitle = title?.toLowerCase();
  if (currentRawName?.provenance === 'title') {
    return currentRawName;
  }
  if (
    normalizedTitle
    && (
      normalizedTitle in GEMINI_TOOL_NAME_MAP
      || GEMINI_SUBAGENT_LIFECYCLE_TOOL_NAMES.has(normalizedTitle)
    )
  ) {
    return { provenance: 'title', rawName: normalizedTitle };
  }
  if (title) {
    return { provenance: 'title', rawName: title };
  }
  if (currentRawName) {
    return currentRawName;
  }
  const kind = update.kind?.trim();
  if (kind) {
    return { provenance: 'kind', rawName: kind };
  }
  return { provenance: 'fallback', rawName: 'tool' };
}

export function normalizeGeminiToolCall(value: {
  kind?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  title?: string | null;
}, currentRawName?: GeminiRawToolNameResolution): GeminiNormalizedToolCall {
  const rawName = resolveGeminiRawToolName(currentRawName, value).rawName;
  return {
    input: normalizeGeminiToolInput(rawName, value.rawInput),
    name: normalizeGeminiToolName(rawName, value.rawInput),
    output: formatToolOutput(value.rawOutput),
    rawInput: value.rawInput,
    rawName,
    rawOutput: value.rawOutput,
  };
}

export function buildGeminiToolProviderPayload(value: {
  rawInput?: unknown;
  rawName: string;
  rawOutput?: unknown;
}): GeminiToolProviderPayload {
  return {
    ...(value.rawInput !== undefined ? { rawInput: value.rawInput } : {}),
    rawName: value.rawName,
    ...(value.rawOutput !== undefined ? { rawOutput: value.rawOutput } : {}),
  };
}

export function normalizeGeminiToolResultDetails(
  _rawName: string,
  _input: Record<string, unknown>,
  rawOutput: unknown,
): ToolResultDetails | undefined {
  const output = isRecord(rawOutput) ? rawOutput : null;
  if (!output) return undefined;
  return normalizeToolResultDetails({});
}

export interface GeminiToolUpdateFields {
  content?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: unknown;
}

export function normalizeGeminiToolUpdate<T extends GeminiToolUpdateFields>(update: T): T {
  return update;
}

export function normalizeGeminiToolInput(rawName: string, value: unknown): Record<string, unknown> {
  const input = isRecord(value)
    ? value
    : value === undefined ? {} : { value };

  switch (rawName.trim().toLowerCase()) {
    case 'read_file':
      return addInputAlias(input, 'file_path', ['Path', 'target_file', 'path']);
    case 'edit_file':
    case 'write_file':
      return addInputAlias(input, 'file_path', ['Path', 'target_file', 'path']);
    case 'list_dir':
      return addInputAlias(input, 'path', ['DirectoryPath', 'target_directory']);
    case 'run_command':
    case 'run_terminal_command':
      return addInputAlias(input, 'command', ['CommandLine']);
    case 'skill':
      return addInputAlias(input, 'skill', ['name']);
    case 'invoke_subagent':
    case 'spawn_subagent':
    case 'task':
      return addInputAlias(
        addInputAlias(input, 'prompt', ['Prompt']),
        'description',
        ['Role'],
      );
    case 'use_tool':
      return isRecord(input.tool_input) ? input.tool_input : {};
    default:
      return input;
  }
}

function addInputAlias(
  input: Record<string, unknown>,
  targetKey: string,
  sourceKeys: readonly string[],
): Record<string, unknown> {
  if (input[targetKey] !== undefined) return input;
  for (const sourceKey of sourceKeys) {
    if (input[sourceKey] !== undefined) {
      return { ...input, [targetKey]: input[sourceKey] };
    }
  }
  return input;
}

function formatToolOutput(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return stringifyUnknown(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
