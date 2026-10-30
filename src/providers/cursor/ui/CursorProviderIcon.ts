import type { ProviderIconSvg } from '../../../core/providers/types';

/**
 * Simple geometric mark inspired by a cursor caret / bracket — not a copy of
 * any copyrighted Cursor logo artwork.
 */
export const CURSOR_PROVIDER_ICON: ProviderIconSvg = {
  viewBox: '0 0 24 24',
  path: [
    'M4 3h7v2H6v14h5v2H4V3z',
    'M13 3h7v2h-5v5h4v2h-4v7h5v2h-7V3z',
  ].join(' '),
};
