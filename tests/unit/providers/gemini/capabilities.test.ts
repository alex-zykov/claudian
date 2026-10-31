import { GEMINI_PROVIDER_CAPABILITIES } from '@/providers/gemini/capabilities';

describe('GEMINI_PROVIDER_CAPABILITIES', () => {
  it('matches the agy ACP capability matrix', () => {
    expect(GEMINI_PROVIDER_CAPABILITIES).toEqual({
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
  });
});
