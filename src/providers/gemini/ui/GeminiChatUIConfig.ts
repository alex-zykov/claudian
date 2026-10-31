import type { ProviderChatUIConfig } from '../../../core/providers/types';
import { geminiModelPolicy } from '../GeminiModelPolicy';
import { GEMINI_PERMISSION_MODE_OPTIONS } from '../permissionModes';
import { GEMINI_PROVIDER_ICON } from './GeminiProviderIcon';

export const geminiChatUIConfig: ProviderChatUIConfig = {
  ...geminiModelPolicy,
  getPermissionModeOptions() {
    return GEMINI_PERMISSION_MODE_OPTIONS;
  },
  getModeSelector(): null {
    return null;
  },
  getProviderIcon() {
    return GEMINI_PROVIDER_ICON;
  },
};
