import { describe, expect, it } from 'vitest';
import { CHAT_TOO_LONG_TEXT, SOMETHING_WRONG_TEXT, notReadyReason, staffErrorOf, withoutKey } from '../../server/src/assistant/errors';

const MODEL = 'claude-sonnet-5-5';
const NO_KEY = "The assistant isn't set up. It needs an Anthropic API key in AI_API_KEY, with AI_PROVIDER unset or anthropic. Then restart Strapi.";
const staff = (code: string | number | null | undefined, message = 'The provider said something long.', context: { model: string; notReady?: string } = { model: MODEL }) =>
  staffErrorOf({ code, message }, context);

describe('staffErrorOf', () => {
  it.each([
    [401, 'Anthropic refused the key. Check AI_API_KEY.'],
    ['401', 'Anthropic refused the key. Check AI_API_KEY.'],
    [403, 'Anthropic refused the key. Check AI_API_KEY.'],
    ['403', 'Anthropic refused the key. Check AI_API_KEY.'],
    [429, 'Anthropic is busy. Try again in a minute.'],
    ['529', 'Anthropic is busy. Try again in a minute.'],
    ['timeout', 'The assistant took too long and stopped. Try again.'],
    ['max_tokens', 'The answer was cut off because it was too long. Ask for less.'],
    ['chat_too_long', 'This chat is long. Start a new chat.'],
  ])('says, for code %j: %s', (code, message) => {
    expect(staff(code)).toEqual({ code: String(code), message });
  });

  it('names the configured model for a 404, in place of whatever Anthropic said', () => {
    expect(staff(404, '404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-nope"}}', { model: 'claude-nope' })).toEqual({
      code: '404',
      message: "Anthropic doesn't know the model claude-nope. Check AI_CHAT_MODEL.",
    });
    expect(staff('404').message).toBe(`Anthropic doesn't know the model ${MODEL}. Check AI_CHAT_MODEL.`);
  });

  it("gives the not-ready reason for not_ready, or the no-key text when there is none", () => {
    expect(staff('not_ready', '', { model: MODEL, notReady: 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.' })).toEqual({
      code: 'not_ready',
      message: 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.',
    });
    expect(staff('not_ready')).toEqual({ code: 'not_ready', message: NO_KEY });
  });

  it('knows the two texts the controller and the page share', () => {
    expect(CHAT_TOO_LONG_TEXT).toBe('This chat is long. Start a new chat.');
    expect(SOMETHING_WRONG_TEXT).toBe('Something went wrong. Try again.');
  });

  it.each([
    'messages.1.content.0: Invalid `signature` in `thinking` block',
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.3.content.2: thinking blocks in the latest assistant message cannot be modified"}}',
    'Invalid signature on a block',
  ])('tells a 400 on the history from other 400s by its message: %s', (message) => {
    expect(staff(400, message)).toEqual({ code: 'history_rejected', message: "This chat can't continue. Start a new chat." });
  });

  it.each([
    'max_tokens: 20000 must be greater than thinking.budget_tokens',
    'temperature may only be set to 1 when thinking is enabled',
    'messages: at least one message is required',
    '',
  ])('gives any other 400 the general text: %j', (message) => {
    expect(staff(400, message)).toEqual({ code: '400', message: SOMETHING_WRONG_TEXT });
  });

  it('gives any other code the general text and keeps the code, for the page to read', () => {
    expect(staff(500)).toEqual({ code: '500', message: SOMETHING_WRONG_TEXT });
    expect(staff('invalid_request_error')).toEqual({ code: 'invalid_request_error', message: SOMETHING_WRONG_TEXT });
    expect(staff('ECONNRESET')).toEqual({ code: 'ECONNRESET', message: SOMETHING_WRONG_TEXT });
  });

  it.each([[undefined], ['undefined'], [null], ['null'], ['']])('gives a missing code (%j) the general text and the code unknown', (code) => {
    expect(staff(code as any)).toEqual({ code: 'unknown', message: SOMETHING_WRONG_TEXT });
  });

  it('never repeats what the provider said, whatever the code', () => {
    const provider = '401 {"type":"error","error":{"message":"invalid x-api-key sk-ant-api03-SECRET"},"request_id":"req_123"}';
    for (const code of [401, 403, 404, 429, 529, 400, 500, 'timeout', 'unknown']) {
      const { message } = staff(code, provider);
      expect(message, String(code)).not.toContain('SECRET');
      expect(message, String(code)).not.toContain('req_123');
    }
  });

  it('answers staff text in plain words: no em dash, and nothing that looks like a stack trace', () => {
    for (const code of [401, 404, 429, 'timeout', 'max_tokens', 'chat_too_long', 'not_ready', 400, 'unknown']) {
      const { message } = staff(code);
      expect(message).not.toMatch(/\u2014|\u2013|\n|\bat \S+\(/);
    }
  });
});

describe('notReadyReason', () => {
  it('is null when the provider is anthropic and there is a key', () => {
    expect(notReadyReason({ aiProvider: 'anthropic', aiApiKey: 'sk-ant-api03-abc' })).toBeNull();
  });

  it('says what is missing when there is no key', () => {
    expect(notReadyReason({ aiProvider: 'anthropic', aiApiKey: null })).toBe(NO_KEY);
    expect(notReadyReason({ aiProvider: 'anthropic', aiApiKey: '' })).toBe(NO_KEY);
  });

  it('says it works with Anthropic only for any other provider, with or without a key, and names the provider', () => {
    expect(notReadyReason({ aiProvider: 'openai', aiApiKey: 'sk-proj-abc' })).toBe('The assistant works with Anthropic only. AI_PROVIDER is set to openai.');
    expect(notReadyReason({ aiProvider: 'openai-compatible', aiApiKey: null })).toBe('The assistant works with Anthropic only. AI_PROVIDER is set to openai-compatible.');
  });

  it('never repeats the key', () => {
    for (const settings of [{ aiProvider: 'anthropic', aiApiKey: null }, { aiProvider: 'openai', aiApiKey: 'sk-secret-123' }]) {
      expect(notReadyReason(settings) ?? '').not.toContain('secret');
    }
  });
});

describe('withoutKey', () => {
  it('turns every copy of the key into [key]', () => {
    expect(withoutKey('401 invalid key sk-ant-1 (sk-ant-1 again)', 'sk-ant-1')).toBe('401 invalid key [key] ([key] again)');
  });

  it('leaves the text as it is when there is no key to take out', () => {
    expect(withoutKey('no key here', 'sk-ant-1')).toBe('no key here');
    expect(withoutKey('text', null)).toBe('text');
    expect(withoutKey('text', '')).toBe('text');
  });
});
