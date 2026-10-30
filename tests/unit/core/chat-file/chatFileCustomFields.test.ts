import {
  CHAT_FILE_RESERVED_KEYS,
  checkChatFileCustomFields,
  decodeChatFileCustomFields,
  usableChatFileCustomFields,
} from '@/core/chat-file/chatFileCustomFields';

describe('checkChatFileCustomFields', () => {
  it('accepts fields that do not clash with the file', () => {
    expect(checkChatFileCustomFields([
      { key: 'type', value: 'chat' },
      { key: 'kind', value: 'ai' },
    ])).toEqual([null, null]);
  });

  it.each(CHAT_FILE_RESERVED_KEYS)('rejects the reserved key %s', (key) => {
    expect(checkChatFileCustomFields([{ key, value: 'x' }])).toEqual(['reserved']);
  });

  it('compares keys without case or surrounding spaces', () => {
    expect(checkChatFileCustomFields([
      { key: ' Claudian-Chat ', value: 'x' },
      { key: 'ID', value: 'x' },
    ])).toEqual(['reserved', 'reserved']);
  });

  it('flags a repeated key on every row after the first', () => {
    expect(checkChatFileCustomFields([
      { key: 'type', value: 'a' },
      { key: 'Type', value: 'b' },
      { key: 'other', value: 'c' },
    ])).toEqual([null, 'duplicate', null]);
  });

  it('does not flag an unfinished row', () => {
    expect(checkChatFileCustomFields([{ key: '', value: '' }, { key: ' ', value: 'x' }]))
      .toEqual([null, null]);
  });
});

describe('usableChatFileCustomFields', () => {
  it('keeps trimmed complete fields and drops unfinished, reserved and repeated ones', () => {
    expect(usableChatFileCustomFields([
      { key: ' type ', value: ' chat ' },
      { key: '', value: 'orphan' },
      { key: 'empty', value: '  ' },
      { key: 'title', value: 'x' },
      { key: 'TYPE', value: 'again' },
    ])).toEqual([{ key: 'type', value: 'chat' }]);
  });
});

describe('decodeChatFileCustomFields', () => {
  it.each([undefined, null, 'type', 7, {}])('decodes %j as no fields', (stored) => {
    expect(decodeChatFileCustomFields(stored)).toEqual([]);
  });

  it('keeps only well-formed usable entries', () => {
    expect(decodeChatFileCustomFields([
      { key: 'type', value: 'chat' },
      { key: 3, value: 'x' },
      { key: 'num', value: 3 },
      'bogus',
      null,
      { key: 'id', value: 'x' },
    ])).toEqual([{ key: 'type', value: 'chat' }]);
  });
});
