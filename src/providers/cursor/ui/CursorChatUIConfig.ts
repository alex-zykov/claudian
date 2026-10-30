import type { ProviderChatUIConfig } from '../../../core/providers/types';
import { cursorModelPolicy } from '../CursorModelPolicy';
import { CURSOR_PERMISSION_MODE_OPTIONS } from '../permissionModes';
import { CURSOR_PROVIDER_ICON } from './CursorProviderIcon';

export const cursorChatUIConfig: ProviderChatUIConfig = {
  ...cursorModelPolicy,
  getPermissionModeOptions() {
    return CURSOR_PERMISSION_MODE_OPTIONS;
  },
  getModeSelector(): null {
    return null;
  },
  getProviderIcon() {
    return CURSOR_PROVIDER_ICON;
  },
};
