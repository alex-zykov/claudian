import {
  GEMINI_PERMISSION_MODE_OPTIONS,
  GEMINI_PERMISSION_MODE_POLICY,
  isGeminiReadOnlyPermissionMode,
  toGeminiSessionModeId,
} from '@/providers/gemini/permissionModes';

describe('Gemini permission modes', () => {
  it('maps Claudian permission modes to agy ACP session mode ids', () => {
    expect(toGeminiSessionModeId('default')).toBe('default');
    expect(toGeminiSessionModeId('autoEdit')).toBe('autoEdit');
    expect(toGeminiSessionModeId('accept-edits')).toBe('autoEdit');
    expect(toGeminiSessionModeId('acceptEdits')).toBe('autoEdit');
    expect(toGeminiSessionModeId('plan')).toBe('plan');
    expect(toGeminiSessionModeId('yolo')).toBe('yolo');
    expect(toGeminiSessionModeId(undefined)).toBe('default');
    expect(GEMINI_PERMISSION_MODE_POLICY.fallbackValue).toBe('default');
  });

  it('treats plan as read-only', () => {
    expect(isGeminiReadOnlyPermissionMode('default')).toBe(false);
    expect(isGeminiReadOnlyPermissionMode('autoEdit')).toBe(false);
    expect(isGeminiReadOnlyPermissionMode('yolo')).toBe(false);
    expect(isGeminiReadOnlyPermissionMode('plan')).toBe(true);
  });

  it('exposes the four Gemini ACP modes', () => {
    expect(GEMINI_PERMISSION_MODE_OPTIONS.map(option => option.value)).toEqual([
      'default',
      'autoEdit',
      'plan',
      'yolo',
    ]);
  });
});
