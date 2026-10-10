import { describe, expect, it } from 'vitest';
import { STORAGE_VERSION, readStoredMessages, toStoredMessages } from '../../server/src/assistant/stored-messages';

type Doc = Record<string, any>;

const message = (parts: Doc[], fields: Doc = {}) => ({ id: 'm1', role: 'assistant', parts, ...fields });
const text = (content: string): Doc => ({ type: 'text', content });

describe('toStoredMessages', () => {
  it('wraps the messages in a versioned envelope', () => {
    const messages = [{ id: 'u1', role: 'user', parts: [text('Which visits are waiting?')] }, message([text('Two visits wait.')])];
    expect(toStoredMessages(messages)).toEqual({ ok: true, value: { v: 1, messages } });
    expect(STORAGE_VERSION).toBe(1);
  });

  it('keeps every key of every part: a thinking part with its signature, a text part with its metadata, a tool call with its output, and the keys of a message', () => {
    const messages = [
      message(
        [
          { type: 'thinking', content: 'Let me look.', signature: 'EqQBCkYIBRgC', providerMetadata: { anthropic: { index: 0 } } },
          // TanStack AI's TextPart has an optional `metadata` key. A text part that did not keep extra keys would lose it on save, with no error.
          { ...text('Looking.'), metadata: { anthropic: { citations: [] } } },
          { type: 'tool-call', id: 'c1', name: 'list_requests', arguments: '{}', state: 'complete', input: {}, output: { requests: [], capped: false }, approval: { id: 'x' } },
          { type: 'tool-result', toolCallId: 'c1', content: '{"requests":[]}', state: 'complete', extra: [1, 2] },
        ],
        { createdAt: '2026-10-07T00:00:00.000Z', metadata: { tanstack: { model: 'claude-sonnet-5-5' } } }
      ),
    ];
    const stored = toStoredMessages(messages);
    expect(stored.ok).toBe(true);
    expect(stored.value?.messages).toEqual(messages);
    expect(stored.value?.messages[0].parts[1]).toHaveProperty('metadata', { anthropic: { citations: [] } });
  });

  it('keeps a part of a type it does not know, as it is, instead of refusing the chat', () => {
    const messages = [message([{ type: 'structured-output', status: 'complete', raw: '{}', data: { a: 1 } }, text('Done.')])];
    expect(toStoredMessages(messages).value?.messages).toEqual(messages);
  });

  it('accepts no messages: a chat saved before its first answer', () => {
    expect(toStoredMessages([])).toEqual({ ok: true, value: { v: 1, messages: [] } });
  });

  it.each([
    ['messages that are not a list', 'hello'],
    ['no messages at all', undefined],
    ['null', null],
    ['an object', { v: 1, messages: [] }],
    ['a message with no id', [{ role: 'user', parts: [] }]],
    ['a message with an empty id', [{ id: '', role: 'user', parts: [] }]],
    ['a message with a role that is not one', [{ id: 'm1', role: 'wizard', parts: [] }]],
    ['a message with no parts list', [{ id: 'm1', role: 'user' }]],
    ['a part with no type', [{ id: 'm1', role: 'user', parts: [{ content: 'x' }] }]],
    ['a part that is not an object', [{ id: 'm1', role: 'user', parts: ['x'] }]],
    ['a message that is not an object', ['x']],
  ])('refuses %s, and says where', (_what, input) => {
    const stored = toStoredMessages(input);
    expect(stored.ok).toBe(false);
    expect(stored.value).toBeUndefined();
    expect(stored.error).toEqual(expect.any(String));
    expect(stored.error).not.toBe('');
  });

  it('does not change the messages it was given', () => {
    const messages = [message([{ type: 'thinking', content: 'x', signature: 's' }])];
    const before = JSON.stringify(messages);
    toStoredMessages(messages);
    expect(JSON.stringify(messages)).toBe(before);
  });
});

describe('readStoredMessages', () => {
  it('gives back the messages of an envelope, with every key', () => {
    const messages = [message([{ type: 'thinking', content: 'x', signature: 's' }, { ...text('Hi.'), metadata: { anthropic: { citations: [] } } }])];
    expect(readStoredMessages({ v: 1, messages })).toEqual({ messages });
  });

  it('gives no messages, and no error, for a chat that has none stored', () => {
    expect(readStoredMessages(null)).toEqual({ messages: [] });
    expect(readStoredMessages(undefined)).toEqual({ messages: [] });
  });

  // Reading is total: a damaged chat costs staff that chat, never the page.
  it.each([
    ['text', 'not a chat'],
    ['a number', 42],
    ['a bare list', [message([text('x')])]],
    ['a later version', { v: 2, messages: [] }],
    ['an envelope with a bad message', { v: 1, messages: [{ id: 1 }] }],
    ['an envelope with no messages', { v: 1 }],
  ])('gives no messages and an error, and never throws, for %s', (_what, stored) => {
    const read = readStoredMessages(stored);
    expect(read.messages).toEqual([]);
    expect(read.error).toMatch(/^unrecognised shape: /);
  });
});
