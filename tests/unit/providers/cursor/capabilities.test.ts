import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { CURSOR_PROVIDER_CAPABILITIES } from '@/providers/cursor/capabilities';

describe('CURSOR_PROVIDER_CAPABILITIES', () => {
  it('matches the evidence-backed capability matrix', () => {
    expect(CURSOR_PROVIDER_CAPABILITIES).toEqual({
      providerId: 'cursor',
      supportsResponseThroughput: false,
      supportsNativeHistory: true,
      supportsEphemeralSessions: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: false,
      supportsImageAttachments: true,
      supportsTurnSteer: false,
      reasoningControl: 'none',
    });
  });

  it('is backed by a line in the ACP evidence notes', () => {
    const evidence = readFileSync(
      path.join(process.cwd(), 'tests/fixtures/providers/cursor/runtime/evidence-notes.md'),
      'utf8',
    );
    expect(evidence).toContain('supportsNativeHistory');
    expect(evidence).toContain('supportsFork');
    expect(evidence).toContain('supportsRewind');
    expect(evidence).toContain('supportsTurnSteer');
    expect(evidence).toContain('supportsImageAttachments');
    expect(evidence).toContain('supportsProviderCommands');
    expect(evidence).toContain('reasoningControl');
    expect(evidence).toContain('supportsEphemeralSessions');
  });
});
