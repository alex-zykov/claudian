import {
  isCursorReadOnlyPermissionMode,
  toCursorSessionModeId,
  CURSOR_PERMISSION_MODE_OPTIONS,
  CURSOR_PERMISSION_MODE_POLICY,
} from '@/providers/cursor/permissionModes';

describe('Cursor permission modes', () => {
  it('maps Claudian permission modes to ACP session mode ids', () => {
    expect(toCursorSessionModeId('agent')).toBe('agent');
    expect(toCursorSessionModeId('plan')).toBe('plan');
    expect(toCursorSessionModeId('ask')).toBe('ask');
    expect(toCursorSessionModeId('yolo')).toBe('agent');
    expect(toCursorSessionModeId(undefined)).toBe(CURSOR_PERMISSION_MODE_POLICY.fallbackValue);
  });

  it('treats plan and ask as read-only', () => {
    expect(isCursorReadOnlyPermissionMode('agent')).toBe(false);
    expect(isCursorReadOnlyPermissionMode('plan')).toBe(true);
    expect(isCursorReadOnlyPermissionMode('ask')).toBe(true);
  });

  it('exposes the three Cursor ACP modes', () => {
    expect(CURSOR_PERMISSION_MODE_OPTIONS.map(option => option.value)).toEqual([
      'agent',
      'plan',
      'ask',
    ]);
  });
});
