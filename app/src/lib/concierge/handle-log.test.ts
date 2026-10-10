import { afterEach, describe, expect, it, vi } from 'vitest';

import { assistantSays, assistantWith, cleanup, converse, say, toolCall, wordsOf } from './handle-support';
import { answer, refusal, type Handler } from './test-support';
import { PICKER_NOTE } from './turn';

afterEach(cleanup);

const QUESTION = 'Can it hold a watch?';
const NOT_LOGGED = "[concierge] The turn couldn't be logged:";

const found = (...entries: unknown[]) => answer({ locale: 'en', entries });
const recordedAs = (reference: string) => answer({ question: { reference, status: 'open', product: null } });
const searches = (id = 'c1') => ({ calls: [{ id, name: 'search_knowledge', input: { query: 'watch' } }] });
const quietWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

/** One turn with its log: what the app sent log_inquiry, and the run. */
const logged = async (options: Parameters<typeof converse>[0]) => {
  const run = await converse(options);
  expect(run.callsTo('log_inquiry')).toHaveLength(1);
  return { ...run, input: run.callsTo('log_inquiry')[0] };
};

describe('the end-of-turn log', () => {
  it("logs the finished turn once, with the customer's last message, the reply, what the turn did, the page's piece and the chat's language, on a signal of its own", async () => {
    const signals: AbortSignal[] = [];
    const run = await converse({
      messages: [say('Hello'), assistantSays('Good afternoon.'), say(`  ${QUESTION} \n`, 'u2')],
      locale: 'en',
      product: 'jewelry-coffret',
      steps: [searches(), { words: 'Noted.' }],
      strapi: {
        handlers: {
          search_knowledge: () => found({ title: 'Care' }),
          log_inquiry: (_args, extra) => {
            signals.push(extra.signal);
            return answer({ logged: true });
          },
        },
      },
    });
    expect(run.callsTo('log_inquiry')).toStrictEqual([{ message: QUESTION, reply: 'Noted.', knowledgeFound: true, handedOff: false, productSlug: 'jewelry-coffret', locale: 'en' }]);
    expect(signals).toHaveLength(1);
    expect(run.closed).toHaveBeenCalledTimes(1);
  });

  it('leaves out the question and the piece when there are none, and logs the language of a Japanese chat', async () => {
    // A product that is no slug is no piece: Strapi would refuse the whole log for it, so nothing of it is sent.
    for (const product of [undefined, '../etc', 'Jewelry Coffret']) {
      const { input } = await logged({ messages: [say('こんにちは')], locale: 'ja', product, steps: [{ words: 'かしこまりました。' }] });
      expect(input, `product ${String(product)}`).toStrictEqual({ message: 'こんにちは', reply: 'かしこまりました。', knowledgeFound: false, handedOff: false, locale: 'ja' });
    }
  });

  it("tells it what the turn did, from the turn's own tool results: knowledge found, or a hand-off and the question it recorded", async () => {
    const handOff = { question: QUESTION, reason: 'asked_for_person' };
    const base = { message: QUESTION, reply: 'Noted.', locale: 'en' };
    const cases: Array<[string, Record<string, Handler>, Array<Record<string, unknown>>, Record<string, unknown>]> = [
      ['a search that found an entry', { search_knowledge: () => found({ title: 'Care' }) }, [searches()], { knowledgeFound: true, handedOff: false }],
      [
        'a search that found nothing, which the app handed off',
        { search_knowledge: () => found(), hand_off_to_staff: () => recordedAs('Q-1234') },
        [searches()],
        { knowledgeFound: false, handedOff: true, questionReference: 'Q-1234' },
      ],
      [
        'a hand-off the model made',
        { hand_off_to_staff: () => recordedAs('Q-1234') },
        [{ calls: [{ id: 'c1', name: 'hand_off_to_staff', input: handOff }] }],
        { knowledgeFound: false, handedOff: true, questionReference: 'Q-1234' },
      ],
      [
        'a hand-off Strapi refused',
        { hand_off_to_staff: () => refusal('too_many_open_questions', 'Too many.', 'Wait.') },
        [{ calls: [{ id: 'c1', name: 'hand_off_to_staff', input: handOff }] }],
        { knowledgeFound: false, handedOff: false },
      ],
    ];
    for (const [what, handlers, first, facts] of cases) {
      const { input } = await logged({ messages: [say(QUESTION)], steps: [...first, { words: 'Noted.' }], strapi: { handlers } });
      expect(input, what).toStrictEqual({ ...base, ...facts });
    }
  });

  it("logs the words of every step as the reply, not just the last step's", async () => {
    const { input } = await logged({
      messages: [say(QUESTION)],
      steps: [{ words: 'Let me check.', ...searches() }, { words: 'It holds one watch.' }],
      strapi: { handlers: { search_knowledge: () => found({ title: 'Care' }) } },
    });
    expect(input).toMatchObject({ reply: 'Let me check.\n\nIt holds one watch.', knowledgeFound: true });
  });

  it("logs a reply of '' for a turn that ended with no words, as the local model's empty turns do", async () => {
    const { input } = await logged({ messages: [say(QUESTION)], steps: [searches(), {}], strapi: { handlers: { search_knowledge: () => found({ title: 'Care' }) } } });
    expect(input).toStrictEqual({ message: QUESTION, reply: '', knowledgeFound: true, handedOff: false, locale: 'en' });
  });

  it('logs the words before a picker call, a blank line and then the note, and shows the customer only the words', async () => {
    const { input, events } = await logged({ steps: [{ words: 'Here is the picker.', calls: [{ id: 'p1', name: 'choose_visit', input: { productSlugs: ['weekender-50'] } }] }] });
    expect(input).toMatchObject({ reply: `Here is the picker.\n\n${PICKER_NOTE}` });
    expect(wordsOf(events)).toBe('Here is the picker.');
  });

  it('logs the note alone for a turn that ends at a picker with no words before it', async () => {
    const { input } = await logged({ locale: 'ja', steps: [{ calls: [{ id: 'p1', name: 'choose_visit', input: { productSlugs: ['weekender-50'] } }] }] });
    expect(input).toMatchObject({ reply: PICKER_NOTE });
  });

  it("logs a refused choose_visit call as any other turn: no picker showed, so the note isn't true", async () => {
    const { input } = await logged({
      steps: [{ calls: [{ id: 'p1', name: 'choose_visit', input: { productSlugs: ['weekender-5'] } }] }, { words: 'Let me look that up.' }],
      strapi: { handlers: { find_boutiques: () => refusal('not_found', 'No published product "weekender-5".', 'Call search_products.') } },
    });
    expect(input).toMatchObject({ reply: 'Let me look that up.' });
  });

  it('cuts the reply it logs to the 8000 characters log_inquiry takes, so a long turn is logged and not refused whole, and the customer still reads all of it', async () => {
    const long = 'x'.repeat(9000);
    const { input, events } = await logged({ steps: [{ words: long }] });
    expect((input.reply as string).length).toBe(8000);
    expect(wordsOf(events)).toBe(long);
  });

  it('cuts the note into the 8000 too, by UTF-16 units, never through half of an emoji, and leaves a reply that fits as it is', async () => {
    const exact = 'y'.repeat(8000);
    expect((await logged({ steps: [{ words: exact }] })).input.reply).toBe(exact);
    const emoji = `${'z'.repeat(7999)}😀tail`; // the cut falls through the emoji
    const { input } = await logged({ steps: [{ words: emoji }] });
    expect(input.reply).toBe('z'.repeat(7999));
    // With the note: the words, a blank line and the note, cut to 8000 as one.
    const withNote = await logged({ steps: [{ words: 'w'.repeat(7990), calls: [{ id: 'p1', name: 'choose_visit', input: { productSlugs: ['weekender-50'] } }] }] });
    expect((withNote.input.reply as string).length).toBeLessThanOrEqual(8000);
    expect((withNote.input.reply as string).startsWith('w'.repeat(7990))).toBe(true);
  });

  it("cuts the question to the 1000 characters the tool takes, and sends the customer's own words", async () => {
    const { input } = await logged({ messages: [say('q'.repeat(1000))] });
    expect(input.message).toBe('q'.repeat(1000));
  });

  it("never logs a turn the customer didn't start: a request that ends with the concierge's own message is the picker's answer", async () => {
    const answered = assistantWith([{ type: 'text', content: 'Here.' }, toolCall('p1', 'choose_visit', { productSlugs: ['weekender-50'] }, { status: 'closed' })]);
    const { callsTo, events } = await converse({ messages: [say('Can I visit?'), answered], steps: [{ words: 'Of course.' }] });
    expect(wordsOf(events)).toBe('Of course.');
    expect(callsTo('log_inquiry')).toEqual([]);
  });

  it('logs once for each customer message: two requests, two logs', async () => {
    const first = await converse({ messages: [say('Hello')] });
    const second = await converse({ messages: [say('Hello'), assistantSays('Noted.'), say('And bags?', 'u2')] });
    expect(first.callsTo('log_inquiry')).toHaveLength(1);
    expect(second.callsTo('log_inquiry')).toHaveLength(1);
    expect(second.callsTo('log_inquiry')[0]).toMatchObject({ message: 'And bags?' });
  });
});

describe('the end-of-turn log: when it fails', () => {
  const failures: Array<[string, Handler, string]> = [
    ['was refused', () => refusal('not_signed_in', 'Sign in.', 'Sign in.'), JSON.stringify({ error: { code: 'not_signed_in', message: 'Sign in.', hint: 'Sign in.' } })],
    ['was refused, with a long reason', () => ({ isError: true, content: [{ type: 'text', text: 'x'.repeat(500) }] }), 'x'.repeat(300)],
    ['was refused, with the reason in the first text part', () => ({ isError: true, content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }, { type: 'text', text: 'Not allowed.' }, { type: 'text', text: 'Second.' }] }), 'Not allowed.'],
    ['was refused, with no reason', () => ({ isError: true, content: [] }), 'its answer gives no reason'],
  ];

  for (const [what, handler, why] of failures) {
    it(`doesn't let a log that ${what} touch the customer's turn: the stream ends with the model's reply, the client closes, and the warning says why`, async () => {
      const warn = quietWarn();
      const { events, closed, callsTo, response } = await converse({ strapi: { handlers: { log_inquiry: handler } }, steps: [{ words: 'Welcome.' }] });
      expect(response.status).toBe(200);
      expect(wordsOf(events)).toBe('Welcome.');
      expect(events.some((event) => event.type === 'RUN_ERROR')).toBe(false);
      expect(events.at(-1).type).toBe('RUN_FINISHED');
      expect(closed).toHaveBeenCalled();
      expect(callsTo('log_inquiry')).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(NOT_LOGGED, why);
    });
  }

  it("doesn't let a log that breaks on the way touch the turn either: the error's own words are warned", async () => {
    const warn = quietWarn();
    const { events, closed } = await converse({
      steps: [{ words: 'Welcome.' }],
      strapi: {
        handlers: {
          log_inquiry: () => {
            throw new TypeError('fetch failed');
          },
        },
      },
    });
    expect(wordsOf(events)).toBe('Welcome.');
    expect(events.at(-1).type).toBe('RUN_FINISHED');
    expect(closed).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(NOT_LOGGED);
    expect(warn.mock.calls[0][1]).toContain('fetch failed');
  });

  it("doesn't let a call that rejects (a closed connection, or a thrown value that is no Error) touch the turn: its words are warned", async () => {
    for (const [thrown, words] of [
      [new TypeError('fetch failed'), 'fetch failed'],
      ['the connection closed', 'the connection closed'],
    ] as const) {
      const warn = quietWarn();
      const { events, closed } = await converse({
        steps: [{ words: 'Welcome.' }],
        wrapTransport: (transport) => {
          const send = transport.send.bind(transport);
          transport.send = async (message, options) => {
            if ('method' in message && message.method === 'tools/call' && (message.params as { name?: string } | undefined)?.name === 'log_inquiry') throw thrown;
            return send(message, options);
          };
          return transport;
        },
      });
      expect(wordsOf(events), words).toBe('Welcome.');
      expect(events.at(-1).type, words).toBe('RUN_FINISHED');
      expect(closed, words).toHaveBeenCalled();
      expect(warn, words).toHaveBeenCalledTimes(1);
      expect(warn, words).toHaveBeenCalledWith(NOT_LOGGED, words);
      warn.mockRestore();
    }
  });

  it('says nothing when the log went through', async () => {
    const warn = quietWarn();
    await converse();
    expect(warn).not.toHaveBeenCalled();
  });

  it('cuts a log that never answers off after 5 seconds, and the customer still gets the reply', async () => {
    const warn = quietWarn();
    // The real signal, but quick: the five seconds' wait isn't what is under test.
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => realTimeout(ms === 5000 ? 20 : ms));
    const hangs: Handler = (_args, { signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(answer({})), { once: true }));
    const { events, closed, callsTo } = await converse({ strapi: { handlers: { log_inquiry: hangs } }, steps: [{ words: 'Welcome.' }] });
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(wordsOf(events)).toBe('Welcome.');
    expect(events.some((event) => event.type === 'RUN_ERROR')).toBe(false);
    expect(callsTo('log_inquiry')).toHaveLength(1);
    expect(closed).toHaveBeenCalled();
    // Not the client's "Request was aborted": the log's own signal did it, never the customer's, and the warning says how long it allows.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(NOT_LOGGED, 'it took longer than 5 seconds');
  });

  it('takes the log time from the dependencies, for a host or a test with another limit', async () => {
    const warn = quietWarn();
    const hangs: Handler = (_args, { signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(answer({})), { once: true }));
    await converse({ strapi: { handlers: { log_inquiry: hangs } }, deps: { timeouts: { logMs: 100 } } });
    expect(warn).toHaveBeenCalledWith(NOT_LOGGED, 'it took longer than 0.1 seconds');
  });

  it('closes the MCP client only once the log has answered: closing it first would cut the log short', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof answer>>();
    const { response, closed, strapi } = await converse({ strapi: { handlers: { log_inquiry: () => pending.promise } }, read: false });
    const text = response.text();
    await vi.waitFor(() => expect(strapi.calls.some((call) => call.name === 'log_inquiry')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30)); // the log is still with Strapi
    expect(closed).not.toHaveBeenCalled();
    pending.resolve(answer({ logged: true }));
    expect(await text).toContain('Noted.');
    expect(closed).toHaveBeenCalled();
  });

  it('logs nothing, and warns of nothing, when the token has no log_inquiry: the turn goes on as it did', async () => {
    const warn = quietWarn();
    const { events, callsTo, closed } = await converse({ strapi: { tools: ['search_knowledge', 'search_products'] }, steps: [searches(), { words: 'Noted.' }] });
    expect(wordsOf(events)).toBe('Noted.');
    expect(events.at(-1).type).toBe('RUN_FINISHED');
    expect(callsTo('log_inquiry')).toEqual([]);
    expect(closed).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("doesn't log a turn whose last message has no text: there is nothing to answer, and nothing is warned", async () => {
    const warn = quietWarn();
    const conversations = [[say(' \n ')], [say('Hello'), assistantSays('Good afternoon.'), say('  ', 'u2')], [{ id: 'u1', role: 'user' as const, parts: [] }]];
    for (const messages of conversations) {
      const { response, events, callsTo } = await converse({ messages, steps: [{ words: 'Hello.' }] });
      expect(response.status, JSON.stringify(messages)).toBe(200);
      expect(wordsOf(events), JSON.stringify(messages)).toBe('Hello.');
      expect(callsTo('log_inquiry'), JSON.stringify(messages)).toEqual([]);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("doesn't log a turn the customer left: the client closes, and nothing is logged or warned", async () => {
    const warn = quietWarn();
    const gone = new AbortController();
    setTimeout(() => gone.abort(), 30);
    const { callsTo, closed } = await converse({ steps: [{ words: 'Un moment', stall: true }], signal: gone.signal });
    expect(closed).toHaveBeenCalled();
    expect(callsTo('log_inquiry')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("doesn't log a turn the model failed: the client closes, and nothing is logged", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = quietWarn();
    const { events, callsTo, closed } = await converse({ steps: [{ throws: 'The model broke.' }] });
    expect(events.some((event) => event.type === 'RUN_ERROR' && event.message === 'The model broke.')).toBe(true);
    expect(closed).toHaveBeenCalled();
    expect(callsTo('log_inquiry')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("doesn't log a turn that failed after a step had finished: the model threw, or its stream gave an error", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = quietWarn();
    for (const failure of [{ throws: 'The model broke.' }, { words: 'Let me ch', fail: 'The model broke.' }]) {
      const { events, callsTo } = await converse({ messages: [say(QUESTION)], steps: [searches(), failure], strapi: { handlers: { search_knowledge: () => found({ title: 'Care' }) } } });
      expect(events.filter((event) => event.type === 'RUN_ERROR').map((event) => event.message), JSON.stringify(failure)).toEqual(['The model broke.']);
      expect(callsTo('log_inquiry'), JSON.stringify(failure)).toEqual([]);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('still logs a turn in which a tool failed and the model answered after it: that is no failed turn', async () => {
    const { input } = await logged({
      messages: [say(QUESTION)],
      steps: [searches(), { words: 'Noted.' }],
      strapi: {
        handlers: {
          search_knowledge: () => {
            throw new TypeError('fetch failed');
          },
        },
      },
    });
    expect(input).toStrictEqual({ message: QUESTION, reply: 'Noted.', knowledgeFound: false, handedOff: false, locale: 'en' });
  });
});

describe('a knowledge search that finds nothing, through the route', () => {
  const handlers = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({ search_knowledge: () => found(), hand_off_to_staff: () => recordedAs('Q-1234'), ...extra });

  it("hands the question to staff itself, once: the customer's last message as the question, reason no_answer, the page's piece and the chat's language", async () => {
    const { callsTo, events } = await converse({
      messages: [say('Hello'), assistantSays('Good afternoon.'), say(QUESTION, 'u2')],
      product: 'jewelry-coffret',
      locale: 'en',
      steps: [searches(), { words: 'An advisor will message you on LINE.' }],
      strapi: { handlers: handlers() },
    });
    expect(callsTo('hand_off_to_staff')).toEqual([{ question: QUESTION, reason: 'no_answer', productSlug: 'jewelry-coffret', locale: 'en' }]);
    // The search's result carries what Strapi recorded, for the chat's hand-off note and for the model.
    const result = JSON.parse(events.find((event) => event.type === 'TOOL_CALL_RESULT' && event.toolCallId === 'c1').content);
    expect(result.structuredContent.handOff).toEqual({ reference: 'Q-1234', question: QUESTION, product: null });
    expect(JSON.stringify(result.content)).toContain("Don't call hand_off_to_staff for it.");
    expect(callsTo('log_inquiry')[0]).toMatchObject({ handedOff: true, questionReference: 'Q-1234' });
  });

  it("sends the chat's language with it, which is the question's language", async () => {
    const { callsTo } = await converse({ messages: [say('時計は入りますか？')], locale: 'ja', steps: [searches(), { words: '承知しました。' }], strapi: { handlers: handlers() } });
    expect(callsTo('hand_off_to_staff')).toEqual([{ question: '時計は入りますか？', reason: 'no_answer', locale: 'ja' }]);
  });

  it('answers a hand_off_to_staff the model makes after the automatic one with the same question, and no second call to Strapi', async () => {
    const { callsTo, events } = await converse({
      messages: [say(QUESTION)],
      steps: [searches(), { calls: [{ id: 'c2', name: 'hand_off_to_staff', input: { question: 'Another question', reason: 'no_answer' } }] }, { words: 'Noted.' }],
      strapi: { handlers: handlers() },
    });
    expect(callsTo('hand_off_to_staff')).toHaveLength(1);
    const second = JSON.parse(events.find((event) => event.type === 'TOOL_CALL_RESULT' && event.toolCallId === 'c2').content);
    expect(second.structuredContent.question).toMatchObject({ reference: 'Q-1234', status: 'open' });
  });

  it('hands off once when the model searches and hands off in the same step: its two calls run together', async () => {
    const { callsTo } = await converse({
      messages: [say(QUESTION)],
      steps: [
        {
          calls: [
            { id: 'c1', name: 'search_knowledge', input: { query: 'watch' } },
            { id: 'c2', name: 'hand_off_to_staff', input: { question: QUESTION, reason: 'no_answer' } },
          ],
        },
        { words: 'Noted.' },
      ],
      strapi: { handlers: handlers() },
    });
    expect(callsTo('hand_off_to_staff')).toHaveLength(1);
  });

  it('goes to Strapi with a hand_off_to_staff the model makes when no hand-off has happened, once however many it makes', async () => {
    const { callsTo } = await converse({
      messages: [say('Can I talk to a person?')],
      steps: [
        {
          calls: [
            { id: 'c1', name: 'hand_off_to_staff', input: { question: 'Can I talk to a person?', reason: 'asked_for_person' } },
            { id: 'c2', name: 'hand_off_to_staff', input: { question: 'Can I talk to a person?', reason: 'asked_for_person' } },
          ],
        },
        { words: 'An advisor will message you.' },
      ],
      strapi: { handlers: handlers() },
    });
    expect(callsTo('hand_off_to_staff')).toHaveLength(1);
  });

  it("doesn't count a hand-off that failed: the model's own call after it still reaches Strapi", async () => {
    let calls = 0;
    const { callsTo } = await converse({
      messages: [say(QUESTION)],
      steps: [searches(), { calls: [{ id: 'c2', name: 'hand_off_to_staff', input: { question: QUESTION, reason: 'no_answer' } }] }, { words: 'Noted.' }],
      strapi: { handlers: handlers({ hand_off_to_staff: () => (++calls === 1 ? refusal('unavailable', 'Try later.', 'Try later.') : recordedAs('Q-9')) }) },
    });
    expect(callsTo('hand_off_to_staff')).toHaveLength(2);
  });

  it("doesn't hand off when the search found an entry, and leaves its result as it is", async () => {
    const { callsTo, events } = await converse({ messages: [say(QUESTION)], steps: [searches(), { words: 'It holds one.' }], strapi: { handlers: handlers({ search_knowledge: () => found({ title: 'Care' }) }) } });
    expect(callsTo('hand_off_to_staff')).toEqual([]);
    const result = JSON.parse(events.find((event) => event.type === 'TOOL_CALL_RESULT' && event.toolCallId === 'c1').content);
    expect(result.structuredContent).toEqual({ locale: 'en', entries: [{ title: 'Care' }] });
  });

  it("tells the model what the app did in the next turn too: the search's result in the conversation says the question was passed on", async () => {
    const earlier = assistantWith([
      toolCall('c0', 'search_knowledge', { query: 'watch' }, {
        content: [
          { type: 'text', text: '{"entries":[]}' },
          { type: 'text', text: "No entry answers this, so the question was passed to Maison's client advisors as Q-1234. Don't call hand_off_to_staff for it." },
        ],
        structuredContent: { entries: [], handOff: { reference: 'Q-1234', question: QUESTION, product: null } },
      }),
      { type: 'text', content: 'An advisor will message you.' },
    ]);
    const { model } = await converse({ messages: [say(QUESTION), earlier, say('Thanks', 'u2')] });
    expect(JSON.stringify(model.requests[0].messages)).toContain("Don't call hand_off_to_staff for it.");
  });

  it("logs a failed hand-off in the server's log and leaves the search's result as Strapi gave it", async () => {
    const warn = quietWarn();
    const { events } = await converse({
      messages: [say(QUESTION)],
      steps: [searches(), { words: 'Noted.' }],
      strapi: { handlers: handlers({ hand_off_to_staff: () => refusal('too_many_open_questions', 'Too many.', 'Wait.') }) },
    });
    const result = JSON.parse(events.find((event) => event.type === 'TOOL_CALL_RESULT' && event.toolCallId === 'c1').content);
    expect(result.structuredContent).toEqual({ locale: 'en', entries: [] });
    expect(warn.mock.calls.some((call) => String(call[0]).startsWith('[concierge] The hand-off for a search that found nothing recorded nothing'))).toBe(true);
  });

  it('hands off nothing for a customer message with no text: Strapi would refuse it', async () => {
    const { callsTo } = await converse({ messages: [say('  ')], steps: [searches(), { words: 'Noted.' }], strapi: { handlers: handlers() } });
    expect(callsTo('hand_off_to_staff')).toEqual([]);
  });
});
