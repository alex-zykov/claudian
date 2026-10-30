import { resolveCursorACPModelID } from '@/providers/cursor/execution/resolveCursorACPModelID';

describe('resolveCursorACPModelID', () => {
  const available = [
    'default[]',
    'composer-2.5[fast=true]',
    'gpt-5.2[reasoning=medium,fast=false]',
  ];

  it('maps CLI auto onto ACP default[]', () => {
    expect(resolveCursorACPModelID('auto', available)).toBe('default[]');
  });

  it('maps bare composer-2.5 onto the bracketed ACP id', () => {
    expect(resolveCursorACPModelID('composer-2.5', available))
      .toBe('composer-2.5[fast=true]');
  });

  it('keeps an exact ACP id', () => {
    expect(resolveCursorACPModelID('composer-2.5[fast=true]', available))
      .toBe('composer-2.5[fast=true]');
  });

  it('returns null when nothing matches', () => {
    expect(resolveCursorACPModelID('not-a-model', available)).toBeNull();
  });
});
