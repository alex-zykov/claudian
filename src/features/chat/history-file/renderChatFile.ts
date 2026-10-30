import { extractUserDisplayContent } from '@/core/prompt/promptContext';
import type { ChatMessage, Conversation } from '@/core/types';

export const CHAT_FILE_VERSION = 1;

export interface ChatFileFrontmatter {
  'claudian-chat': true;
  'claudian-chat-version': typeof CHAT_FILE_VERSION;
  id: string;
  provider: string;
  title: string;
  created: string;
  updated: string;
  linked?: string;
  sessionId?: string;
  forkSessionId?: string;
  forkResumeAt?: string;
}

export interface RenderedChatFile {
  frontmatter: ChatFileFrontmatter;
  body: string;
}

const GENERATED_CALLOUT = [
  '> [!note] Generated transcript',
  '> This file is generated from the chat. Edits are overwritten on the next turn.',
  '',
].join('\n');

/**
 * Escape Obsidian-sensitive markdown outside fenced code and inline code spans:
 * wikilinks (`[[`), tags (`#tag`), and unchecked task markers (`- [ ]`).
 */
export function escapeMarkdownForTranscript(text: string): string {
  return transformOutsideCode(text, escapeSensitiveMarkdown);
}

export function renderChatFile(conversation: Conversation): RenderedChatFile {
  const frontmatter = buildFrontmatter(conversation);
  const sections: string[] = [GENERATED_CALLOUT];

  for (const message of conversation.messages) {
    if (message.role === 'user') {
      const text = resolveUserTranscriptText(message);
      if (text === undefined) continue;
      sections.push(formatSpeakerSection('User', text));
      continue;
    }

    const text = resolveAssistantTranscriptText(message);
    if (text === undefined) continue;
    sections.push(formatSpeakerSection('Assistant', text));
  }

  return {
    frontmatter,
    body: sections.join('\n').replace(/\n+$/, '\n'),
  };
}

function buildFrontmatter(conversation: Conversation): ChatFileFrontmatter {
  const frontmatter: ChatFileFrontmatter = {
    'claudian-chat': true,
    'claudian-chat-version': CHAT_FILE_VERSION,
    id: conversation.id,
    provider: conversation.providerId,
    title: conversation.title,
    created: new Date(conversation.createdAt).toISOString(),
    updated: new Date(conversation.lastActivityAt).toISOString(),
  };

  if (conversation.linkedContentPath) {
    frontmatter.linked = conversation.linkedContentPath;
  }
  if (conversation.sessionId) {
    frontmatter.sessionId = conversation.sessionId;
  }

  const fork = readForkSource(conversation.providerState);
  if (fork) {
    frontmatter.forkSessionId = fork.sessionId;
    frontmatter.forkResumeAt = fork.resumeAt;
  }

  return frontmatter;
}

function readForkSource(
  providerState: Record<string, unknown> | undefined,
): { sessionId: string; resumeAt: string } | undefined {
  if (!providerState) return undefined;
  const fork = providerState.forkSource;
  if (!fork || typeof fork !== 'object' || Array.isArray(fork)) return undefined;
  const record = fork as Record<string, unknown>;
  if (typeof record.sessionId !== 'string' || typeof record.resumeAt !== 'string') {
    return undefined;
  }
  return { sessionId: record.sessionId, resumeAt: record.resumeAt };
}

function resolveUserTranscriptText(message: ChatMessage): string | undefined {
  if (message.isInterrupt || message.isRebuiltContext) return undefined;
  if (message.displayContent === '') return undefined;

  const raw = message.displayContent
    ?? extractUserDisplayContent(message.content)
    ?? message.content;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveAssistantTranscriptText(message: ChatMessage): string | undefined {
  if (message.isInterrupt || message.isRebuiltContext) return undefined;

  const fromBlocks = message.contentBlocks
    ?.filter((block): block is { type: 'text'; content: string } => block.type === 'text')
    .map(block => block.content)
    .filter(content => content.trim().length > 0)
    .join('\n\n');

  const raw = fromBlocks && fromBlocks.length > 0 ? fromBlocks : message.content;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatSpeakerSection(speaker: 'User' | 'Assistant', text: string): string {
  return `### ${speaker}\n\n${escapeMarkdownForTranscript(text)}\n`;
}

function escapeSensitiveMarkdown(text: string): string {
  return text
    .replace(/\[\[/g, '\\[\\[')
    .replace(/(^|[\s([{>])#([\p{L}\p{N}_/-]+)/gu, '$1\\#$2')
    .replace(/^(\s*[-*+]\s+)\[ \]/gm, '$1\\[ ]');
}

function transformOutsideCode(text: string, transform: (chunk: string) => string): string {
  const parts: string[] = [];
  let index = 0;
  while (index < text.length) {
    const fenceStart = text.indexOf('```', index);
    const inlineStart = text.indexOf('`', index);
    const nextFence = fenceStart === -1 ? Infinity : fenceStart;
    const nextInline = inlineStart === -1 ? Infinity : inlineStart;
    const next = Math.min(nextFence, nextInline);

    if (next === Infinity) {
      parts.push(transform(text.slice(index)));
      break;
    }

    parts.push(transform(text.slice(index, next)));

    if (next === nextFence) {
      const fenceEnd = text.indexOf('```', next + 3);
      if (fenceEnd === -1) {
        parts.push(text.slice(next));
        break;
      }
      parts.push(text.slice(next, fenceEnd + 3));
      index = fenceEnd + 3;
      continue;
    }

    const inlineEnd = text.indexOf('`', next + 1);
    if (inlineEnd === -1) {
      parts.push(transform(text.slice(next)));
      break;
    }
    parts.push(text.slice(next, inlineEnd + 1));
    index = inlineEnd + 1;
  }
  return parts.join('');
}
