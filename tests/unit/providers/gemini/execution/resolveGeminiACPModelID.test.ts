import { resolveGeminiACPModelID } from '@/providers/gemini/execution/resolveGeminiACPModelID';

describe('resolveGeminiACPModelID', () => {
  const available = [
    'auto-gemini-3',
    'auto-gemini-2.5',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ];

  it('maps auto onto auto-gemini-3 when available', () => {
    expect(resolveGeminiACPModelID('auto', available)).toBe('auto-gemini-3');
  });

  it('keeps an exact ACP id', () => {
    expect(resolveGeminiACPModelID('gemini-2.5-pro', available)).toBe('gemini-2.5-pro');
  });

  it('returns null when nothing matches', () => {
    expect(resolveGeminiACPModelID('not-a-model', available)).toBeNull();
  });

  it('resolves a base model + reasoning effort against variant ACP model ids', () => {
    const variantAvailable = [
      'gemini-4-argon-high',
      'gemini-4-argon-medium',
      'gemini-4-argon-low',
    ];
    expect(resolveGeminiACPModelID('gemini-4-argon', variantAvailable, 'medium'))
      .toBe('gemini-4-argon-medium');
    expect(resolveGeminiACPModelID('gemini-4-argon', variantAvailable))
      .toBe('gemini-4-argon-high');
  });
});
