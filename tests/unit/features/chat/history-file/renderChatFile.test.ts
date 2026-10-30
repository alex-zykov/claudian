import { testDate } from '@test/helpers/testClock';
import { parseYaml } from 'obsidian';

import type { ChatMessage, Conversation } from '@/core/types';
import {
  escapeMarkdownForTranscript,
  renderChatFile,
} from '@/features/chat/history-file/renderChatFile';

const CREATED_AT = testDate({ hours: -2 }).getTime();
const UPDATED_AT = testDate({ hours: -1 }).getTime();

function createConversation(
  messages: ChatMessage[],
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: 'conv-abcdef12-3456-7890-abcd-ef1234567890',
    providerId: 'claude',
    title: 'Plan review',
    createdAt: CREATED_AT,
    lastActivityAt: UPDATED_AT,
    sessionId: 'session-1',
    messages,
    linkedContentPath: 'Projects/A/x.md',
    ...overrides,
  };
}

function user(content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `user-${content.slice(0, 8)}`,
    role: 'user',
    content,
    timestamp: CREATED_AT,
    ...overrides,
  };
}

function assistant(content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `assistant-${content.slice(0, 8)}`,
    role: 'assistant',
    content,
    timestamp: CREATED_AT,
    completedAt: UPDATED_AT,
    ...overrides,
  };
}

describe('escapeMarkdownForTranscript', () => {
  it('escapes wikilinks, tags, and task markers outside fences', () => {
    const input = [
      'See [[Note]] and #project',
      '- [ ] todo',
      '```',
      '[[keep]] #tag - [ ] inside',
      '```',
      'after #tag and [[x]]',
    ].join('\n');

    const escaped = escapeMarkdownForTranscript(input);
    expect(escaped).toContain('\\[\\[Note]]');
    expect(escaped).toContain('\\#project');
    expect(escaped).toContain('- \\[ ] todo');
    expect(escaped).toContain('[[keep]] #tag - [ ] inside');
    expect(escaped).toContain('\\#tag');
    expect(escaped).toContain('\\[\\[x]]');
  });

  it('leaves inline code spans untouched', () => {
    expect(escapeMarkdownForTranscript('use `[[x]]` and `#tag`')).toBe('use `[[x]]` and `#tag`');
  });
});

describe('renderChatFile', () => {
  it('excludes thinking, tool, rebuilt-context, and interrupt messages from the body', () => {
    const conversation = createConversation([
      user('visible question'),
      {
        ...user('interrupt'),
        isInterrupt: true,
      },
      {
        ...user('rebuilt\n\n<linked_content path="Projects/A/x.md" />'),
        isRebuiltContext: true,
      },
      assistant('answer with tools', {
        contentBlocks: [
          { type: 'thinking', content: 'secret thoughts' },
          { type: 'tool_use', toolId: 'tool-1' },
          { type: 'text', content: 'final answer mentions [[secret]]' },
        ],
        toolCalls: [{
          id: 'tool-1',
          name: 'Bash',
          input: { command: 'rm -rf /' },
          status: 'completed',
        }],
      }),
    ]);

    const { body } = renderChatFile(conversation);
    expect(body).toContain('visible question');
    expect(body).toContain('final answer mentions \\[\\[secret]]');
    expect(body).not.toContain('interrupt');
    expect(body).not.toContain('rebuilt');
    expect(body).not.toContain('secret thoughts');
    expect(body).not.toContain('tool-1');
    expect(body).not.toContain('Bash');
    expect(body).not.toContain('rm -rf');
  });

  it('uses displayContent or extractUserDisplayContent for user text', () => {
    const conversation = createConversation([
      user('raw with tags\n\n<linked_content path="Projects/A/x.md" />', {
        displayContent: 'display wins',
      }),
      user('query only\n\n<editor_selection note="a.md">picked</editor_selection>'),
      {
        ...user('hidden empty', { displayContent: '' }),
      },
    ]);

    const { body } = renderChatFile(conversation);
    expect(body).toContain('display wins');
    expect(body).toContain('query only');
    expect(body).not.toContain('raw with tags');
    expect(body).not.toContain('linked_content');
    expect(body).not.toContain('editor_selection');
    expect(body).not.toContain('hidden empty');
  });

  it('states that the body is generated and edits are overwritten', () => {
    const { body } = renderChatFile(createConversation([user('hi')]));
    expect(body).toMatch(/^>\s*\[!note\].*generated/i);
    expect(body.toLowerCase()).toContain('overwritten');
  });

  it('emits byte-stable output for the same conversation', () => {
    const conversation = createConversation([
      user('hello #tag and [[Note]]'),
      assistant('world', {
        contentBlocks: [{ type: 'text', content: '- [ ] done' }],
      }),
    ]);

    const first = renderChatFile(conversation);
    expect(renderChatFile(conversation)).toEqual(first);
    expect(renderChatFile(structuredClone(conversation))).toEqual(first);
  });

  it('round-trips frontmatter through parseYaml', () => {
    const conversation = createConversation([user('hi')], {
      providerState: {
        forkSource: { sessionId: 'parent-session', resumeAt: 'msg-1' },
      },
    });
    const { frontmatter } = renderChatFile(conversation);
    const yaml = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n');

    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed).toEqual(frontmatter);
    expect(frontmatter).toMatchObject({
      'claudian-chat': true,
      'claudian-chat-version': 1,
      id: conversation.id,
      provider: 'claude',
      title: 'Plan review',
      created: new Date(CREATED_AT).toISOString(),
      updated: new Date(UPDATED_AT).toISOString(),
      linked: 'Projects/A/x.md',
      sessionId: 'session-1',
      forkSessionId: 'parent-session',
      forkResumeAt: 'msg-1',
    });
  });

  it('omits fork fields and linked when absent', () => {
    const conversation = createConversation([user('hi')], {
      linkedContentPath: undefined,
      sessionId: null,
      providerState: undefined,
    });
    const { frontmatter } = renderChatFile(conversation);
    expect(frontmatter.linked).toBeUndefined();
    expect(frontmatter.sessionId).toBeUndefined();
    expect(frontmatter.forkSessionId).toBeUndefined();
    expect(frontmatter.forkResumeAt).toBeUndefined();
  });
});
