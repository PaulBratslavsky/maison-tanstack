import { ChatClient, fetchServerSentEvents, type ConnectionAdapter } from '@tanstack/ai-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chat, maxIterations, type StreamChunk, type UIMessage } from '@tanstack/ai';

import { CHOOSE_VISIT, livePickerOf, pickerViewOf } from '../visit-picker';
import { handleConcierge } from './handle';
import { AUTHORIZATION, NOW, cleanup, modelOf } from './handle-support';
import { chooseVisitDefinition } from './local-tools';
import { answer, fakeStrapi, type Handler, type Step } from './test-support';
import { NO_PICKER } from './turn';

/**
 * The browser's side of the extra pass. These tests put the real `ChatClient` of @tanstack/ai-client in front of
 * `handleConcierge`: the client sends its AG-UI request through `fetchServerSentEvents`, whose fetch is the route's
 * handler, and reads the server-sent events that come back, as the chat page's `useChat` does. The model is a script, and
 * Strapi is in memory. Nothing here calls a provider.
 *
 * The extra pass is a second `chat()` run. Its events follow the first run's in the same response, and the order is:
 * the first run's events, then the extra pass's tool call events, and one finish last. The first run's last finish waits
 * (it would close the message for the browser), and the pass's start and snapshot are left out (a snapshot would replace
 * the conversation with the pass's two messages). The browser then builds one message: the first reply's words, and
 * after them the picker.
 */

afterEach(cleanup);

const ASKED = 'I would like to book a visit to see cabin case';
const SLIPPED = 'Which boutique, day and time would you like for your visit to see the Cabin Case 55?';
const appointment = {
  reference: 'APT-0042',
  status: 'requested',
  boutique: { slug: 'ginza', name: 'Ginza Flagship' },
  requestedFor: '2026-10-10T14:00:00+09:00',
  products: [{ slug: 'cabin-case-55', name: 'Cabin Case 55' }],
  note: '',
  confirmationSent: false,
};
const picks = (id = 'p2', input: unknown = { productSlugs: ['cabin-case-55'] }): Step => ({ calls: [{ id, name: CHOOSE_VISIT, input }] });

/** The chat page's side: a ChatClient whose connection is the route, with Strapi in memory for each request. */
const chatPage = async ({ steps, provider, product = 'cabin-case-55', handlers = {} }: { steps: Step[]; provider?: 'anthropic' | 'ollama'; product?: string | null; handlers?: Record<string, Handler> }) => {
  const model = modelOf(steps, provider);
  // One Strapi for each request the client makes: a transport connects once.
  const pool = await Promise.all(Array.from({ length: 4 }, () => fakeStrapi({ handlers })));
  let nextStrapi = 0;
  const requests: Array<{ messages: Array<{ role: string }> }> = [];
  const fetchClient = async (input: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return handleConcierge(new Request(String(input), init), {
      model: model.model,
      strapiUrl: 'http://strapi.test',
      createTransport: () => pool[nextStrapi++].clientTransport,
      now: () => NOW,
    });
  };
  const connection = fetchServerSentEvents('http://localhost:3004/api/concierge', async () => ({
    headers: { Authorization: AUTHORIZATION },
    body: { locale: 'en', ...(product ? { product } : {}) },
    fetchClient: fetchClient as typeof fetch,
  }));
  const client = new ChatClient({ connection, tools: [chooseVisitDefinition.client()] });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  const messages = () => client.getMessages() as UIMessage[];
  const assistants = () => messages().filter((message) => message.role === 'assistant');
  const partsOf = (message: UIMessage) => message.parts.filter((part) => part.type === 'text' || part.type === 'tool-call');
  const pickerOf = () =>
    messages()
      .flatMap((message) => message.parts)
      .find((part) => part.type === 'tool-call' && part.name === CHOOSE_VISIT) as Extract<UIMessage['parts'][number], { type: 'tool-call' }> | undefined;
  const logs = () => pool.flatMap((strapi) => strapi.calls.filter((call) => call.name === 'log_inquiry').map((call) => call.args));
  const texts = (message: UIMessage) => message.parts.flatMap((part) => (part.type === 'text' ? [part.content] : []));
  return { client, model, requests, settle, messages, assistants, partsOf, pickerOf, logs, texts };
};

describe('the browser after the extra pass', () => {
  it("shows the first reply's words and then the picker, in one message, waiting for the customer", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await chatPage({ steps: [{ words: SLIPPED }, picks()] });
    await page.client.sendMessage(ASKED);
    await page.settle();

    expect(page.requests).toHaveLength(1);
    expect(page.model.modelCalls()).toBe(2); // the reply, and the extra pass
    expect(page.messages().map((message) => message.role)).toEqual(['user', 'assistant']);
    const [reply] = page.assistants();
    expect(page.partsOf(reply).map((part) => part.type)).toEqual(['text', 'tool-call']);
    expect(page.texts(reply)).toEqual([SLIPPED]); // the words once, not twice
    const picker = page.pickerOf()!;
    expect(picker).toMatchObject({ id: 'p2', state: 'input-complete', input: { productSlugs: ['cabin-case-55'] } });
    expect(picker.output).toBeUndefined();
    expect(livePickerOf(page.messages() as never)).toBe('p2');
    expect(pickerViewOf(picker, { live: true, busy: false })).toEqual({ kind: 'form', canSend: true });
    expect(page.client.getIsLoading()).toBe(false);
    expect(page.client.getError()).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    // The turn is logged once, with the note: the customer's words, and a picker that was shown.
    expect(page.logs()).toHaveLength(1);
    expect(page.logs()[0]).toMatchObject({ message: ASKED, reply: expect.stringContaining('visit picker') });
  });

  it('continues exactly once when the picker is answered, as a new message, and sends nothing after it', async () => {
    const page = await chatPage({ steps: [{ words: SLIPPED }, picks(), { words: 'Your visit is requested. The boutique will confirm it on LINE.' }] });
    await page.client.sendMessage(ASKED);
    await page.settle();
    expect(page.requests).toHaveLength(1);

    await page.client.addToolResult({ tool: CHOOSE_VISIT, toolCallId: 'p2', output: { status: 'requested', appointment } });
    await page.settle();
    await page.settle();

    // One answer, one more request. It carries the answer, and the model's reply ended: no more requests after it.
    expect(page.requests).toHaveLength(2);
    expect(page.model.modelCalls()).toBe(3); // the reply, the extra pass, and the reply to the answer
    expect(page.pickerOf()).toMatchObject({ id: 'p2', state: 'complete', output: { status: 'requested', appointment } });
    // The model was shown the answer, last, after the words and the call it answers.
    const sent = page.model.requests[2].messages as Array<{ role: string }>;
    expect(sent.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
    expect(JSON.stringify(sent.at(-1))).toContain('APT-0042');
    // A resume is no new question and no new pass: the turn was logged once, and the continuation made no extra pass.
    expect(page.logs()).toHaveLength(1);
    const last = page.assistants().at(-1)!;
    expect(page.texts(last)).toContain('Your visit is requested. The boutique will confirm it on LINE.');
    expect(page.client.getError()).toBeUndefined();
    // Never again by itself.
    await page.settle();
    expect(page.requests).toHaveLength(2);
    expect(page.model.modelCalls()).toBe(3);
  });

  it('continues once for a picker closed without a request, and says nothing to log', async () => {
    const page = await chatPage({ steps: [{ words: SLIPPED }, picks(), { words: 'Of course.' }] });
    await page.client.sendMessage(ASKED);
    await page.settle();
    await page.client.addToolResult({ tool: CHOOSE_VISIT, toolCallId: 'p2', output: { status: 'closed' } });
    await page.settle();
    expect(page.requests).toHaveLength(2);
    expect(page.model.modelCalls()).toBe(3);
    expect(page.pickerOf()).toMatchObject({ state: 'complete', output: { status: 'closed' } });
    expect(page.logs()).toHaveLength(1);
  });

  it('leaves the first reply alone when the extra pass fails: no error, no picker, and the log says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failures: Array<[string, Step, string]> = [
      ['throws', { throws: 'The model broke.' }, 'The model broke.'],
      ['gives an error after some words', { words: 'Here is', fail: 'The provider broke.' }, 'The provider broke.'],
    ];
    for (const [what, second, why] of failures) {
      warn.mockClear();
      const page = await chatPage({ steps: [{ words: SLIPPED }, second] });
      await page.client.sendMessage(ASKED);
      await page.settle();
      expect(page.messages().map((message) => message.role), what).toEqual(['user', 'assistant']);
      expect(page.texts(page.assistants()[0]), what).toEqual([SLIPPED]);
      expect(page.pickerOf(), what).toBeUndefined();
      expect(page.client.getError(), what).toBeUndefined();
      expect(page.client.getIsLoading(), what).toBe(false);
      expect(page.requests, what).toHaveLength(1);
      expect(warn, what).toHaveBeenCalledWith(NO_PICKER, why);
      expect(page.logs(), what).toHaveLength(1);
      expect(page.logs()[0], what).toMatchObject({ reply: SLIPPED });
    }
  });

  it('leaves the first reply alone when the extra pass shows no picker: words only, or a piece Strapi refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cases: Array<[string, Step[], Record<string, Handler>]> = [
      ['words only', [{ words: SLIPPED }, { words: 'Which boutique?' }], {}],
      [
        'a piece Strapi refuses',
        [{ words: SLIPPED }, picks('p2', { productSlugs: ['cabin-case-5'] }), {}],
        { find_boutiques: () => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'not_found', message: 'No such piece.', hint: 'Call search_products.' } }) }] }) },
      ],
    ];
    for (const [what, steps, handlers] of cases) {
      warn.mockClear();
      const page = await chatPage({ steps, handlers });
      await page.client.sendMessage(ASKED);
      await page.settle();
      expect(page.messages().map((message) => message.role), what).toEqual(['user', 'assistant']);
      expect(page.texts(page.assistants()[0]), what).toEqual([SLIPPED]);
      expect(page.pickerOf(), what).toBeUndefined();
      expect(page.client.getError(), what).toBeUndefined();
      expect(warn, what).toHaveBeenCalledWith(NO_PICKER, 'it ended without a visit picker');
    }
  });

  it('puts the picker after the words of the last step when the turn had tool calls: in the message that holds those words', async () => {
    const page = await chatPage({
      steps: [{ words: 'Let me look.', calls: [{ id: 'c1', name: 'search_products', input: { query: 'cabin case' } }] }, { words: SLIPPED }, picks()],
      product: null,
      handlers: { search_products: () => answer({ products: [{ slug: 'cabin-case-55', name: 'Cabin Case 55' }] }) },
    });
    await page.client.sendMessage(ASKED);
    await page.settle();
    expect(page.requests).toHaveLength(1);
    expect(page.model.modelCalls()).toBe(3);
    // The client makes one message for each model call that spoke (TanStack AI's message ids): the search's, and the last one.
    const types = page.assistants().flatMap((message) => page.partsOf(message).map((part) => (part.type === 'tool-call' ? `call:${part.name}` : 'text')));
    expect(types).toEqual(['text', 'call:search_products', 'text', `call:${CHOOSE_VISIT}`]);
    expect(page.assistants()).toHaveLength(2);
    expect(page.texts(page.assistants()[0])).toEqual(['Let me look.']);
    const last = page.assistants()[1];
    expect(page.partsOf(last).map((part) => part.type)).toEqual(['text', 'tool-call']);
    expect(page.texts(last)).toEqual([SLIPPED]);
    expect(page.pickerOf()).toMatchObject({ id: 'p2', state: 'input-complete' });
    expect(page.client.getError()).toBeUndefined();
    // The search's result is in the message, as the chat's cards read it.
    const search = page.messages().flatMap((message) => message.parts).find((part) => part.type === 'tool-call' && part.name === 'search_products') as { state: string; output: unknown };
    expect(search.state).toBe('complete');
    expect(JSON.stringify(search.output)).toContain('cabin-case-55');
  });

  it("keeps the pass's own steps in that message too: the day it resolves, and then the picker, after the first reply's words", async () => {
    const page = await chatPage({ steps: [{ words: 'Which boutique and time would suit you?' }, { calls: [{ id: 'r1', name: 'resolve_date', input: { weekday: 'saturday' } }] }, picks('p3', { productSlugs: ['cabin-case-55'], date: '2026-10-10' })] });
    await page.client.sendMessage('Can I book a visit on Saturday?');
    await page.settle();
    expect(page.model.modelCalls()).toBe(3);
    expect(page.assistants()).toHaveLength(1);
    expect(page.partsOf(page.assistants()[0]).map((part) => (part.type === 'tool-call' ? `call:${part.name}:${part.state}` : 'text'))).toEqual(['text', 'call:resolve_date:complete', `call:${CHOOSE_VISIT}:input-complete`]);
    expect(page.pickerOf()).toMatchObject({ id: 'p3', input: { date: '2026-10-10' } });
    expect(page.client.getError()).toBeUndefined();
  });

  it('works the same on Ollama, where only the tools are limited', async () => {
    const page = await chatPage({ provider: 'ollama', steps: [{ words: SLIPPED }, picks(), { words: 'Noted.' }] });
    await page.client.sendMessage(ASKED);
    await page.settle();
    expect(page.assistants()).toHaveLength(1);
    expect(page.partsOf(page.assistants()[0]).map((part) => part.type)).toEqual(['text', 'tool-call']);
    await page.client.addToolResult({ tool: CHOOSE_VISIT, toolCallId: 'p2', output: { status: 'closed' } });
    await page.settle();
    expect(page.requests).toHaveLength(2);
    expect(page.model.modelCalls()).toBe(3);
  });

  it('is no different when the model calls choose_visit itself: one message, and one continuation for the answer', async () => {
    const page = await chatPage({ steps: [{ words: 'Here is the picker.', ...picks('p1') }, { words: 'Done.' }] });
    await page.client.sendMessage(ASKED);
    await page.settle();
    expect(page.model.modelCalls()).toBe(1); // no extra pass
    expect(page.partsOf(page.assistants()[0]).map((part) => part.type)).toEqual(['text', 'tool-call']);
    await page.client.addToolResult({ tool: CHOOSE_VISIT, toolCallId: 'p1', output: { status: 'closed' } });
    await page.settle();
    expect(page.requests).toHaveLength(2);
    expect(page.model.modelCalls()).toBe(2);
  });

  // The route drops an open picker from what the model reads (handle.test.ts), for a conversation that was sent again with
  // one open, as after a reload. ChatClient itself never sends one: it refuses new input while a client tool waits.
  it('refuses to send a new message while the picker waits: the chat page must lock its composer, and answer or close the picker first', async () => {
    const page = await chatPage({ steps: [{ words: SLIPPED }, picks(), { words: 'Noted.' }] });
    await page.client.sendMessage(ASKED);
    await page.settle();
    await expect(page.client.sendMessage('Never mind, when do you open?')).rejects.toThrow(/pending interrupts/);
    await page.settle();
    expect(page.requests).toHaveLength(1);
    expect(page.model.modelCalls()).toBe(2);
    expect(page.pickerOf()).toMatchObject({ id: 'p2', state: 'input-complete' });
  });
});

// Why handle.ts splices the way it does. These feed the real ChatClient the events of two real chat() runs in other orders.
// If an upgrade of @tanstack/ai or @tanstack/ai-client changes what a snapshot or a second finish does, the first of them
// fails and says so: then the splice can be simpler, or must change.
describe('the orders of events that were not chosen', () => {
  const collect = async (steps: Step[], withPicker: boolean) => {
    const model = modelOf(steps);
    const events: StreamChunk[] = [];
    const stream = chat({
      adapter: model.model.adapter as never,
      messages: [{ role: 'user', content: 'hi' }],
      tools: withPicker ? [chooseVisitDefinition.client()] : [],
      agentLoopStrategy: maxIterations(3),
      threadId: 'thread-1',
      runId: 'run-1',
    }) as AsyncIterable<StreamChunk>;
    for await (const event of stream) events.push(event);
    return events;
  };
  const without = (events: StreamChunk[], ...types: string[]) => events.filter((event) => !types.includes(event.type));
  /** What a ChatClient makes of `events`: each message as its parts, text and calls. */
  const browserShows = async (events: StreamChunk[]) => {
    const connection: ConnectionAdapter = {
      connect: async function* () {
        yield* events;
      },
    };
    const client = new ChatClient({ connection, tools: [chooseVisitDefinition.client()] });
    await client.sendMessage('hi');
    await new Promise((resolve) => setTimeout(resolve, 40));
    return client.getMessages().map((message) => ({ role: message.role, parts: message.parts.map((part) => (part.type === 'text' ? `text:${part.content}` : part.type === 'tool-call' ? `call:${part.name}:${part.state}` : part.type)) }));
  };

  it("loses the first reply's words when the extra pass's snapshot is sent: it replaces the conversation with the pass's own two messages", async () => {
    const first = await collect([{ words: 'FIRST' }], false);
    const pass = await collect([picks('p2')], true);
    expect(pass.map((event) => event.type)).toContain('MESSAGES_SNAPSHOT');
    const kept = [{ role: 'user', parts: ['text:hi'] }, { role: 'assistant', parts: ['text:FIRST', 'call:choose_visit:input-complete'] }];
    // Whatever is done with the finishes and the start, a snapshot costs the words.
    for (const events of [[...first, ...pass], [...first, ...without(pass, 'RUN_STARTED')], [...without(first, 'RUN_FINISHED'), ...without(pass, 'RUN_STARTED')]]) {
      expect(await browserShows(events)).toEqual([{ role: 'user', parts: ['text:hi'] }, { role: 'assistant', parts: ['call:choose_visit:input-complete'] }]);
    }
    // Without it, the words stay, in one message with the picker waiting.
    expect(await browserShows([...without(first, 'RUN_FINISHED'), ...without(pass, 'RUN_STARTED', 'MESSAGES_SNAPSHOT')])).toEqual(kept);
  });
});
