/** A user-defined frontmatter field written into generated `.chat.md` files. */
export interface ChatFileCustomField {
  key: string;
  value: string;
}

/** Frontmatter keys Claudian writes itself; a custom field cannot reuse them. */
export const CHAT_FILE_RESERVED_KEYS: readonly string[] = [
  'claudian-chat',
  'claudian-chat-version',
  'id',
  'provider',
  'title',
  'created',
  'updated',
  'linked',
  'sessionId',
  'forkSessionId',
  'forkResumeAt',
];

export type ChatFileCustomFieldError = 'reserved' | 'duplicate';

const RESERVED_KEY_SET: ReadonlySet<string> = new Set(CHAT_FILE_RESERVED_KEYS.map(foldKey));

function foldKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * The collision of every row: a reserved key, or a key an earlier row already uses.
 * Keys compare without case or surrounding spaces. An unfinished row has no error.
 */
export function checkChatFileCustomFields(
  fields: readonly ChatFileCustomField[],
): (ChatFileCustomFieldError | null)[] {
  const seen = new Set<string>();
  return fields.map((field) => {
    const key = foldKey(field.key);
    if (key === '') return null;
    if (RESERVED_KEY_SET.has(key)) return 'reserved';
    if (seen.has(key)) return 'duplicate';
    seen.add(key);
    return null;
  });
}

/** The fields that can be written: complete, trimmed, and free of collisions. */
export function usableChatFileCustomFields(
  fields: readonly ChatFileCustomField[],
): ChatFileCustomField[] {
  const errors = checkChatFileCustomFields(fields);
  const usable: ChatFileCustomField[] = [];
  fields.forEach((field, index) => {
    const key = field.key.trim();
    const value = field.value.trim();
    if (errors[index] === null && key !== '' && value !== '') usable.push({ key, value });
  });
  return usable;
}

/** Decodes stored settings; malformed entries are dropped. */
export function decodeChatFileCustomFields(stored: unknown): ChatFileCustomField[] {
  if (!Array.isArray(stored)) return [];
  const fields: ChatFileCustomField[] = [];
  for (const entry of stored as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const { key, value } = entry as Record<string, unknown>;
    if (typeof key === 'string' && typeof value === 'string') fields.push({ key, value });
  }
  return usableChatFileCustomFields(fields);
}
