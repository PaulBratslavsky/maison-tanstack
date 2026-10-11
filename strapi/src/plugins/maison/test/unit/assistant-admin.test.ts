import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_PATHS,
  CUSTOM_EVENT,
  STARTERS,
  adminTokenFrom,
  askTabState,
  canSend,
  composerButtons,
  customEventNote,
  draftAfterFailure,
  draftAfterSend,
  drawableParts,
  errorNotice,
  followsNewest,
  isStatus,
  noticeAfterStatus,
  shouldSendOnKey,
  showsWorking,
  toolLineOf,
  toolResultOf,
  withoutFailedTurn,
  withoutOpenToolCalls,
  type ErrorNotice,
  type MessageLike,
  type PartLike,
} from '../../admin/src/assistant';
import { READ_TOOL_NAMES } from '../../server/src/assistant/tools';
import routes from '../../server/src/routes';
import { CUSTOM_EVENTS } from '../../server/src/services/assistant';

describe('the assistant paths', () => {
  // Admin routes are served at /maison<path>, so the page's paths are the server's own with that prefix.
  it("are the routes the server has, under the plugin's admin prefix", () => {
    const served = (method: string, handler: string) => {
      const found = routes.admin.routes.filter((route) => route.method === method && route.handler === handler);
      expect(found, `${method} ${handler}`).toHaveLength(1);
      return `/maison${found[0].path}`;
    };
    expect(ASSISTANT_PATHS).toEqual({ status: served('GET', 'assistant.status'), chat: served('POST', 'assistant.chat') });
  });
});

describe('STARTERS', () => {
  // Paul, 7 October: five quick questions that stay above the text box for the whole chat, so a demo can use them at any point. They replace the
  // three starters of the first design, and the order is the one he gave.
  it('are the five quick questions, in the order the spec gives them', () => {
    expect(STARTERS).toEqual([
      'Which visits are waiting for staff?',
      'Any complaints this week?',
      'Which customer questions still need an answer?',
      'How many inquiries are open in each queue?',
      'What are customers asking about today?',
    ]);
  });

  it('are each one line of plain text, with no two the same, so each chip is one button with a name of its own', () => {
    expect(new Set(STARTERS).size).toBe(STARTERS.length);
    for (const question of STARTERS) {
      expect(question, question).toBe(question.trim());
      expect(question, question).not.toMatch(/\n/);
      expect(question.endsWith('?'), question).toBe(true);
    }
  });
});

describe('isStatus', () => {
  const TOOLS = [
    { name: 'list_requests', label: 'Visit requests' },
    { name: 'inquiry_counts', label: 'Inquiry counts' },
  ];

  it.each([
    [{ ready: true, model: 'claude-sonnet-5-5', tools: TOOLS }, true],
    [{ ready: true, model: 'claude-sonnet-5-5', tools: [] }, true],
    [{ ready: false, reason: 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.' }, true],
    // A ready status lists the tools: the tab's list of tools is built from it.
    [{ ready: true, model: 'claude-sonnet-5-5' }, false],
    [{ ready: true, model: 'claude-sonnet-5-5', tools: 'list_requests' }, false],
    [{ ready: true, model: 'claude-sonnet-5-5', tools: ['list_requests'] }, false],
    [{ ready: true, model: 'claude-sonnet-5-5', tools: [{ name: 'list_requests' }] }, false],
    [{ ready: true, model: 'claude-sonnet-5-5', tools: [{ name: 5, label: 'x' }] }, false],
    [{ ready: true, model: 'claude-sonnet-5-5', tools: [null] }, false],
    [{ ready: true, tools: TOOLS }, false],
    [{ ready: true }, false],
    [{ ready: true, model: 5, tools: TOOLS }, false],
    [{ ready: false }, false],
    [{ ready: false, reason: 5 }, false],
    [{ ready: 'yes', model: 'm', tools: [] }, false],
    [{ model: 'm', tools: [] }, false],
    [{}, false],
    [null, false],
    [undefined, false],
    ['ready', false],
    [[], false],
    [{ error: { message: 'Forbidden' } }, false],
  ])('is %j: %s', (value, expected) => {
    expect(isStatus(value)).toBe(expected);
  });
});

describe('askTabState', () => {
  it('is loading until the status answers, with no error', () => {
    expect(askTabState(null, false)).toEqual({ kind: 'loading' });
  });

  it('says the assistant could not be checked, in a fixed text that holds none of the error, when the status call failed and there is no status', () => {
    expect(askTabState(null, true)).toEqual({ kind: 'failed', text: "Couldn't check the assistant." });
  });

  it("shows the server's reason, and no text box, when the assistant is not ready", () => {
    expect(askTabState({ ready: false, reason: 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.' }, false)).toEqual({
      kind: 'not-ready',
      text: 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.',
    });
  });

  it('is the chat, with the model and the tools, when the assistant is ready', () => {
    const tools = [{ name: 'list_requests', label: 'Visit requests' }];
    expect(askTabState({ ready: true, model: 'claude-sonnet-5-5', tools }, false)).toEqual({ kind: 'chat', model: 'claude-sonnet-5-5', tools });
  });

  it('keeps showing a status it has when a later check failed', () => {
    expect(askTabState({ ready: true, model: 'claude-sonnet-5-5', tools: [] }, true)).toEqual({ kind: 'chat', model: 'claude-sonnet-5-5', tools: [] });
  });
});

describe('customEventNote', () => {
  it('words the two events the server adds', () => {
    expect(customEventNote('max_turns')).toBe('The assistant stopped after 6 steps. Ask a narrower question.');
    expect(customEventNote('declined')).toBe('The model declined to answer this. Rephrase the question.');
  });

  it('says nothing for any other event, the names every object has included', () => {
    for (const name of ['', 'structured-output.complete', 'approval-requested', 'toString', '__proto__', 'constructor']) expect(customEventNote(name), name).toBeNull();
  });

  it("uses the names the server's wrapper sends", () => {
    expect(CUSTOM_EVENT).toEqual(CUSTOM_EVENTS);
  });
});

describe('errorNotice', () => {
  const fromEvent = (code: string, message: string) => Object.assign(new Error(message), { code });

  it('shows the staff text of an error from a RUN_ERROR as it is: the server already wrote it', () => {
    expect(errorNotice(fromEvent('401', 'Anthropic refused the key. Check AI_API_KEY.'))).toEqual({ text: 'Anthropic refused the key. Check AI_API_KEY.', newChat: false, code: '401' });
    expect(errorNotice(fromEvent('timeout', 'The assistant took too long and stopped. Try again.'))).toEqual({
      text: 'The assistant took too long and stopped. Try again.',
      newChat: false,
      code: 'timeout',
    });
    expect(errorNotice(fromEvent('max_tokens', 'The answer was cut off because it was too long. Ask for less.')).newChat).toBe(false);
  });

  it('offers a new chat when the server says the chat is too long or cannot continue', () => {
    expect(errorNotice(fromEvent('chat_too_long', 'This chat is long. Start a new chat.'))).toEqual({ text: 'This chat is long. Start a new chat.', newChat: true, code: 'chat_too_long' });
    expect(errorNotice(fromEvent('history_rejected', "This chat can't continue. Start a new chat."))).toEqual({
      text: "This chat can't continue. Start a new chat.",
      newChat: true,
      code: 'history_rejected',
    });
  });

  it('falls back to the general text for a RUN_ERROR with no message', () => {
    expect(errorNotice(fromEvent('unknown', ''))).toEqual({ text: 'Something went wrong. Try again.', newChat: false, code: 'unknown' });
  });

  it('keeps the code of an error from a RUN_ERROR, so the tab can tell a not_ready notice from any other', () => {
    expect(errorNotice(fromEvent('not_ready', "The assistant isn't set up.")).code).toBe('not_ready');
    expect(errorNotice(new Error('HTTP error! status: 403 Forbidden')).code).toBeUndefined();
    expect(errorNotice(new TypeError('Failed to fetch')).code).toBeUndefined();
  });

  it.each([
    [400, 'Something went wrong. Try again.', false],
    [403, "Your role can't use the assistant any more. Reload the page.", false],
    [413, 'This chat is long. Start a new chat.', true],
    [401, 'Your Strapi session has ended. Reload the page to sign in again.', false],
    [500, 'Something went wrong. Try again.', false],
    [502, 'Something went wrong. Try again.', false],
  ])('reads an HTTP error by its status, as ai-client words it: %s', (status, text, newChat) => {
    expect(errorNotice(new Error(`HTTP error! status: ${status} Some Status Text`))).toEqual({ text, newChat });
    expect(errorNotice(new Error(`HTTP error! status: ${status} `))).toEqual({ text, newChat });
  });

  it.each([
    new TypeError('Failed to fetch'),
    new TypeError('NetworkError when attempting to fetch resource.'),
    new TypeError('Load failed'),
    new Error('Failed to fetch'),
    new Error('Network error'),
    new Error('load failed'),
  ])('says the connection was lost for %s', (error) => {
    expect(errorNotice(error)).toEqual({ text: 'The connection to Strapi was lost. Try again.', newChat: false });
  });

  // ai-client 0.39.2 wraps a rejected fetch and a body that fails mid-stream in a StreamReadError, whose message is always
  // "Stream response body read failed". The browser's own text is only in `cause`. The connect wrapper's RUN_ERROR keeps the
  // same message and has no cause. These are the shapes `onError` really gets.
  describe('a lost connection, as ai-client reports it', () => {
    const LOST = { text: 'The connection to Strapi was lost. Try again.', newChat: false };
    const streamReadError = (cause: unknown) => Object.assign(new Error('Stream response body read failed', { cause }), { name: 'StreamReadError' });

    it.each(['Failed to fetch', 'network error', 'NetworkError when attempting to fetch resource.', 'Load failed'])('is a StreamReadError whose cause says "%s"', (message) => {
      expect(errorNotice(streamReadError(new TypeError(message)))).toEqual(LOST);
    });

    it('is a StreamReadError, whatever its cause: the name says the stream could not be read', () => {
      expect(errorNotice(streamReadError(new Error('The operation was aborted.')))).toEqual(LOST);
      expect(errorNotice(streamReadError(undefined))).toEqual(LOST);
      expect(errorNotice(streamReadError('Failed to fetch'))).toEqual(LOST);
    });

    it('is the plain Error the connect wrapper turns into a RUN_ERROR, which has the same message and no cause', () => {
      expect(errorNotice(new Error('Stream response body read failed'))).toEqual(LOST);
    });

    it('is any error whose cause has the message a browser gives for a failed request', () => {
      expect(errorNotice(new Error('Something broke', { cause: new TypeError('Failed to fetch') }))).toEqual(LOST);
      expect(errorNotice(new Error('Something broke', { cause: 'network error' }))).toEqual(LOST);
    });

    it('does not take a cause that is not a network failure for one', () => {
      expect(errorNotice(new Error('Something broke', { cause: new TypeError('x is not a function') }))).toEqual({ text: 'Something went wrong. Try again.', newChat: false });
      expect(errorNotice(new Error('Something broke', { cause: undefined }))).toEqual({ text: 'Something went wrong. Try again.', newChat: false });
    });

    it('still reads an HTTP status first: a status error is a plain Error, and its status decides', () => {
      expect(errorNotice(Object.assign(new Error('HTTP error! status: 413 Payload Too Large'), { cause: new TypeError('Failed to fetch') })).newChat).toBe(true);
    });

    it('does not turn the code of a RUN_ERROR into a lost connection', () => {
      expect(errorNotice(Object.assign(new Error('Anthropic is busy. Try again in a minute.'), { code: '529' })).text).toBe('Anthropic is busy. Try again in a minute.');
    });
  });

  // A bug in the page throws a TypeError too. Only the messages browsers give for a failed request mean a lost connection.
  it('does not take a TypeError from the page itself for a lost connection', () => {
    for (const message of ['Cannot read properties of undefined', "undefined is not an object (evaluating 'x.y')", 'x is not a function', 'terminated']) {
      expect(errorNotice(new TypeError(message)), message).toEqual({ text: 'Something went wrong. Try again.', newChat: false });
    }
  });

  it('gives the general text for anything else, undefined and things that are not errors included', () => {
    for (const error of [undefined, null, 'oops', 42, {}, new Error('Something broke'), new Error('')]) {
      expect(errorNotice(error), String(error)).toEqual({ text: 'Something went wrong. Try again.', newChat: false });
    }
  });

  it('never shows a message that is not staff text: not a stack, a JSON parse error or a provider body', () => {
    for (const message of ['x is not a function\n    at foo (bar.js:1:1)', 'Unexpected token < in JSON at position 0', '401 {"error":{"message":"invalid x-api-key"}}']) {
      expect(errorNotice(new Error(message)).text, message).toBe('Something went wrong. Try again.');
    }
  });

  it('does not mistake an error with a numeric code, such as an abort, for a RUN_ERROR', () => {
    expect(errorNotice(Object.assign(new Error('The operation was aborted.'), { code: 20 }))).toEqual({ text: 'Something went wrong. Try again.', newChat: false });
  });
});

describe('canSend', () => {
  const ok = { text: 'Which visits are waiting?', busy: false, ready: true };

  it('is true for a message, when the assistant is ready and not answering', () => {
    expect(canSend(ok)).toBe(true);
  });

  it('is false while the assistant is answering: a second message waits, and nothing is queued out of sight', () => {
    expect(canSend({ ...ok, busy: true })).toBe(false);
  });

  it('is false until the assistant is ready', () => {
    expect(canSend({ ...ok, ready: false })).toBe(false);
  });

  it.each(['', ' ', '   ', '\n', ' \n\t ', '　', '　 　'])('is false for a message with nothing but spaces in it: %j', (text) => {
    expect(canSend({ ...ok, text })).toBe(false);
  });

  it('is true for a message with spaces around its words, in either language', () => {
    expect(canSend({ ...ok, text: '  hello  ' })).toBe(true);
    expect(canSend({ ...ok, text: '今日の問い合わせは？' })).toBe(true);
  });
});

describe('shouldSendOnKey', () => {
  const key = (event: Partial<{ key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }>) => ({ key: '', shiftKey: false, ...event });

  it('sends on Enter', () => {
    expect(shouldSendOnKey(key({ key: 'Enter', keyCode: 13 }))).toBe(true);
    expect(shouldSendOnKey(key({ key: 'Enter' }))).toBe(true);
  });

  it('adds a line break, and sends nothing, on Shift+Enter', () => {
    expect(shouldSendOnKey(key({ key: 'Enter', shiftKey: true }))).toBe(false);
  });

  // Staff typing Japanese press Enter to confirm a conversion. That Enter belongs to the input method.
  it('sends nothing while an input method composes: Enter there confirms the conversion', () => {
    expect(shouldSendOnKey(key({ key: 'Enter', isComposing: true }))).toBe(false);
    expect(shouldSendOnKey(key({ key: 'Enter', isComposing: true, keyCode: 229 }))).toBe(false);
  });

  it('sends nothing for keyCode 229, which Safari reports for the Enter that ends a composition, after it has stopped composing', () => {
    expect(shouldSendOnKey(key({ key: 'Enter', isComposing: false, keyCode: 229 }))).toBe(false);
  });

  it('ignores every other key', () => {
    for (const other of ['a', ' ', 'Tab', 'Escape', 'ArrowUp', 'Backspace', 'Process']) expect(shouldSendOnKey(key({ key: other })), other).toBe(false);
  });
});

describe('toolResultOf', () => {
  const parts: PartLike[] = [
    { type: 'text', content: 'Looking.' },
    { type: 'tool-call', id: 'call-1', name: 'list_requests', arguments: '{}', state: 'complete' },
    { type: 'tool-result', toolCallId: 'call-1', content: '{"requests":[]}', state: 'complete' },
    { type: 'tool-call', id: 'call-2', name: 'list_questions', arguments: '{}', state: 'input-complete' },
  ];

  it('finds the tool-result part of a call by its id', () => {
    expect(toolResultOf(parts, 'call-1')).toBe(parts[2]);
  });

  it('finds nothing for a call with no result yet, or an id nobody has', () => {
    expect(toolResultOf(parts, 'call-2')).toBeUndefined();
    expect(toolResultOf(parts, 'call-9')).toBeUndefined();
    expect(toolResultOf([], 'call-1')).toBeUndefined();
  });

  it('does not take a tool-call part with that id for a result', () => {
    expect(toolResultOf([parts[1]], 'call-1')).toBeUndefined();
  });
});

describe('toolLineOf', () => {
  const call = (name: string, fields: Partial<PartLike> = {}): PartLike => ({ type: 'tool-call', id: 'call-1', name, arguments: '{}', state: 'complete', ...fields });
  const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ n: index }));

  it.each([
    ['list_requests', 'requests'],
    ['list_questions', 'questions'],
    ['list_inquiries', 'inquiries'],
    ['inquiry_counts', 'inquiry counts'],
    ['search_knowledge', 'knowledge'],
    ['search_products', 'products'],
    ['view_product', 'product'],
  ])('calls %s "%s"', (name, what) => {
    expect(toolLineOf(call(name, { state: 'input-complete' }), undefined)).toEqual({ text: `Maison · ${what} …`, tone: 'running' });
  });

  it('has a line for each of the seven read tools, and only those', () => {
    for (const name of READ_TOOL_NAMES) expect(toolLineOf(call(name), undefined), name).not.toBeNull();
  });

  it.each(['awaiting-input', 'input-streaming', 'input-complete', 'approval-requested', 'approval-responded'])('is running, with an ellipsis, while the state is %s', (state) => {
    expect(toolLineOf(call('list_inquiries', { state }), undefined)).toEqual({ text: 'Maison · inquiries …', tone: 'running' });
  });

  it('counts the results: the length of the array the tool answered', () => {
    expect(toolLineOf(call('list_inquiries', { output: { inquiries: rows(12), capped: false } }), undefined)).toEqual({ text: 'Maison · inquiries ✓ 12 results', tone: 'ok' });
    expect(toolLineOf(call('list_requests', { output: { requests: rows(3), capped: false } }), undefined)).toEqual({ text: 'Maison · requests ✓ 3 results', tone: 'ok' });
    expect(toolLineOf(call('list_questions', { output: { questions: rows(50), capped: true } }), undefined)).toEqual({ text: 'Maison · questions ✓ 50 results', tone: 'ok' });
    expect(toolLineOf(call('search_knowledge', { output: { locale: 'en', entries: rows(4) } }), undefined)).toEqual({ text: 'Maison · knowledge ✓ 4 results', tone: 'ok' });
    expect(toolLineOf(call('search_products', { output: { locale: 'en', total: 8, products: rows(8) } }), undefined)).toEqual({ text: 'Maison · products ✓ 8 results', tone: 'ok' });
  });

  it('says "1 result" for one, and "0 results" for none', () => {
    expect(toolLineOf(call('list_requests', { output: { requests: rows(1), capped: false } }), undefined)?.text).toBe('Maison · requests ✓ 1 result');
    expect(toolLineOf(call('list_requests', { output: { requests: [], capped: false } }), undefined)?.text).toBe('Maison · requests ✓ 0 results');
  });

  it('has no count for inquiry_counts and view_product', () => {
    expect(toolLineOf(call('inquiry_counts', { output: { needsAnswer: 4, complaint: 2, praise: 1, notLabelled: 3 } }), undefined)).toEqual({ text: 'Maison · inquiry counts ✓', tone: 'ok' });
    expect(toolLineOf(call('view_product', { output: { product: { slug: 'weekender-50' } } }), undefined)).toEqual({ text: 'Maison · product ✓', tone: 'ok' });
  });

  it('shows the tick with no count when a done call has no output to count', () => {
    expect(toolLineOf(call('list_inquiries'), undefined)).toEqual({ text: 'Maison · inquiries ✓', tone: 'ok' });
    expect(toolLineOf(call('list_inquiries', { output: { inquiries: 'not a list' } }), undefined)?.text).toBe('Maison · inquiries ✓');
  });

  // A reference that matches nothing, or an inquiry deleted since the row loaded: the tool answers not_found.
  it('turns red with the tool message when the tool answered not_found, and never shows "0 results" for it', () => {
    const output = { error: { code: 'not_found', message: 'No request APT-4812.', hint: 'Check the reference.' } };
    expect(toolLineOf(call('list_requests', { output }), undefined)).toEqual({ text: 'Maison · requests ✕ No request APT-4812.', tone: 'error' });
    const inquiry = { error: { code: 'not_found', message: 'No inquiry "k9".', hint: 'Reload the Inquiries tab: it may have been deleted.' } };
    expect(toolLineOf(call('list_inquiries', { output: inquiry }), undefined)).toEqual({ text: 'Maison · inquiries ✕ No inquiry "k9".', tone: 'error' });
  });

  it('turns red for any tool failure: the state error, a result part in error, or an output with an error', () => {
    expect(toolLineOf(call('list_questions', { state: 'error', output: { error: 'The tool exploded.' } }), undefined)).toEqual({
      text: 'Maison · questions ✕ Maison could not read that request.',
      tone: 'error',
    });
    expect(toolLineOf(call('list_questions'), { type: 'tool-result', toolCallId: 'call-1', content: '{}', state: 'error', error: 'The tool failed in a way.' })).toEqual({
      text: 'Maison · questions ✕ The tool failed.',
      tone: 'error',
    });
    expect(toolLineOf(call('list_questions', { output: { error: { code: 'invalid_input', message: 'since: Use YYYY-MM-DD.', hint: 'x' } } }), undefined)?.tone).toBe('error');
  });

  it("shows only the message of Maison's own error object, and a general line for anything else", () => {
    expect(toolLineOf(call('list_questions', { state: 'error', output: { error: { message: 'From the output.' } } }), { type: 'tool-result', toolCallId: 'call-1', state: 'error', error: 'From the part.' })?.text).toBe('Maison · questions ✕ From the output.');
    expect(toolLineOf(call('list_questions', { state: 'error' }), undefined)?.text).toBe('Maison · questions ✕ The tool failed.');
    expect(toolLineOf(call('list_questions', { state: 'error', output: { error: {} } }), undefined)?.text).toBe('Maison · questions ✕ The tool failed.');
  });

  // When the model sends input the tool's schema refuses, or arguments that are not JSON, TanStack AI answers { error: "<its own text>" }
  // before Maison's code runs. That text names the tool and the model's own input, so the chat never shows it.
  it("never shows TanStack AI's own text for a call it refused: a fixed sentence says it could not be read", () => {
    const refused = [
      'Input validation failed for tool list_requests: Validation failed: Use a reference like APT-4821.',
      'Input validation failed for tool list_requests: Too big: expected number to be <=50',
      'Failed to parse tool arguments as JSON: {"reference": "APT-48',
      'Tool execution failed',
    ];
    for (const error of refused) {
      const line = toolLineOf(call('list_requests', { state: 'error', output: { error } }), { type: 'tool-result', toolCallId: 'call-1', state: 'error', error });
      expect(line, error).toEqual({ text: 'Maison · requests ✕ Maison could not read that request.', tone: 'error' });
    }
  });

  it('shows a string error from a call that is not in the error state the same way: it is still a failure', () => {
    expect(toolLineOf(call('list_requests', { output: { error: 'Input validation failed for tool list_requests: nope' } }), undefined)).toEqual({
      text: 'Maison · requests ✕ Maison could not read that request.',
      tone: 'error',
    });
  });

  it('is red even while the state still says input-complete, when the result part is in error', () => {
    expect(toolLineOf(call('list_requests', { state: 'input-complete' }), { type: 'tool-result', toolCallId: 'call-1', state: 'error', error: 'Gone.' })).toEqual({
      text: 'Maison · requests ✕ The tool failed.',
      tone: 'error',
    });
  });

  it('has no line for the draft tools, whose card is their result, or for any other name', () => {
    for (const name of ['draft_reply', 'draft_answer', 'confirm_appointment', 'something_else', '', 'toString', '__proto__']) expect(toolLineOf(call(name), undefined), name).toBeNull();
  });

  it('has no line for a part that is not a tool call', () => {
    expect(toolLineOf({ type: 'text', content: 'Hello' }, undefined)).toBeNull();
    expect(toolLineOf({ type: 'tool-result', toolCallId: 'call-1', name: 'list_requests', state: 'complete' }, undefined)).toBeNull();
    expect(toolLineOf({ type: 'thinking', content: '...' }, undefined)).toBeNull();
  });
});

describe('adminTokenFrom', () => {
  const COOKIE = 'jwtToken';

  it('reads the token Strapi stores in localStorage, a JSON string', () => {
    expect(adminTokenFrom({ stored: '"abc.def.ghi"', cookie: '', cookieName: COOKIE })).toBe('abc.def.ghi');
  });

  it('reads a bare token too', () => {
    expect(adminTokenFrom({ stored: 'abc.def.ghi', cookie: '', cookieName: COOKIE })).toBe('abc.def.ghi');
  });

  it('prefers localStorage to the cookie', () => {
    expect(adminTokenFrom({ stored: '"from-storage"', cookie: 'jwtToken=from-cookie', cookieName: COOKIE })).toBe('from-storage');
  });

  it('reads the cookie when there is nothing in localStorage, and decodes it', () => {
    expect(adminTokenFrom({ stored: null, cookie: 'theme=dark; jwtToken=abc.def%2Bghi; other=1', cookieName: COOKIE })).toBe('abc.def+ghi');
    expect(adminTokenFrom({ stored: null, cookie: 'jwtToken=abc', cookieName: COOKIE })).toBe('abc');
    expect(adminTokenFrom({ stored: '', cookie: 'jwtToken=abc', cookieName: COOKIE })).toBe('abc');
  });

  it('reads the cookie under the name the admin build was given', () => {
    expect(adminTokenFrom({ stored: null, cookie: 'jwtToken=old; strapi_jwt=new', cookieName: 'strapi_jwt' })).toBe('new');
  });

  it('does not take another cookie whose name ends the same way', () => {
    expect(adminTokenFrom({ stored: null, cookie: 'notjwtToken=wrong; xjwtToken=wrong', cookieName: COOKIE })).toBeNull();
    expect(adminTokenFrom({ stored: null, cookie: 'jwtToken2=wrong', cookieName: COOKIE })).toBeNull();
  });

  it('is null when there is no token anywhere, or it is empty', () => {
    expect(adminTokenFrom({ stored: null, cookie: '', cookieName: COOKIE })).toBeNull();
    expect(adminTokenFrom({ stored: null, cookie: 'theme=dark', cookieName: COOKIE })).toBeNull();
    expect(adminTokenFrom({ stored: null, cookie: 'jwtToken=', cookieName: COOKIE })).toBeNull();
    expect(adminTokenFrom({ stored: '""', cookie: '', cookieName: COOKIE })).toBeNull();
  });

  it('ignores a stored value that is not a token, and goes on to the cookie', () => {
    expect(adminTokenFrom({ stored: 'null', cookie: 'jwtToken=abc', cookieName: COOKIE })).toBe('abc');
    expect(adminTokenFrom({ stored: '{"a":1}', cookie: 'jwtToken=abc', cookieName: COOKIE })).toBe('abc');
  });

  it('keeps a cookie value that is not valid encoding as it is, instead of throwing', () => {
    expect(adminTokenFrom({ stored: null, cookie: 'jwtToken=100%', cookieName: COOKIE })).toBe('100%');
  });

  it('keeps an equals sign inside the value: tokens can be padded', () => {
    expect(adminTokenFrom({ stored: null, cookie: 'jwtToken=abc==', cookieName: COOKIE })).toBe('abc==');
  });
});

// The parts below are the shapes TanStack AI keeps in a UIMessage. A tool call that has not finished has no `output`, and a finished
// one has it, and usually a tool-result part beside it too.
const openCall = (id: string, state: string, fields: Partial<PartLike> = {}): PartLike => ({ type: 'tool-call', id, name: 'list_requests', arguments: '{"sta', state, ...fields });
const doneCall = (id: string, fields: Partial<PartLike> = {}): PartLike => ({ type: 'tool-call', id, name: 'list_requests', arguments: '{}', state: 'complete', input: {}, output: { requests: [] }, ...fields });
const resultOf = (id: string, fields: Partial<PartLike> = {}): PartLike => ({ type: 'tool-result', toolCallId: id, content: '{"requests":[]}', state: 'complete', ...fields });
const text = (content: string): PartLike => ({ type: 'text', content });
const staff = (id: string, content = 'Which visits are waiting?'): MessageLike & { id: string } => ({ id, role: 'user', parts: [text(content)] });
const assistant = (id: string, parts: PartLike[]): MessageLike & { id: string } => ({ id, role: 'assistant', parts });

describe('withoutOpenToolCalls', () => {
  // Stop ends the stream before TanStack AI finishes a call that is being written, so it stays in the state it had: with no output
  // and no result. The next send would replay it. These are the three states such a call can be left in.
  it.each(['awaiting-input', 'input-streaming', 'input-complete'])('removes a call left in the state %s, and keeps the text before it', (state) => {
    const messages = [staff('u1'), assistant('a1', [text('Looking. '), openCall('c1', state)])];
    expect(withoutOpenToolCalls(messages)).toEqual([messages[0], { id: 'a1', role: 'assistant', parts: [text('Looking. ')] }]);
  });

  it('removes any other call with no output and no result, whatever its state: approval states and a failed call that never got an answer too', () => {
    for (const state of ['approval-requested', 'approval-responded', 'complete', 'error']) {
      const messages = [staff('u1'), assistant('a1', [text('Hi.'), openCall('c1', state)])];
      expect(withoutOpenToolCalls(messages)[1].parts, state).toEqual([text('Hi.')]);
    }
  });

  it('keeps a finished call: it has its output', () => {
    const messages = [staff('u1'), assistant('a1', [doneCall('c1'), text('None.')])];
    expect(withoutOpenToolCalls(messages)).toBe(messages);
  });

  it('keeps a call that has a matching tool-result part, though its own output is not set', () => {
    const messages = [staff('u1'), assistant('a1', [openCall('c1', 'input-complete'), resultOf('c1')])];
    expect(withoutOpenToolCalls(messages)).toBe(messages);
  });

  it('keeps a failed call that has an output, and one whose result part is in error', () => {
    const messages = [
      staff('u1'),
      assistant('a1', [doneCall('c1', { state: 'error', output: { error: { code: 'not_found', message: 'No request APT-0000.' } } }), openCall('c2', 'error'), resultOf('c2', { state: 'error', error: 'x' })]),
    ];
    expect(withoutOpenToolCalls(messages)).toBe(messages);
  });

  it('is decided call by call: a finished call stays beside one that was cut off', () => {
    const messages = [staff('u1'), assistant('a1', [doneCall('c1'), openCall('c2', 'input-streaming'), resultOf('c1')])];
    expect(withoutOpenToolCalls(messages)[1].parts).toEqual([doneCall('c1'), resultOf('c1')]);
  });

  it('takes the result of another message for no result: the part must be in the message of the call', () => {
    const messages = [staff('u1'), assistant('a1', [openCall('c1', 'input-complete')]), assistant('a2', [text('x'), resultOf('c1')])];
    // The call has no result of its own, and the result in a2 has no call in a2. Both go, and a1 is left empty and goes too.
    expect(withoutOpenToolCalls(messages)).toEqual([messages[0], assistant('a2', [text('x')])]);
  });

  it("removes an assistant message that is left with no parts, and never a staff member's", () => {
    const messages = [staff('u1'), assistant('a1', [openCall('c1', 'awaiting-input')])];
    expect(withoutOpenToolCalls(messages)).toEqual([messages[0]]);
    const silent: MessageLike = { role: 'user', parts: [] };
    expect(withoutOpenToolCalls([silent])).toEqual([silent]);
  });

  it('removes a result whose call is not in the message: a late result that arrives after the call was removed', () => {
    const messages = [staff('u1'), assistant('a1', [text('Looking. '), resultOf('c1')])];
    expect(withoutOpenToolCalls(messages)[1].parts).toEqual([text('Looking. ')]);
  });

  it('keeps thinking parts, and a message with only a thinking part', () => {
    const messages = [staff('u1'), assistant('a1', [{ type: 'thinking', content: '...' }, openCall('c1', 'input-streaming')])];
    expect(withoutOpenToolCalls(messages)[1].parts).toEqual([{ type: 'thinking', content: '...' }]);
  });

  it('gives back the same array, and the same messages, when nothing is open: nothing is set again for no reason', () => {
    const messages = [staff('u1'), assistant('a1', [text('Hello.')])];
    expect(withoutOpenToolCalls(messages)).toBe(messages);
    expect(withoutOpenToolCalls([])).toEqual([]);
  });

  it('leaves the messages it was given as they were, and keeps the messages it did not change', () => {
    const messages = [staff('u1'), assistant('a1', [text('Looking. '), openCall('c1', 'input-streaming')]), staff('u2'), assistant('a2', [text('Fine.')])];
    const before = JSON.stringify(messages);
    const cleaned = withoutOpenToolCalls(messages);
    expect(JSON.stringify(messages)).toBe(before);
    expect(cleaned[0]).toBe(messages[0]);
    expect(cleaned[2]).toBe(messages[2]);
    expect(cleaned[3]).toBe(messages[3]);
  });
});

describe('drawableParts', () => {
  it('is the text with something in it, and the tool calls that have a line', () => {
    const parts = [text('Hello.'), doneCall('c1'), resultOf('c1')];
    expect(drawableParts(parts)).toEqual([parts[0], parts[1]]);
  });

  it('has no text with only spaces and line breaks, thinking, results, calls with no line or any other part', () => {
    const parts: PartLike[] = [
      text(''),
      text('  \n '),
      { type: 'thinking', content: 'Let me think.' },
      resultOf('c1'),
      { type: 'tool-call', id: 'c2', name: 'draft_reply', arguments: '{}', state: 'complete' },
      { type: 'tool-call', id: 'c3', name: 'confirm_appointment', arguments: '{}', state: 'complete' },
      { type: 'structured-output', status: 'complete', raw: '{}' },
      { type: 'text' },
    ];
    expect(drawableParts(parts)).toEqual([]);
  });

  it('has the line of a call that is still running, and one that failed', () => {
    const parts = [openCall('c1', 'input-streaming'), doneCall('c2', { output: { error: { message: 'No request APT-0000.' } } })];
    expect(drawableParts(parts)).toEqual(parts);
  });

  it('keeps the order of the parts', () => {
    const parts = [doneCall('c1'), text('Between.'), doneCall('c2')];
    expect(drawableParts(parts)).toEqual(parts);
  });
});

describe('showsWorking', () => {
  it('shows the working line while the assistant answers and the last message is the staff messages', () => {
    expect(showsWorking(true, [staff('u1')])).toBe(true);
  });

  it('shows it while the last message is an assistant message that has nothing to draw yet: it holds nothing, or only thinking', () => {
    expect(showsWorking(true, [staff('u1'), assistant('a1', [])])).toBe(true);
    expect(showsWorking(true, [staff('u1'), assistant('a1', [{ type: 'thinking', content: '...' }])])).toBe(true);
  });

  it('does not show it once the assistant message has text or a tool line: that is the sign of work', () => {
    expect(showsWorking(true, [staff('u1'), assistant('a1', [text('Looking.')])])).toBe(false);
    expect(showsWorking(true, [staff('u1'), assistant('a1', [openCall('c1', 'input-streaming')])])).toBe(false);
  });

  it('does not show it when the assistant is not answering', () => {
    expect(showsWorking(false, [staff('u1')])).toBe(false);
    expect(showsWorking(false, [staff('u1'), assistant('a1', [])])).toBe(false);
    expect(showsWorking(false, [])).toBe(false);
  });
});

describe('withoutFailedTurn', () => {
  it('takes back a question the assistant did not answer at all: the staff message and the empty assistant message a failed run leaves', () => {
    const messages = [staff('u1'), assistant('a1', [text('Fine.')]), staff('u2'), assistant('a2', [])];
    expect(withoutFailedTurn(messages)).toEqual([messages[0], messages[1]]);
  });

  it('takes back a question with no assistant message after it', () => {
    const messages = [staff('u1'), assistant('a1', [text('Fine.')]), staff('u2')];
    expect(withoutFailedTurn(messages)).toEqual([messages[0], messages[1]]);
    expect(withoutFailedTurn([staff('u1')])).toEqual([]);
  });

  it('takes back a question whose assistant message holds only thinking, which is not drawn', () => {
    expect(withoutFailedTurn([staff('u1'), assistant('a1', [{ type: 'thinking', content: '...' }])])).toEqual([]);
  });

  it('keeps an exchange the assistant began to answer: text or a tool line came back, and staff can read it', () => {
    const half = [staff('u1'), assistant('a1', [text('The first visit')])];
    expect(withoutFailedTurn(half)).toBe(half);
    const tool = [staff('u1'), assistant('a1', [doneCall('c1')])];
    expect(withoutFailedTurn(tool)).toBe(tool);
  });

  it('leaves a chat that does not end in a question alone', () => {
    const messages = [staff('u1'), assistant('a1', [text('Fine.')])];
    expect(withoutFailedTurn(messages)).toBe(messages);
    expect(withoutFailedTurn([])).toEqual([]);
  });

  it('does not change the messages it was given', () => {
    const messages = [staff('u1'), assistant('a1', [])];
    withoutFailedTurn(messages);
    expect(messages).toHaveLength(2);
  });
});

describe('the draft', () => {
  describe('draftAfterSend', () => {
    it('empties the box after a message sent from the box', () => {
      expect(draftAfterSend('Which visits are waiting?', 'box')).toBe('');
    });

    it('leaves the box as it was after a starter: a starter sends its own text, and what staff typed is still theirs', () => {
      expect(draftAfterSend('Which inquiries mention the Weekender?', 'starter')).toBe('Which inquiries mention the Weekender?');
      expect(draftAfterSend('', 'starter')).toBe('');
    });
  });

  describe('draftAfterFailure', () => {
    const typed = { text: 'Which inquiries mention the Weekender tote?', source: 'box' as const };

    it('puts the question staff typed back in an empty box', () => {
      expect(draftAfterFailure({ draft: '', question: typed })).toBe(typed.text);
    });

    it('counts a box with only spaces as empty', () => {
      expect(draftAfterFailure({ draft: '  \n ', question: typed })).toBe(typed.text);
    });

    it('leaves a box that has text in it alone: what staff typed since is theirs', () => {
      expect(draftAfterFailure({ draft: 'Another question', question: typed })).toBe('Another question');
    });

    it('does not put a starter back: staff did not type it', () => {
      expect(draftAfterFailure({ draft: '', question: { text: 'Any complaints this week?', source: 'starter' } })).toBe('');
    });

    it('does nothing when there is no question to put back', () => {
      expect(draftAfterFailure({ draft: '', question: null })).toBe('');
      expect(draftAfterFailure({ draft: 'x', question: null })).toBe('x');
    });
  });
});

describe('noticeAfterStatus', () => {
  const notReady: ErrorNotice = { text: "The assistant isn't set up.", newChat: false, code: 'not_ready' };
  const other: ErrorNotice = { text: 'Anthropic is busy. Try again in a minute.', newChat: false, code: '529' };

  it('drops the not-set-up notice once the assistant is ready: the line would be stale', () => {
    expect(noticeAfterStatus(notReady, { ready: true, model: 'claude-sonnet-5-5' })).toBeNull();
  });

  it('keeps the not-set-up notice while the assistant is still not ready', () => {
    expect(noticeAfterStatus(notReady, { ready: false, reason: 'No key.' })).toBe(notReady);
  });

  it('keeps every other notice, whatever the status says', () => {
    expect(noticeAfterStatus(other, { ready: true, model: 'm' })).toBe(other);
    const general: ErrorNotice = { text: 'Something went wrong. Try again.', newChat: false };
    expect(noticeAfterStatus(general, { ready: true, model: 'm' })).toBe(general);
  });

  it('has nothing to drop when there is no notice', () => {
    expect(noticeAfterStatus(null, { ready: true, model: 'm' })).toBeNull();
  });
});

describe('followsNewest', () => {
  it('follows the newest message while the reader is at the bottom of the message box', () => {
    expect(followsNewest({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
  });

  it('follows it within a few pixels of the bottom: a browser may stop short by a fraction', () => {
    expect(followsNewest({ scrollTop: 590, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
    expect(followsNewest({ scrollTop: 599.5, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
  });

  it('stops following when the reader has scrolled up to read: the answer does not pull them back', () => {
    expect(followsNewest({ scrollTop: 200, clientHeight: 400, scrollHeight: 1000 })).toBe(false);
    expect(followsNewest({ scrollTop: 0, clientHeight: 400, scrollHeight: 1000 })).toBe(false);
  });

  it('follows a box that does not scroll yet', () => {
    expect(followsNewest({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 })).toBe(true);
    expect(followsNewest({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 })).toBe(true);
  });
});

describe('composerButtons', () => {
  const ok = { text: 'Which visits are waiting?', busy: false, ready: true };

  it('has Send ready for a message, and no Stop, while nothing is answering', () => {
    expect(composerButtons(ok)).toEqual({ sendDisabled: false, showStop: false });
  });

  // A double click on Send: the second click must land on a button that does nothing, never on Stop.
  it('keeps Send, switched off, and shows Stop beside it while the assistant answers', () => {
    expect(composerButtons({ ...ok, busy: true })).toEqual({ sendDisabled: true, showStop: true });
  });

  it('switches Send off for an empty box, or before the assistant is ready, with no Stop', () => {
    expect(composerButtons({ ...ok, text: '  ' })).toEqual({ sendDisabled: true, showStop: false });
    expect(composerButtons({ ...ok, ready: false })).toEqual({ sendDisabled: true, showStop: false });
  });

  it('agrees with canSend about when Send works', () => {
    for (const text of ['', ' ', 'Hi']) {
      for (const busy of [true, false]) {
        for (const ready of [true, false]) expect(composerButtons({ text, busy, ready }).sendDisabled).toBe(!canSend({ text, busy, ready }));
      }
    }
  });
});
