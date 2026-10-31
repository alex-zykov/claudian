import type { ProviderCapabilities } from '../../core/providers/types';

export const GEMINI_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'gemini',
  supportsResponseThroughput: false,
  supportsNativeHistory: true,
  supportsEphemeralSessions: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});
