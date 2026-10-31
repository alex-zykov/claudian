import type {
  ProviderPermissionModeOption,
  ProviderPermissionModePolicy,
} from '../../core/providers/types';

/** Gemini (agy) ACP session modes: default, autoEdit, plan, yolo. */
export const GEMINI_PERMISSION_MODES = ['default', 'autoEdit', 'plan', 'yolo'] as const;
export type GeminiPermissionMode = (typeof GEMINI_PERMISSION_MODES)[number];

export const GEMINI_PERMISSION_MODE_POLICY: ProviderPermissionModePolicy = Object.freeze({
  values: GEMINI_PERMISSION_MODES,
  fallbackValue: 'default',
  defaultValue: 'default',
  migrateValue(value: string): string | undefined {
    const normalized = value.trim();
    if (normalized === 'normal' || normalized === 'agent' || normalized === 'ask') {
      return 'default';
    }
    if (normalized === 'auto' || normalized === 'accept-edits' || normalized === 'acceptEdits') {
      return 'autoEdit';
    }
    return undefined;
  },
});

export const GEMINI_PERMISSION_MODE_OPTIONS: readonly ProviderPermissionModeOption[] = Object.freeze([
  {
    value: 'default',
    label: 'Default',
    description: 'Ask for approval before edits and commands',
  },
  {
    value: 'autoEdit',
    label: 'Auto-edit',
    description: 'Auto-approve file edits and ask for commands',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Read-only planning without making changes',
  },
  {
    value: 'yolo',
    label: 'YOLO',
    description: 'Auto-approve all tools without prompting',
    bypassesApprovals: true,
  },
]);

export function isGeminiPermissionMode(value: unknown): value is GeminiPermissionMode {
  return typeof value === 'string'
    && (GEMINI_PERMISSION_MODES as readonly string[]).includes(value);
}

/** Plan is a read-only Gemini ACP mode. */
export function isGeminiReadOnlyPermissionMode(value: string | undefined): boolean {
  return toGeminiACPSessionModeId(value) === 'plan';
}

export function toGeminiACPSessionModeId(permissionMode: string | undefined): GeminiPermissionMode {
  if (isGeminiPermissionMode(permissionMode)) {
    return permissionMode;
  }
  const migrated = permissionMode
    ? GEMINI_PERMISSION_MODE_POLICY.migrateValue?.(permissionMode, {})
    : undefined;
  if (isGeminiPermissionMode(migrated)) {
    return migrated;
  }
  return 'default';
}

export const toGeminiSessionModeId = toGeminiACPSessionModeId;

export function fromGeminiACPSessionModeId(modeId: string | undefined): GeminiPermissionMode {
  return toGeminiACPSessionModeId(modeId);
}
