import { resolveLinkedFolder } from '@/core/path/ResolveLinkedFolder';
import type { Conversation } from '@/core/types';

// Control characters are stripped so titles cannot inject path separators or terminal junk.
// eslint-disable-next-line no-control-regex -- intentional filename sanitization
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g;

export function sanitizeChatFileTitle(title: string): string {
  const cleaned = title.replace(UNSAFE_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : 'Chat';
}

export function conversationIdShort(conversationId: string): string {
  return conversationId.replace(/-/g, '').slice(0, 8);
}

export function preferredChatFilePath(
  conversation: Pick<Conversation, 'id' | 'title' | 'linkedContentPath'>,
  isFolder: (path: string) => boolean | undefined,
): { preferred: string; collision: string; folder: string } {
  const folder = resolveLinkedFolder(conversation.linkedContentPath, isFolder);
  const base = sanitizeChatFileTitle(conversation.title);
  const id8 = conversationIdShort(conversation.id);
  const prefix = folder.length > 0 ? `${folder}/` : '';
  return {
    folder,
    preferred: `${prefix}${base}.chat.md`,
    collision: `${prefix}${base} ${id8}.chat.md`,
  };
}

export function chatFilePathForTitle(
  folder: string,
  title: string,
  conversationId: string,
  useCollisionName: boolean,
): string {
  const base = sanitizeChatFileTitle(title);
  const name = useCollisionName
    ? `${base} ${conversationIdShort(conversationId)}.chat.md`
    : `${base}.chat.md`;
  return folder.length > 0 ? `${folder}/${name}` : name;
}
