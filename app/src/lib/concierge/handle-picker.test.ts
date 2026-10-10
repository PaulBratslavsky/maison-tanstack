import { afterEach, describe, expect, it, vi } from 'vitest';

import { NOW, assistantWith, cleanup, converse, say, toolCall, typesOf, wordsOf } from './handle-support';
import { answer, refusal, type Handler, type Step } from './test-support';
import { NO_PICKER, PICKER_NOTE } from './turn';

afterEach(cleanup);

/**
 * The visit picker's safety net, through the route. Rule 3 says to call choose_visit for a visit, but the model decides,
 * and once in production it asked for the boutique, day and time in words instead. So a turn that ended whole gets one
 * extra pass, a second chat() run whose events follow the first run's in the same response (the ChatClient tests in
 * handle-client.test.ts hold what the browser shows).
 */

const ASKED = 'I would like to book a visit to see cabin case';
/** The production reply that slipped: the boutique, day and time asked for in words, with no picker. */
const SLIPPED = 'Which boutique, day and time would you like for your visit to see the Cabin Case 55?';
const CABIN_CASE = { slug: 'cabin-case-55', name: 'Cabin Case 55' };

const picks = (id = 'p2', input: unknown = { productSlugs: ['cabin-case-55'] }): Step => ({ calls: [{ id, name: 'choose_visit', input }] });
const resolves = (id: string, input: unknown = { weekday: 'saturday' }): Step => ({ calls: [{ id, name: 'resolve_date', input }] });
const searchStep: Step = { calls: [{ id: 'c1', name: 'search_products', input: { query: 'cabin case' } }] };
const found = (...products: unknown[]) => answer({ products });
const quietWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
const quietError = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const toolNames = (run: Awaited<ReturnType<typeof converse>>, index: number) => run.model.requests[index].tools.map((tool) => tool.name).sort();
const toolCallNames = (events: any[]) => events.filter((event) => event.type === 'TOOL_CALL_START').map((event) => event.toolCallName);
const runFinishes = (events: any[]) => events.filter((event) => event.type === 'RUN_FINISHED');
/** The conversation's body for a booking request from a piece's page. */
const onThePage = { product: 'cabin-case-55' };

describe('the extra pass', () => {
  it('runs one extra pass for a booking with a known piece that ended in words: only resolve_date and choose_visit, the same instructions, a tool required on Anthropic', async () => {
    for (const [locale, asked] of [
      ['en', ASKED],
      ['ja', '来店を予約できますか？'],
    ] as const) {
      const run = await converse({ messages: [say(asked)], locale, ...onThePage, steps: [{ words: SLIPPED }, picks()] });
      const { events, model } = run;
      expect(model.modelCalls(), locale).toBe(2);
      expect(toolNames(run, 1), locale).toEqual(['choose_visit', 'resolve_date']);
      expect(model.requests[1].modelOptions, locale).toEqual({ tool_choice: { type: 'any' } });
      expect(model.requests[1].systemPrompts, `${locale}: the same instructions`).toEqual(model.requests[0].systemPrompts);
      // Never the assistant's turn last: Claude Sonnet 5 refuses that (a prefill) with a 400.
      expect((model.requests[1].messages.at(-1) as { role: string }).role, locale).toBe('user');

      // One run as the browser reads it: one start, one finish (the one that waits for the customer), the words and then the picker.
      expect(events.filter((event) => event.type === 'RUN_STARTED'), locale).toHaveLength(1);
      expect(runFinishes(events), locale).toHaveLength(1);
      expect(events.at(-1).type, locale).toBe('RUN_FINISHED');
      expect(events.at(-1).outcome, locale).toMatchObject({ type: 'interrupt', interrupts: [{ toolCallId: 'p2' }] });
      expect(events.some((event) => event.type === 'RUN_ERROR' || event.type === 'MESSAGES_SNAPSHOT'), locale).toBe(false);
      expect(wordsOf(events), locale).toBe(SLIPPED);
      expect(toolCallNames(events), locale).toEqual(['choose_visit']);
      const types = typesOf(events);
      expect(types.lastIndexOf('TEXT_MESSAGE_END'), locale).toBeLessThan(types.indexOf('TOOL_CALL_START'));
    }
  });

  it('makes the first model call with every tool and no tool required', async () => {
    const run = await converse({ messages: [say(ASKED)], ...onThePage, steps: [{ words: SLIPPED }, picks()] });
    expect(toolNames(run, 0)).toContain('search_products');
    expect(run.model.requests[0].modelOptions).toBeUndefined();
  });

  it("runs on Ollama too, with only the two tools offered: nothing forces the call there, so the model's modelOptions stay as they were", async () => {
    const run = await converse({ provider: 'ollama', messages: [say(ASKED)], ...onThePage, steps: [{ words: SLIPPED }, picks()] });
    expect(run.model.modelCalls()).toBe(2);
    expect(toolNames(run, 1)).toEqual(['choose_visit', 'resolve_date']);
    expect(run.model.requests[1].modelOptions).toEqual({ think: false });
    expect(run.events.at(-1).outcome).toMatchObject({ type: 'interrupt' });
    expect(toolCallNames(run.events)).toEqual(['choose_visit']);
  });

  it('keeps the first reply on Ollama when the model answers the second call in words, and says so in the log', async () => {
    const warn = quietWarn();
    const run = await converse({ provider: 'ollama', messages: [say(ASKED)], ...onThePage, steps: [{ words: SLIPPED }, { words: 'Which boutique would you like?' }] });
    expect(wordsOf(run.events)).toBe(SLIPPED);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(NO_PICKER, 'it ended without a visit picker');
  });

  it('logs the turn once, after both passes, with the picker note', async () => {
    const { callsTo } = await converse({ messages: [say(ASKED)], ...onThePage, steps: [{ words: SLIPPED }, picks()] });
    expect(callsTo('log_inquiry')).toStrictEqual([
      { message: ASKED, reply: `${SLIPPED}\n\n${PICKER_NOTE}`, knowledgeFound: false, handedOff: false, productSlug: 'cabin-case-55', locale: 'en' },
    ]);
  });

  it('knows a piece search_products found in this turn, and the extra pass sees the turn up to its last words', async () => {
    const run = await converse({ messages: [say(ASKED)], steps: [searchStep, { words: SLIPPED }, picks()], strapi: { handlers: { search_products: () => found(CABIN_CASE) } } });
    expect(run.model.modelCalls()).toBe(3);
    expect(toolNames(run, 2)).toEqual(['choose_visit', 'resolve_date']);
    // The search and its result, and not the words after it: the last message is the search's result.
    const sent = run.model.requests[2].messages as Array<{ role: string }>;
    expect(sent.at(-1)?.role).toBe('tool');
    expect(JSON.stringify(sent)).toContain('cabin-case-55');
    expect(JSON.stringify(sent)).not.toContain(SLIPPED);
    expect(run.events.at(-1).outcome).toMatchObject({ type: 'interrupt', interrupts: [{ toolCallId: 'p2' }] });
    // The words after the search, and the picker.
    expect(wordsOf(run.events)).toBe(SLIPPED);
  });

  it('knows a piece search_products or view_product found in an earlier turn of the conversation', async () => {
    const outputs: Array<[string, unknown]> = [
      ['search_products', found({ slug: 'voyage-trunk-110', name: 'Voyage Trunk 110' }, CABIN_CASE)],
      ['view_product', answer({ product: CABIN_CASE })],
    ];
    for (const [name, output] of outputs) {
      const earlier = assistantWith([toolCall('c0', name, {}, output), { type: 'text', content: 'Here are a few highlights.' }]);
      const run = await converse({ messages: [say('What do you have'), earlier, say(ASKED, 'u2')], steps: [{ words: SLIPPED }, picks()] });
      expect(run.model.modelCalls(), name).toBe(2);
      expect(run.events.at(-1).outcome, name).toMatchObject({ type: 'interrupt' });
    }
  });

  it('forces choose_visit on a step after the first, so a named day is resolved first and the picker follows it', async () => {
    const run = await converse({
      messages: [say('Can I book a visit on Saturday?')],
      ...onThePage,
      steps: [{ words: 'Which boutique and time would suit you?' }, resolves('r1'), picks('p3', { productSlugs: ['cabin-case-55'], date: '2026-10-10' })],
    });
    expect(run.model.modelCalls()).toBe(3);
    expect(run.model.requests[1].modelOptions).toEqual({ tool_choice: { type: 'any' } });
    expect(run.model.requests[2].modelOptions).toEqual({ tool_choice: { type: 'tool', name: 'choose_visit' } });
    expect(toolNames(run, 1)).toEqual(['choose_visit', 'resolve_date']);
    expect(toolNames(run, 2)).toEqual(['choose_visit', 'resolve_date']);
    const resolved = run.events.find((event) => event.type === 'TOOL_CALL_RESULT' && event.toolCallId === 'r1');
    expect(JSON.parse(resolved.content)).toMatchObject({ date: '2026-10-10', weekday: 'Saturday' });
    expect(run.events.at(-1).outcome).toMatchObject({ type: 'interrupt', interrupts: [{ toolCallId: 'p3' }] });
    // The pass's own steps reach the page: the day it worked out, and the picker.
    expect(toolCallNames(run.events)).toEqual(['resolve_date', 'choose_visit']);
  });

  it('goes back to requiring any tool after a choose_visit call that was refused, until one is shown', async () => {
    const run = await converse({
      messages: [say(ASKED)],
      ...onThePage,
      steps: [{ words: SLIPPED }, picks('p2', { productSlugs: ['cabin-case-5'] }), picks('p3')],
      strapi: { handlers: { find_boutiques: ({ productSlugs }) => (JSON.stringify(productSlugs).includes('cabin-case-5"') ? refusal('not_found', 'No published product "cabin-case-5".', 'Call search_products.') : answer({ boutiques: [] })) } },
    });
    expect(run.model.modelCalls()).toBe(3);
    expect(run.model.requests[2].modelOptions).toEqual({ tool_choice: { type: 'any' } });
    expect(run.events.at(-1).outcome).toMatchObject({ type: 'interrupt', interrupts: [{ toolCallId: 'p3' }] });
  });
});

describe('the extra pass keeps the first reply', () => {
  it('when the extra pass calls no tool, or never calls choose_visit: its steps never reach the page, and the log says why', async () => {
    const warn = quietWarn();
    const cases: Array<[string, Step[], number]> = [
      ['words only', [{ words: SLIPPED }, { words: 'Which boutique would you like?' }], 2],
      ['resolve_date again and again', [{ words: SLIPPED }, resolves('r1'), resolves('r2'), resolves('r3'), resolves('r4')], 4], // three steps at most
    ];
    for (const [what, steps, calls] of cases) {
      warn.mockClear();
      const run = await converse({ messages: [say(ASKED)], ...onThePage, steps });
      expect(run.model.modelCalls(), what).toBe(calls);
      expect(wordsOf(run.events), what).toBe(SLIPPED);
      expect(run.events.some((event) => event.type === 'RUN_ERROR'), what).toBe(false);
      expect(runFinishes(run.events), what).toHaveLength(1);
      expect(run.events.at(-1).outcome ?? null, what).toBeNull(); // the first run's finish: nothing waits for the customer
      expect(toolCallNames(run.events), what).toEqual([]);
      expect(warn, what).toHaveBeenCalledTimes(1);
      expect(warn, what).toHaveBeenCalledWith(NO_PICKER, 'it ended without a visit picker');
      expect(run.callsTo('log_inquiry'), what).toHaveLength(1);
      expect(run.callsTo('log_inquiry')[0], what).toMatchObject({ reply: SLIPPED });
    }
  });

  it("when the extra pass's pieces are checked as any choose_visit's: a piece Strapi doesn't know shows no picker, and the first reply stays", async () => {
    const warn = quietWarn();
    const run = await converse({
      messages: [say(ASKED)],
      ...onThePage,
      steps: [{ words: SLIPPED }, picks('p2', { productSlugs: ['cabin-case-5'] }), {}],
      strapi: { handlers: { find_boutiques: () => refusal('not_found', 'No published product "cabin-case-5".', 'Call search_products.') } },
    });
    expect(run.callsTo('find_boutiques')).toEqual([{ productSlugs: ['cabin-case-5'], locale: 'en' }]);
    expect(toolCallNames(run.events)).toEqual([]);
    expect(wordsOf(run.events)).toBe(SLIPPED);
    expect(run.events.at(-1).outcome ?? null).toBeNull();
    expect(warn).toHaveBeenCalledWith(NO_PICKER, 'it ended without a visit picker');
    expect(run.callsTo('log_inquiry')[0]).toMatchObject({ reply: SLIPPED });
  });

  it('when the extra pass fails: nothing of it reaches the page, the turn is logged once without the note, and the log says why', async () => {
    const warn = quietWarn();
    const error = quietError();
    const failures: Array<[string, Step, string]> = [
      ['throws', { throws: 'The model broke.' }, 'The model broke.'],
      ['an error after some words', { words: 'Here is', fail: 'The provider broke.' }, 'The provider broke.'],
      ['hangs', { stall: true }, 'it took longer than 0.1 seconds'],
    ];
    for (const [what, second, why] of failures) {
      warn.mockClear();
      const run = await converse({ messages: [say(ASKED)], ...onThePage, steps: [{ words: SLIPPED }, second], deps: { timeouts: { pickerPassMs: 100 } } });
      expect(run.model.modelCalls(), what).toBe(2);
      expect(run.events.some((event) => event.type === 'RUN_ERROR'), what).toBe(false);
      expect(runFinishes(run.events), what).toHaveLength(1);
      expect(run.events.at(-1).type, what).toBe('RUN_FINISHED');
      expect(wordsOf(run.events), `${what}: nothing of the failed pass reaches the page`).toBe(SLIPPED);
      expect(run.callsTo('log_inquiry'), what).toHaveLength(1);
      expect(run.callsTo('log_inquiry')[0], what).toMatchObject({ message: ASKED, reply: SLIPPED });
      expect(warn, what).toHaveBeenCalledTimes(1);
      expect(warn, what).toHaveBeenCalledWith(NO_PICKER, why);
      expect(run.closed, what).toHaveBeenCalledTimes(1);
    }
    expect(error).not.toHaveBeenCalled(); // the first pass didn't fail, so the turn isn't reported as failed
  });

  it('says nothing, and logs the turn as the first pass ended, when the customer leaves during the extra pass', async () => {
    const warn = quietWarn();
    const gone = new AbortController();
    setTimeout(() => gone.abort(), 60);
    const run = await converse({ messages: [say(ASKED)], ...onThePage, steps: [{ words: SLIPPED }, { stall: true }], signal: gone.signal });
    expect(run.model.modelCalls()).toBe(2);
    expect(wordsOf(run.events)).toBe(SLIPPED);
    expect(run.events.some((event) => event.type === 'RUN_ERROR')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(run.callsTo('log_inquiry')).toHaveLength(1);
    expect(run.callsTo('log_inquiry')[0]).toMatchObject({ reply: SLIPPED });
    expect(run.closed).toHaveBeenCalledTimes(1);
  });
});

describe('the extra pass is not made', () => {
  it("for a message that isn't a booking request, or a reply that called choose_visit, even one it refused", async () => {
    const warn = quietWarn();
    const notAsked = await converse({ messages: [say('What do you have?')], ...onThePage, steps: [{ words: 'Here are three.' }] });
    expect(notAsked.model.modelCalls(), 'not a booking request').toBe(1);

    const shown = await converse({ messages: [say(ASKED)], ...onThePage, steps: [{ words: 'Here it is.', ...picks('p1') }] });
    expect(shown.model.modelCalls(), 'choose_visit called').toBe(1);
    expect(shown.events.at(-1).outcome).toMatchObject({ type: 'interrupt', interrupts: [{ toolCallId: 'p1' }] });

    // Refused by its schema (no pieces), and the model answers in words: no second picker for that.
    const refused = await converse({ messages: [say(ASKED)], ...onThePage, steps: [picks('p1', {}), { words: 'Let me find it.' }] });
    expect(refused.model.modelCalls(), 'choose_visit refused').toBe(2);
    expect(wordsOf(refused.events)).toBe('Let me find it.');
    expect(warn).not.toHaveBeenCalled();
  });

  it('when no piece is known: no page, and no search that found one in the conversation', async () => {
    const warn = quietWarn();
    const noPage = await converse({ messages: [say(ASKED)], steps: [{ words: 'Which piece would you like to see?' }] });
    expect(noPage.model.modelCalls(), 'no page').toBe(1);

    const cases: Array<[string, Handler]> = [
      ['a search that found nothing', () => found()],
      ['a refused search', () => refusal('unavailable', 'Try later.', 'Try later.')],
    ];
    for (const [what, handler] of cases) {
      const run = await converse({ messages: [say(ASKED)], steps: [searchStep, { words: 'Which piece?' }], strapi: { handlers: { search_products: handler } } });
      expect(run.model.modelCalls(), what).toBe(2);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  const requested = { status: 'requested', appointment: { reference: 'APT-0042', status: 'requested', boutique: { slug: 'ginza', name: 'Ginza Flagship' }, requestedFor: '2026-10-10T14:00:00+09:00', products: [CABIN_CASE], note: '', confirmationSent: false } };
  const answeredPicker = (output: unknown, text: string) => assistantWith([toolCall('p0', 'choose_visit', { productSlugs: ['cabin-case-55'] }, output), { type: 'text', content: text }]);

  // A question about a visit already requested must not get a fresh picker, whose Send request would book it twice.
  it('once a visit was requested in this chat: after that, the model alone decides', async () => {
    const warn = quietWarn();
    for (const asked of ['Is my booking confirmed?', 'Can I book a visit?']) {
      const run = await converse({ messages: [say('Can I book a visit?'), answeredPicker(requested, 'Your visit is requested.'), say(asked, 'u2')], ...onThePage, steps: [{ words: 'It is requested.' }] });
      expect(run.model.modelCalls(), asked).toBe(1);
    }
    // A picker closed without a request requested nothing: the customer may still want a visit.
    const closed = await converse({ messages: [say('Can I book a visit?'), answeredPicker({ status: 'closed' }, 'Of course.'), say(ASKED, 'u2')], ...onThePage, steps: [{ words: SLIPPED }, picks()] });
    expect(closed.model.modelCalls()).toBe(2);
    expect(closed.events.at(-1).outcome).toMatchObject({ type: 'interrupt' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('when the turn called my_appointments: the customer asked about the visits they have', async () => {
    const warn = quietWarn();
    for (const asked of ['Do I have any appointments?', 'Can I book a visit?']) {
      const run = await converse({ messages: [say(asked)], ...onThePage, steps: [{ calls: [{ id: 'm1', name: 'my_appointments', input: {} }] }, { words: 'You have no visits yet.' }] });
      expect(run.model.modelCalls(), `${asked}: the reply's own two calls, and no extra one`).toBe(2);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("on a resume: the picker's answer continues a turn that was the customer's", async () => {
    const run = await converse({
      messages: [say(ASKED), assistantWith([toolCall('p1', 'choose_visit', { productSlugs: ['cabin-case-55'] }, { status: 'closed' })])],
      ...onThePage,
      steps: [{ words: 'Of course. Let me know if I can help.' }],
    });
    expect(run.model.modelCalls()).toBe(1);
    expect(run.callsTo('log_inquiry')).toEqual([]);
  });

  it('when the first pass failed: the model threw, or failed after a step that found the piece', async () => {
    const warn = quietWarn();
    quietError();
    const threw = await converse({ messages: [say(ASKED)], ...onThePage, steps: [{ throws: 'The model broke.' }] });
    expect(threw.model.modelCalls(), 'threw').toBe(1);
    expect(threw.callsTo('log_inquiry'), 'threw').toEqual([]);

    const afterAStep = await converse({ messages: [say(ASKED)], steps: [searchStep, { words: 'Let me ch', fail: 'The provider broke.' }], strapi: { handlers: { search_products: () => found(CABIN_CASE) } } });
    expect(afterAStep.model.modelCalls(), 'after a step').toBe(2);
    expect(afterAStep.events.filter((event) => event.type === 'RUN_ERROR').map((event) => event.message)).toEqual(['The provider broke.']);
    expect(afterAStep.callsTo('log_inquiry'), 'after a step').toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the extra pass has what is left of the turn', () => {
  /** deps.now as a clock: the request's start on its first call, and `laterMs` after it on every call after that. */
  const clockAt = (laterMs: number) => {
    const start = NOW.getTime();
    let calls = 0;
    return () => new Date(start + (calls++ === 0 ? 0 : laterMs));
  };

  // The route may run for 60 seconds, and the log after the extra pass may take 5 of them.
  it("gives the extra pass what is left of the turn's 55 seconds, 20 at most, and skips it with the warning when under 5 would be left", async () => {
    const warn = quietWarn();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const body = { messages: [say(ASKED)], ...onThePage };
    // 30 seconds gone: 20 are left of 25.
    const early = await converse({ ...body, steps: [{ words: SLIPPED }, picks()], deps: { now: clockAt(30_000) } });
    expect(early.model.modelCalls()).toBe(2);
    expect(timeout).toHaveBeenCalledWith(20_000);
    // 40 seconds gone: 15 are left.
    timeout.mockClear();
    const later = await converse({ ...body, steps: [{ words: SLIPPED }, picks()], deps: { now: clockAt(40_000) } });
    expect(later.model.modelCalls()).toBe(2);
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(later.events.at(-1).outcome).toMatchObject({ type: 'interrupt' });
    expect(warn).not.toHaveBeenCalled();
    // 51 seconds gone: 4 would be left, so no extra pass, and the first reply stays.
    const late = await converse({ ...body, steps: [{ words: SLIPPED }], deps: { now: clockAt(51_000) } });
    expect(late.model.modelCalls()).toBe(1);
    expect(toolCallNames(late.events)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(NO_PICKER, 'the turn had 4 seconds left, under the 5 the pass needs');
    expect(late.callsTo('log_inquiry')).toHaveLength(1);
    expect(late.callsTo('log_inquiry')[0]).toMatchObject({ reply: SLIPPED });
  });
});
