import type {
  ProviderPermissionModeOption,
  ProviderPermissionModePolicy,
} from '../../core/providers/types';

/** Cursor ACP session modes: agent (full tools), plan (read-only planning), ask (read-only Q&A). */
export const CURSOR_PERMISSION_MODES = ['agent', 'plan', 'ask'] as const;
export type CursorPermissionMode = (typeof CURSOR_PERMISSION_MODES)[number];

export const CURSOR_PERMISSION_MODE_POLICY: ProviderPermissionModePolicy = Object.freeze({
  values: CURSOR_PERMISSION_MODES,
  fallbackValue: 'agent',
  defaultValue: 'agent',
});

export const CURSOR_PERMISSION_MODE_OPTIONS: readonly ProviderPermissionModeOption[] = Object.freeze([
  {
    value: 'agent',
    label: 'Agent',
    description: 'Full tool access for implementation work',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Read-only planning without making changes',
  },
  {
    value: 'ask',
    label: 'Ask',
    description: 'Read-only Q&A without making changes',
  },
]);

export function isCursorPermissionMode(value: unknown): value is CursorPermissionMode {
  return typeof value === 'string'
    && (CURSOR_PERMISSION_MODES as readonly string[]).includes(value);
}

/** Plan and ask are read-only Cursor ACP modes. */
export function isCursorReadOnlyPermissionMode(value: string | undefined): boolean {
  const mode = toCursorACPSessionModeId(value);
  return mode === 'plan' || mode === 'ask';
}

/** Claudian permissionMode values are the Cursor ACP session mode ids. */
export function toCursorACPSessionModeId(permissionMode: string | undefined): CursorPermissionMode {
  if (isCursorPermissionMode(permissionMode)) {
    return permissionMode;
  }
  return 'agent';
}

/** Alias used by the execution session. */
export const toCursorSessionModeId = toCursorACPSessionModeId;

export function fromCursorACPSessionModeId(modeId: string | undefined): CursorPermissionMode {
  return toCursorACPSessionModeId(modeId);
}
