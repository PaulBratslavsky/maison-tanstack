import { z } from '@strapi/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION, UID } from '../../server/src/constants';
import { CHAT_TOO_LONG_TEXT, SOMETHING_WRONG_TEXT } from '../../server/src/assistant/errors';
import { createAnthropicAdapter, loadSdk, resetSdkForTests, toTools } from '../../server/src/ai/sdk';
import { READ_TOOL_NAMES } from '../../server/src/assistant/tools';
import { DATA_RULE } from '../../server/src/assistant/views';
import appointments from '../../server/src/services/appointments';
import assistantService, { countStaffMessages, type AdapterFor } from '../../server/src/services/assistant';
import inquiries from '../../server/src/services/inquiries';
import questions from '../../server/src/services/questions';
import { matches } from './fake-filters';
import { errorTurn, fakeTextAdapter, stopTurn, textTurn, toolCallTurn, type ScriptedTurn } from './fake-text-adapter';
import { fakeStrapi } from './fake-strapi';

type Doc = Record<string, any>;

const KEY = 'sk-ant-api03-TEST-KEY-123';
const NOW = new Date('2026-10-05T16:30:00.000Z');
const NO_KEY = "The assistant isn't set up. It needs an Anthropic API key in AI_API_KEY, with AI_PROVIDER unset or anthropic. Then restart Strapi.";
const everything = { can: () => true };
const nothing = { can: () => false };

/** The AG-UI run input the browser posts, with these messages. */
const bodyOf = (messages: unknown[], extra: Doc = {}) => ({ threadId: 'thread-1', runId: 'run-1', messages, tools: [], context: [], ...extra });
const staffSays = (text: string, id = 'user-1') => ({ id, role: 'user', content: text });

/** The events of a server-sent event stream, parsed. */
const eventsOf = async (response: Response): Promise<Doc[]> =>
  (await response.text())
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)));
const typesOf = (events: Doc[]) => events.map((event) => event.type);
const errorsOf = (events: Doc[]) => events.filter((event) => event.type === 'RUN_ERROR');
const customOf = (events: Doc[]) => events.filter((event) => event.type === 'CUSTOM').map((event) => event.name);
const textOf = (events: Doc[]) => events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').map((event) => event.delta).join('');

interface Setup {
  turns?: ScriptedTurn[];
  services?: Record<string, unknown>;
  config?: Doc;
}

/** The assistant service over Strapi's stand-in, with a fake adapter that plays `turns`. */
const setup = ({ turns = [], services = {}, config = {} }: Setup = {}) => {
  const fake = fakeTextAdapter(turns);
  const strapi = fakeStrapi({ services, config: { aiApiKey: KEY, ...config } });
  const service = assistantService({ strapi });
  const adapterFor = vi.fn<AdapterFor>(() => fake.adapter);
  return { service, strapi, adapterFor, ...fake };
};

/** One turn, from the staff message to the end of the stream. */
const run = async (world: ReturnType<typeof setup>, text = 'Hi', extra: Partial<Parameters<ReturnType<typeof setup>['service']['turn']>[1]> = {}, body: Doc = {}) => {
  const params = await world.service.parseBody(bodyOf([staffSays(text)], body));
  const responseController = new AbortController();
  const response = await world.service.turn(params, { ability: everything, adminId: 7, responseController, adapterFor: world.adapterFor, now: NOW, ...extra });
  return { response, responseController, events: await eventsOf(response) };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('@tanstack/ai');
  vi.doUnmock('@tanstack/ai-anthropic');
});

describe('the SDK loader', () => {
  it('loads @tanstack/ai, and loads it again after a reset', async () => {
    expect(await loadSdk()).toMatchObject({ chat: expect.any(Function), maxIterations: expect.any(Function), toServerSentEventsResponse: expect.any(Function) });
    resetSdkForTests();
    expect(await loadSdk()).toMatchObject({ chat: expect.any(Function) });
  });

  it('builds the Anthropic adapter for the model it is given, an ID the adapter list does not know included, without calling Anthropic', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await createAnthropicAdapter('claude-sonnet-5-5', KEY)).toMatchObject({ kind: 'text', name: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(await createAnthropicAdapter('claude-sonnet-5', KEY)).toMatchObject({ model: 'claude-sonnet-5' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('makes a server tool of a spec with an execute, and a tool with none of a spec without one: the browser runs that one', async () => {
    const [read, draft] = (await toTools([
      { name: 'list_things', description: 'Lists things.', inputSchema: z.object({}), execute: async () => ({ things: [] }) },
      { name: 'draft_thing', description: 'Shows a draft.', inputSchema: z.object({ text: z.string() }) },
    ])) as Doc[];
    expect(read).toMatchObject({ name: 'list_things', description: 'Lists things.', __toolSide: 'server' });
    expect(read.execute).toBeTypeOf('function');
    expect(draft).toMatchObject({ name: 'draft_thing', description: 'Shows a draft.' });
    expect(draft.execute).toBeUndefined();
  });

  it.each([
    ['@tanstack/ai', (sdk: typeof import('../../server/src/ai/sdk')) => sdk.loadSdk()],
    ['@tanstack/ai-anthropic', (sdk: typeof import('../../server/src/ai/sdk')) => sdk.createAnthropicAdapter('claude-sonnet-5-5', KEY)],
  ])('says to run npm install, and keeps the cause, when %s cannot be loaded', async (name, load) => {
    vi.resetModules();
    vi.doMock(name, () => {
      throw new Error(`Cannot find package '${name}'`);
    });
    const sdk = await import('../../server/src/ai/sdk');
    const failure = await load(sdk).then(
      () => null,
      (error: Error & { cause?: Error }) => error
    );
    expect(failure?.message).toContain(`need ${name}`);
    expect(failure?.message).toContain('run npm install');
    expect(failure?.cause).toBeInstanceOf(Error);
    expect(failure?.message).toContain(`Original error: ${failure?.cause?.message}`);
    vi.doUnmock(name);
    vi.resetModules();
  });
});

describe('status', () => {
  it('is ready, with the model, when the provider is anthropic and there is a key', () => {
    expect(setup().service.status()).toEqual({ ready: true, model: 'claude-sonnet-5-5' });
    expect(setup({ config: { aiProvider: 'anthropic', aiChatModel: 'claude-sonnet-5' } }).service.status()).toEqual({ ready: true, model: 'claude-sonnet-5' });
  });

  it('is not ready without a key, and says what to set', () => {
    expect(setup({ config: { aiApiKey: null } }).service.status()).toEqual({ ready: false, reason: NO_KEY });
  });

  it('is not ready for another provider, even with a key', () => {
    expect(setup({ config: { aiProvider: 'openai' } }).service.status()).toEqual({
      ready: false,
      reason: 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.',
    });
  });

  it('never carries the key', () => {
    for (const config of [{}, { aiApiKey: null }, { aiProvider: 'openai' }]) expect(JSON.stringify(setup({ config }).service.status())).not.toContain(KEY);
  });

  it('is not labelling: the labelling model does not change the chat model', () => {
    expect(setup({ config: { aiModel: 'claude-haiku-4-5-20251001' } }).service.status()).toEqual({ ready: true, model: 'claude-sonnet-5-5' });
  });
});

describe('statusFor', () => {
  const toolsOf = (answer: Doc) => (answer.tools as Doc[]).map((tool) => tool.name);

  it('is the status with the tools the admin gets, each with its name and the label staff read', () => {
    const answer = setup().service.statusFor(everything);
    expect(answer).toMatchObject({ ready: true, model: 'claude-sonnet-5-5' });
    expect(toolsOf(answer)).toEqual([...READ_TOOL_NAMES]);
    expect((answer as Doc).tools[0]).toEqual({ name: 'list_requests', label: 'Visit requests' });
  });

  it('lists the same tools a turn offers the model: the admin\'s permissions and disabledTools both count', () => {
    const only = { can: (action: string) => action === ACTION.catalogRead || action === ACTION.questionsRead };
    const world = setup({ config: { disabledTools: ['view_product'] } });
    expect(toolsOf(world.service.statusFor(only))).toEqual(['list_questions', 'search_knowledge', 'search_products']);
    expect(toolsOf(world.service.statusFor(only))).toEqual(world.service.tools(only).map((tool) => tool.name));
    expect(toolsOf(world.service.statusFor(nothing))).toEqual([]);
  });

  it('is the not-ready status, with no tools, when the assistant is not ready', () => {
    expect(setup({ config: { aiApiKey: null } }).service.statusFor(everything)).toEqual({ ready: false, reason: NO_KEY });
    expect(setup({ config: { aiProvider: 'openai' } }).service.statusFor(everything)).not.toHaveProperty('tools');
  });

  it('never carries the key', () => {
    for (const config of [{}, { aiApiKey: null }, { aiProvider: 'openai' }]) expect(JSON.stringify(setup({ config }).service.statusFor(everything))).not.toContain(KEY);
  });
});

describe('countStaffMessages', () => {
  it('counts the messages staff sent, and not the answers or the tool results', () => {
    const roles = ['user', 'assistant', 'tool', 'user', 'system', 'assistant', 'user', undefined].map((role) => ({ role }));
    expect(countStaffMessages(roles)).toBe(3);
    expect(countStaffMessages([])).toBe(0);
  });
});

describe('tools', () => {
  it('are the read tools the ability allows', () => {
    const { service } = setup();
    expect(service.tools(everything).map((tool) => tool.name)).toEqual([...READ_TOOL_NAMES]);
    expect(service.tools(nothing)).toEqual([]);
    expect(service.tools({ can: (action) => action === ACTION.inquiriesView }).map((tool) => tool.name)).toEqual(['list_inquiries', 'inquiry_counts']);
  });
});

describe('parseBody', () => {
  it('gives the chat parameters of an AG-UI run input', async () => {
    const params = await setup().service.parseBody(bodyOf([staffSays('Hello')]));
    expect(params).toMatchObject({ threadId: 'thread-1', runId: 'run-1', messages: [{ role: 'user', content: 'Hello' }] });
  });

  it('throws with the reason when the body is not one', async () => {
    const { service } = setup();
    await expect(service.parseBody({})).rejects.toThrow(/threadId must be a string/);
    await expect(service.parseBody(null)).rejects.toThrow(/body must be a JSON object/);
    await expect(service.parseBody(bodyOf([{ id: 'x', role: 'wizard', content: 'hi' }]))).rejects.toThrow(/messages\[0\]\.role/);
  });
});

describe('errorResponse', () => {
  it.each([
    ['not_ready', NO_KEY, { aiApiKey: null }],
    ['not_ready', 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.', { aiProvider: 'openai' }],
    ['chat_too_long', CHAT_TOO_LONG_TEXT, {}],
    ['internal', SOMETHING_WRONG_TEXT, {}],
  ] as const)('answers %s with a 200 event stream of one RUN_ERROR in staff words: %s', async (code, message, config) => {
    const response = await setup({ config }).service.errorResponse(code);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = await eventsOf(response);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'RUN_ERROR', code, message });
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  // errorResponse is built by hand, so it works when the SDK cannot be loaded. It must still be what the page's reader
  // expects, which is what toServerSentEventsResponse writes for the one event: the same status, headers and bytes.
  it.each([
    ['not_ready', { aiApiKey: null }],
    ['not_ready', { aiProvider: 'openai' }],
    ['chat_too_long', {}],
    ['internal', {}],
  ] as const)('is the same status, headers and bytes as toServerSentEventsResponse gives for the one %s event: %j', async (code, config) => {
    const timestamp = 1_790_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(timestamp);
    const { service } = setup({ config });
    const staff = (await eventsOf(await service.errorResponse(code)))[0];
    expect(staff).toMatchObject({ type: 'RUN_ERROR', code, timestamp });

    // The event the way the SDK is given it, with the fields it drops from the wire left in.
    const event = { type: 'RUN_ERROR', message: staff.message, code, error: { message: staff.message, code }, timestamp };
    const { toServerSentEventsResponse } = await loadSdk();
    async function* only() {
      yield event;
    }
    const fromSdk = toServerSentEventsResponse(only() as never);
    const byHand = await service.errorResponse(code);

    expect(byHand.status).toBe(fromSdk.status);
    expect(Object.fromEntries(byHand.headers)).toEqual(Object.fromEntries(fromSdk.headers));
    expect(await byHand.text()).toBe(await fromSdk.text());
  });
});

// The SDK ships with the plugin, so a failure to load it means a broken install. Staff still get a plain answer in the
// stream, and the original, with the path it names, goes only to Strapi's log.
describe('when the SDK cannot be loaded', () => {
  const RAW = "Cannot find package '@tanstack/ai' imported from /secret/path/dist/server/index.js";

  afterEach(() => {
    vi.doUnmock('@tanstack/ai');
    vi.resetModules();
  });

  /** The assistant service as a Strapi without @tanstack/ai would run it: fresh modules, whose load of the SDK fails. */
  const withoutSdk = async (config: Doc = {}) => {
    vi.resetModules();
    vi.doMock('@tanstack/ai', () => {
      throw new Error(RAW);
    });
    const { default: freshService } = await import('../../server/src/services/assistant');
    const strapi = fakeStrapi({ config: { aiApiKey: KEY, ...config } });
    return { service: freshService({ strapi }), strapi };
  };
  const params = bodyOf([staffSays('Hi')]) as never;
  const request = () => ({ ability: everything, adminId: 7, responseController: new AbortController(), now: NOW });

  it.each([
    ['not_ready', NO_KEY, { aiApiKey: null }],
    ['chat_too_long', CHAT_TOO_LONG_TEXT, {}],
    ['internal', SOMETHING_WRONG_TEXT, {}],
  ] as const)('answers errorResponse(%s) as a 200 event stream of one RUN_ERROR, without the SDK', async (code, message, config) => {
    const { service } = await withoutSdk(config);
    const response = await service.errorResponse(code);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await eventsOf(response)).toEqual([expect.objectContaining({ type: 'RUN_ERROR', code, message })]);
  });

  it('answers a turn that is not ready with the not_ready RUN_ERROR, and builds no adapter', async () => {
    const { service, strapi } = await withoutSdk({ aiApiKey: null });
    const adapterFor = vi.fn();
    const response = await service.turn(params, { ...request(), adapterFor });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(await eventsOf(new Response(text))).toEqual([expect.objectContaining({ type: 'RUN_ERROR', code: 'not_ready', message: NO_KEY })]);
    expect(text).not.toContain('secret');
    expect(adapterFor).not.toHaveBeenCalled();
    expect(strapi.log.error).not.toHaveBeenCalled();
  });

  it('answers a turn that cannot start with one internal RUN_ERROR in staff words, never the loader text, and logs the original once', async () => {
    const { service, strapi } = await withoutSdk();
    const response = await service.turn(params, request());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(await eventsOf(new Response(text))).toEqual([expect.objectContaining({ type: 'RUN_ERROR', code: 'internal', message: SOMETHING_WRONG_TEXT })]);
    for (const raw of ['secret', 'Cannot find package', 'need @tanstack/ai', 'npm install', '[maison]', KEY]) expect(text, raw).not.toContain(raw);
    // The log has the loader's message, and the plugin's tag once: that message starts with the tag already.
    expect(strapi.log.error).toHaveBeenCalledOnce();
    const line = strapi.log.error.mock.calls[0][0] as string;
    expect(line).toContain('The assistant and inquiry labelling need @tanstack/ai');
    expect(line).toContain('run npm install');
    expect(line.match(/\[maison\]/g)).toHaveLength(1);
  });
});

describe('turn, what the model receives', () => {
  it("is given the instructions with today's date in the plugin's zone, and the staff message", async () => {
    const world = setup({ turns: [textTurn('Hello.')] });
    await run(world, 'Which visits are waiting?');
    const [request] = world.requests;
    const system = JSON.stringify(request.systemPrompts);
    expect(system).toContain('Today is Tuesday 2026-10-06 (Asia/Tokyo).');
    expect(system).toContain(DATA_RULE);
    expect(JSON.stringify(request.messages)).toContain('Which visits are waiting?');
  });

  it("is given the read tools this admin's role allows, each with the data rule", async () => {
    const world = setup({ turns: [textTurn('Hello.')] });
    await run(world, 'Hi', { ability: { can: (action) => action === ACTION.appointmentsReview || action === ACTION.questionsRead } });
    expect(world.requests[0].tools.map((tool: Doc) => tool.name)).toEqual(['list_requests', 'list_questions']);
    for (const tool of world.requests[0].tools) expect(tool.description.endsWith(DATA_RULE), tool.name).toBe(true);
  });

  it('is given no tools, and told so, when the admin may use the assistant but read nothing', async () => {
    const world = setup({ turns: [textTurn('I cannot look anything up with this role.')] });
    const { events } = await run(world, 'Which visits are waiting?', { ability: nothing });
    expect(world.requests[0].tools ?? []).toEqual([]);
    expect(JSON.stringify(world.requests[0].systemPrompts)).toContain('You have no tools. With this role you cannot look anything up.');
    expect(textOf(events)).toBe('I cannot look anything up with this role.');
  });

  it('reads the role again on every turn: a permission lost in the middle of a chat takes its tool away', async () => {
    const world = setup({ turns: [textTurn('First.'), textTurn('Second.')] });
    await run(world, 'First?');
    await run(world, 'Second?', { ability: { can: (action) => action === ACTION.questionsRead } });
    expect(world.requests[0].tools.map((tool: Doc) => tool.name)).toEqual([...READ_TOOL_NAMES]);
    expect(world.requests[1].tools.map((tool: Doc) => tool.name)).toEqual(['list_questions']);
  });

  it('ignores the tools the browser lists: only the server tools are offered', async () => {
    const world = setup({ turns: [textTurn('Hi.')] });
    const forged = { name: 'confirm_appointment', description: 'Confirms a visit.', parameters: { type: 'object', properties: {} } };
    await run(world, 'Hi', {}, { tools: [forged] });
    const names = world.requests[0].tools.map((tool: Doc) => tool.name);
    expect(names).toEqual([...READ_TOOL_NAMES]);
    expect(names).not.toContain('confirm_appointment');
  });

  it('asks for 16,000 output tokens and medium effort, and sets no tool choice', async () => {
    const world = setup({ turns: [textTurn('Hi.')] });
    await run(world);
    expect(world.requests[0].modelOptions).toEqual({ max_tokens: 16_000, output_config: { effort: 'medium' } });
    expect(JSON.stringify(world.requests[0].modelOptions)).not.toContain('tool_choice');
  });

  it('builds the adapter with the chat model and the key, not the labelling model', async () => {
    const world = setup({ turns: [textTurn('Hi.')], config: { aiModel: 'claude-haiku-4-5-20251001' } });
    await run(world);
    expect(world.adapterFor).toHaveBeenCalledExactlyOnceWith('claude-sonnet-5-5', KEY);
    const custom = setup({ turns: [textTurn('Hi.')], config: { aiChatModel: 'claude-sonnet-5' } });
    await run(custom);
    expect(custom.adapterFor).toHaveBeenCalledExactlyOnceWith('claude-sonnet-5', KEY);
  });

  it('keeps the whole history: the staff messages, the answers and what the tools returned', async () => {
    const world = setup({ turns: [textTurn('Third.')] });
    const params = await world.service.parseBody(
      bodyOf([staffSays('First?', 'u1'), { id: 'a1', role: 'assistant', content: 'First answer.' }, staffSays('Second?', 'u2')])
    );
    const response = await world.service.turn(params, { ability: everything, adminId: 7, responseController: new AbortController(), adapterFor: world.adapterFor, now: NOW });
    await response.text();
    const sent = JSON.stringify(world.requests[0].messages);
    for (const part of ['First?', 'First answer.', 'Second?']) expect(sent).toContain(part);
  });

  // An adapter whose call throws is the one case where the SDK writes to the console, and only when its own logging is on
  // (chat() logs the thrown message with console.error and console.dir). That is how a key in the message would bypass
  // withoutKey. A provider error the adapter yields, as errorTurn does, never logs, so it cannot show the logging is off.
  it('does not write to the console when the adapter throws: the SDK logging is off, so the key reaches only the filtered log line', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'dir'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    const adapter = {
      kind: 'text',
      name: 'broken',
      model: 'm',
      async *chatStream() {
        throw new Error(`connection reset while sending ${KEY}`);
      },
      async structuredOutput() {
        throw new Error('none');
      },
    };
    const world = setup();
    const { events } = await run(world, 'Hi', { adapterFor: () => adapter as never });
    expect(errorsOf(events)).toHaveLength(1);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    // The one place the original goes: Strapi's log, with the key taken out.
    expect(world.strapi.log.error).toHaveBeenCalledOnce();
    const line = world.strapi.log.error.mock.calls[0][0] as string;
    expect(line).toContain('connection reset while sending [key]');
    expect(line).not.toContain(KEY);
  });
});

describe('turn, a run', () => {
  const inquiryRow = (documentId: string): Doc => ({
    documentId, createdAt: '2026-10-05T16:30:00.000Z', customer: 'line:Uab1…12', message: 'The strap came loose.', reply: 'I am sorry.', language: 'en', product: null,
    knowledgeFound: false, handedOff: false, question: null, kind: 'complaint', sentimentScore: -0.7, sentimentLabel: 'negative', answered: false,
    reason: 'A strap failed.', topic: 'repairs', analysisStatus: 'analyzed', analysisAttempts: 1, humanCorrected: false, queue: 'complaint', status: 'open',
    closeReason: null, replyText: null, repliedAt: null, repliedBy: null, line: null,
  });

  it('runs a list_inquiries call and gives the result to a second model turn, which answers', async () => {
    const list = vi.fn(async () => ({ ok: true, value: [inquiryRow('k1'), inquiryRow('k2')] }));
    const world = setup({
      turns: [toolCallTurn('list_inquiries', { filter: 'all', kind: 'complaint', since: '2026-10-06' }), textTurn('Two complaints today.')],
      services: { inquiries: { list } },
    });
    const { events } = await run(world, 'Any complaints this week?');

    expect(list).toHaveBeenCalledExactlyOnceWith({ filter: 'all', kind: 'complaint', since: '2026-10-06', limit: 51 });
    expect(world.requests).toHaveLength(2);
    expect(typesOf(events)).toContain('TOOL_CALL_START');
    expect(events.find((event) => event.type === 'TOOL_CALL_START')).toMatchObject({ toolCallName: 'list_inquiries' });
    expect(textOf(events)).toBe('Two complaints today.');
    expect(errorsOf(events)).toEqual([]);
    expect(customOf(events)).toEqual([]);
    // The second turn read the tool's answer: the model's view of both rows, in its tags.
    const second = JSON.stringify(world.requests[1].messages);
    expect(second).toContain('k1');
    expect(second).toContain('k2');
    expect(second).toContain('<customer_message>The strap came loose.</customer_message>');
    expect(second).not.toContain('sentimentScore');
  });

  it('gives a tool failure to the model as its result, and goes on', async () => {
    const list = vi.fn(async () => ({ ok: false, code: 'invalid_input', message: 'Unknown kind "rant".', hint: 'Use one of question, complaint, praise, other.' }));
    const world = setup({ turns: [toolCallTurn('list_inquiries', {}), textTurn('That lookup failed.')], services: { inquiries: { list } } });
    const { events } = await run(world);
    expect(errorsOf(events)).toEqual([]);
    expect(JSON.stringify(world.requests[1].messages)).toContain('Unknown kind');
    expect(textOf(events)).toBe('That lookup failed.');
  });

  it('gives a lookup that finds nothing to the model as not_found, never an empty list', async () => {
    const listRequests = vi.fn(async () => ({ ok: true, value: [] }));
    const world = setup({ turns: [toolCallTurn('list_requests', { reference: 'APT-4812' }), textTurn('There is no request APT-4812.')], services: { appointments: { listRequests } } });
    await run(world, 'Tell me about request APT-4812.');
    const answer = JSON.stringify(world.requests[1].messages);
    expect(answer).toContain('not_found');
    expect(answer).toContain('No request APT-4812.');
  });

  it('ends a run that spends its six model turns on tool calls with the max_turns event, and calls the model six times', async () => {
    const summary = vi.fn(async () => ({ needsAnswer: 1, complaint: 0, praise: 0, notLabelled: 0 }));
    const turns = Array.from({ length: 7 }, () => toolCallTurn('inquiry_counts', {}));
    const world = setup({ turns, services: { inquiries: { summary } } });
    const { events } = await run(world);
    expect(world.requests).toHaveLength(6);
    expect(customOf(events)).toEqual(['max_turns']);
    expect(errorsOf(events)).toEqual([]);
    expect(typesOf(events).at(-1)).toBe('CUSTOM');
  });

  it('ends a turn that finishes with stop, no text and no tool call, with the declined event', async () => {
    const { events } = await run(setup({ turns: [stopTurn()] }));
    expect(customOf(events)).toEqual(['declined']);
    expect(errorsOf(events)).toEqual([]);
  });

  it('writes one log line for the turn: the admin, the tools called and the time, and nothing the customer wrote', async () => {
    const summary = vi.fn(async () => ({ needsAnswer: 1, complaint: 0, praise: 0, notLabelled: 0 }));
    const world = setup({ turns: [toolCallTurn('inquiry_counts', {}), textTurn('One needs an answer.')], services: { inquiries: { summary } } });
    await run(world, 'How many inquiries need an answer? My name is Secret Customer.');
    expect(world.strapi.log.info).toHaveBeenCalledOnce();
    const line = world.strapi.log.info.mock.calls[0][0] as string;
    expect(line).toMatch(/^\[maison\] Assistant turn for admin 7: tools inquiry_counts, \d+ ms\.$/);
    expect(line).not.toContain('Secret Customer');
    expect(world.strapi.log.error).not.toHaveBeenCalled();
  });
});

describe('turn, errors', () => {
  it('turns an error from the provider into staff text, in the stream, and never lets the provider text through', async () => {
    const world = setup({ turns: [errorTurn('401', `401 {"error":{"message":"invalid x-api-key ${KEY}"},"request_id":"req_abc"}`)] });
    const { response, events } = await run(world);
    expect(response.status).toBe(200);
    expect(errorsOf(events)).toHaveLength(1);
    expect(errorsOf(events)[0]).toMatchObject({ message: 'Anthropic refused the key. Check AI_API_KEY.', code: '401' });
    expect(errorsOf(events)[0]).not.toHaveProperty('rawEvent');
    const wire = JSON.stringify(events);
    for (const leaked of [KEY, 'req_abc', 'invalid x-api-key']) expect(wire).not.toContain(leaked);
  });

  it('names the configured model when Anthropic does not know it', async () => {
    const world = setup({ turns: [errorTurn('404', '404 model: claude-nope')], config: { aiChatModel: 'claude-nope' } });
    const { events } = await run(world);
    expect(errorsOf(events)[0].message).toBe("Anthropic doesn't know the model claude-nope. Check AI_CHAT_MODEL.");
  });

  it('logs the original once, with the key taken out', async () => {
    const world = setup({ turns: [errorTurn('401', `401 invalid x-api-key ${KEY}`)] });
    await run(world);
    expect(world.strapi.log.error).toHaveBeenCalledOnce();
    const line = world.strapi.log.error.mock.calls[0][0] as string;
    expect(line).toContain('401');
    expect(line).toContain('invalid x-api-key [key]');
    expect(line).not.toContain(KEY);
  });

  it('answers an adapter that throws with the general text, and never what it threw', async () => {
    const world = setup();
    const adapter = {
      kind: 'text',
      name: 'broken',
      model: 'm',
      async *chatStream() {
        throw new Error(`connection reset while sending ${KEY}`);
      },
      async structuredOutput() {
        throw new Error('none');
      },
    };
    const { events } = await run(world, 'Hi', { adapterFor: () => adapter as never });
    expect(errorsOf(events)).toHaveLength(1);
    expect(errorsOf(events)[0].message).toBe(SOMETHING_WRONG_TEXT);
    expect(JSON.stringify(events)).not.toContain('connection reset');
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it('answers a failure in setting up with one internal RUN_ERROR, and logs it without the key', async () => {
    const world = setup();
    const { response, events } = await run(world, 'Hi', {
      adapterFor: () => {
        throw new Error(`could not build the adapter for ${KEY}`);
      },
    });
    expect(response.status).toBe(200);
    expect(errorsOf(events)).toHaveLength(1);
    expect(errorsOf(events)[0]).toMatchObject({ code: 'internal', message: SOMETHING_WRONG_TEXT });
    expect(world.strapi.log.error).toHaveBeenCalledOnce();
    expect(world.strapi.log.error.mock.calls[0][0]).toContain('[key]');
    expect(world.strapi.log.error.mock.calls[0][0]).not.toContain(KEY);
  });

  it('answers not_ready with the reason when there is no key or the provider is another, and builds no adapter', async () => {
    for (const [config, reason] of [
      [{ aiApiKey: null }, NO_KEY],
      [{ aiProvider: 'openai' }, 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.'],
    ] as const) {
      const world = setup({ config, turns: [textTurn('Hi.')] });
      const { events } = await run(world);
      expect(errorsOf(events)).toEqual([expect.objectContaining({ code: 'not_ready', message: reason })]);
      expect(world.adapterFor).not.toHaveBeenCalled();
    }
  });
});

// A service that throws (a locked database, a lost connection) must not put its text in front of the model or in the stream.
// Without a guard, @tanstack/ai hands the model "Error executing tool: <the message>" and sends the same text in TOOL_CALL_RESULT.
describe('turn, a tool whose service throws', () => {
  const TOOL_FAILED = {
    code: 'tool_failed',
    message: 'Maison could not read that just now.',
    hint: 'Tell staff the lookup failed and suggest trying again. Do not guess the answer.',
  };

  const throwing = (thrown: unknown = new Error('SQLITE_BUSY: secret detail')) =>
    vi.fn(async () => {
      throw thrown;
    });
  /** What the page reads as the tool's answer: the TOOL_CALL_RESULT event, whose content is the JSON the model got. */
  const toolResultOf = (events: Doc[]) => events.filter((event) => event.type === 'TOOL_CALL_RESULT');
  const leaks = ['SQLITE_BUSY', 'secret detail', 'Error executing tool'];

  it('gives the model the fixed tool_failed error, and puts nothing the service threw in the stream', async () => {
    const summary = throwing();
    const world = setup({ turns: [toolCallTurn('inquiry_counts', {}), textTurn('That lookup failed. Please try again.')], services: { inquiries: { summary } } });
    const { events } = await run(world, 'How many inquiries need an answer?');

    expect(summary).toHaveBeenCalledOnce();
    const results = toolResultOf(events);
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].content)).toEqual({ error: TOOL_FAILED });

    const wire = JSON.stringify(events);
    expect(wire).toContain(TOOL_FAILED.message);
    for (const leaked of leaks) expect(wire, leaked).not.toContain(leaked);
    // No chunk is marked as a failed execution either: that state is how @tanstack/ai reports the raw throw.
    expect(wire).not.toContain('output-error');
  });

  it('gives the model the same error in its second turn, and the run ends with its answer, not an error', async () => {
    const world = setup({
      turns: [toolCallTurn('inquiry_counts', {}), textTurn('That lookup failed. Please try again.')],
      services: { inquiries: { summary: throwing() } },
    });
    const { events } = await run(world);
    expect(world.requests).toHaveLength(2);
    const second = JSON.stringify(world.requests[1].messages);
    expect(second).toContain(TOOL_FAILED.message);
    expect(second).toContain('Do not guess the answer.');
    for (const leaked of leaks) expect(second, leaked).not.toContain(leaked);
    expect(errorsOf(events)).toEqual([]);
    expect(textOf(events)).toBe('That lookup failed. Please try again.');
  });

  it('logs the failure once, with the tool and the original message', async () => {
    const world = setup({ turns: [toolCallTurn('inquiry_counts', {}), textTurn('Sorry.')], services: { inquiries: { summary: throwing() } } });
    await run(world);
    expect(world.strapi.log.error).toHaveBeenCalledExactlyOnceWith('[maison] assistant tool inquiry_counts failed: SQLITE_BUSY: secret detail');
  });

  it('takes the key out of the logged line', async () => {
    const world = setup({
      turns: [toolCallTurn('inquiry_counts', {}), textTurn('Sorry.')],
      services: { inquiries: { summary: throwing(new Error(`connection refused for ${KEY}`)) } },
    });
    await run(world);
    const line = world.strapi.log.error.mock.calls[0][0] as string;
    expect(line).toContain('[key]');
    expect(line).not.toContain(KEY);
  });

  it('guards a catalog tool too, and a throw that is not an Error', async () => {
    const world = setup({
      turns: [toolCallTurn('search_products', {}), textTurn('Sorry.')],
      services: { catalog: { searchProducts: throwing('plain text from a driver') } },
    });
    const { events } = await run(world, 'Find me a bag.');
    expect(toolResultOf(events).map((event) => JSON.parse(event.content))).toEqual([{ error: TOOL_FAILED }]);
    expect(JSON.stringify(events)).not.toContain('plain text from a driver');
    expect(world.strapi.log.error).toHaveBeenCalledExactlyOnceWith('[maison] assistant tool search_products failed: plain text from a driver');
  });

  it('leaves what a tool returns as it is, and logs nothing', async () => {
    const summary = vi.fn(async () => ({ needsAnswer: 2, complaint: 1, praise: 0, notLabelled: 0 }));
    const world = setup({ turns: [toolCallTurn('inquiry_counts', {}), textTurn('Two need an answer.')], services: { inquiries: { summary } } });
    const { events } = await run(world);
    expect(toolResultOf(events).map((event) => JSON.parse(event.content))).toEqual([{ needsAnswer: 2, complaint: 1, praise: 0, notLabelled: 0 }]);
    expect(world.strapi.log.error).not.toHaveBeenCalled();
  });
});

describe('turn, the deadline and aborts', () => {
  it('ends a model call that hangs with the timeout error, and stops the model call after it', async () => {
    const world = setup({ turns: ['never'] });
    const { events } = await run(world, 'Hi', { deadlineMs: 50 });
    expect(errorsOf(events)).toEqual([expect.objectContaining({ code: 'timeout', message: 'The assistant took too long and stopped. Try again.' })]);
    expect(world.requests[0].request.signal.aborted).toBe(true);
  });

  it('stops the model call when the response closes before it ends: a closed tab, or Stop', async () => {
    const world = setup({ turns: ['never'] });
    const params = await world.service.parseBody(bodyOf([staffSays('Hi')]));
    const responseController = new AbortController();
    const response = await world.service.turn(params, { ability: everything, adminId: 7, responseController, adapterFor: world.adapterFor, now: NOW });
    const reading = response.text();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(world.requests[0].request.signal.aborted).toBe(false);
    responseController.abort();
    expect(world.requests[0].request.signal.aborted).toBe(true);
    await reading;
  });

  // The test above aborts the controller itself, so it shows the wrapper hears it. A closed tab does not abort it by hand:
  // it cancels the response body, and toServerSentEventsResponse aborts the controller it was given. This holds that link.
  it('stops the model call when the response body is cancelled: the browser closed the connection', async () => {
    const world = setup({ turns: [toolCallTurn('inquiry_counts', {}), 'never'], services: { inquiries: { summary: vi.fn(async () => ({ needsAnswer: 1, complaint: 0, praise: 0, notLabelled: 0 })) } } });
    const params = await world.service.parseBody(bodyOf([staffSays('Hi')]));
    const responseController = new AbortController();
    // A short deadline, so a missing link ends this test's model call soon instead of leaving it for 90 seconds.
    const response = await world.service.turn(params, { ability: everything, adminId: 7, responseController, adapterFor: world.adapterFor, now: NOW, deadlineMs: 3_000 });

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    // TanStack AI 0.68 pulls the stream only as fast as the reader reads it, so the second model call starts after the reader has
    // read the first call's events. The second model call then hangs, as a model call does that the provider never answers.
    for (let reads = 0; world.requests.length < 2 && reads < 100; reads += 1) {
      const next = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))]);
      if (next === null || next.done) break;
    }
    expect(world.requests).toHaveLength(2);
    const modelCall: AbortSignal = world.requests[1].request.signal;
    expect(modelCall.aborted).toBe(false);
    expect(responseController.signal.aborted).toBe(false);

    const cancelled = reader.cancel();
    await vi.waitFor(() => expect(modelCall.aborted).toBe(true), { timeout: 500 });
    expect(responseController.signal.aborted).toBe(true);
    await cancelled;
  });
});

// The data the model must never get: a customer's full LINE user ID, and the LINE name they signed in with.
describe('privacy', () => {
  const FULL = (character: string) => `line:U${character.repeat(32)}`;
  const NAMES = ['Aiko T.', 'Kenji M.', 'Sophie L.', 'Daniel R.', 'Mei W.'];

  /** A table the way the Document Service holds one: findMany and count filter it. */
  const table = (rows: Doc[]) => ({
    findMany: async ({ filters }: Doc) => rows.filter((row) => matches(row, filters)).map((row) => ({ ...row })),
    findOne: async ({ documentId }: Doc) => rows.find((row) => row.documentId === documentId) ?? null,
    count: async ({ filters }: Doc) => rows.filter((row) => matches(row, filters)).length,
  });

  const inquiryRows: Doc[] = [
    {
      documentId: 'inq-1', customer: FULL('a'), message: 'The clasp of my coffret broke.', reply: 'I am sorry.', language: 'en', knowledgeFound: false, handedOff: true,
      questionReference: 'Q-1001', productSlug: null, kind: 'complaint', sentimentScore: -0.7, sentimentLabel: 'negative', answered: false, reason: 'A clasp broke.', topic: 'repairs',
      analysisStatus: 'analyzed', analysisAttempts: 1, humanCorrected: false, queue: 'complaint', status: 'replied', closeReason: null, replyText: 'We will repair it.',
      repliedAt: '2026-10-05T10:00:00.000Z', repliedBy: 'Sophie L.', lineOutcome: 'sent', lineDetail: '', createdAt: '2026-10-05T01:12:00.000Z',
    },
  ];
  const questionRows: Doc[] = [
    {
      documentId: 'q-1', reference: 'Q-1001', customer: FULL('b'), customerName: 'Aiko T.', question: 'Can the coffret hold a watch?', reason: 'no_answer', language: 'en',
      productSlug: null, status: 'answered', staffName: 'Daniel R.', answer: 'Yes, up to 42 mm. Thank you, Mei W.', knowledgeDocumentId: null, lineOutcome: 'sent', lineDetail: '',
      createdAt: '2026-10-05T01:00:00.000Z',
    },
    {
      documentId: 'q-2', reference: 'Q-1002', customer: FULL('c'), customerName: 'Kenji M.', question: 'Do you deliver to Osaka?', reason: 'asked_for_person', language: 'en',
      productSlug: null, status: 'open', staffName: null, answer: null, knowledgeDocumentId: null, lineOutcome: null, lineDetail: null, createdAt: '2026-10-05T02:00:00.000Z',
    },
  ];
  const appointmentRows: Doc[] = [
    {
      documentId: 'apt-1', reference: 'APT-1001', customer: FULL('d'), requestedFor: '2026-10-10T05:00:00.000Z', customerNote: 'A gift for my father.', createdVia: 'concierge',
      createdAt: '2026-10-05T03:00:00.000Z', boutique: { documentId: 'b-ginza' }, products: [{ documentId: 'p-weekender' }],
    },
  ];

  /** The three real services, over a fake Document Service that holds full subjects and LINE names. */
  const demoServices = () => {
    const labelOf = (name: string) => async ({ filters }: Doc) => (filters.documentId.$in as string[]).map((documentId) => ({ documentId, slug: name.toLowerCase(), name }));
    const documents = (uid: string) => {
      if (uid === UID.inquiry) return table(inquiryRows);
      if (uid === UID.question) return table(questionRows);
      if (uid === UID.appointment) return { findMany: async (query: Doc) => (query.status === 'published' ? [] : appointmentRows.map((row) => ({ ...row }))) };
      if (uid === UID.notification) return { findMany: async () => [] };
      if (uid === UID.boutique) return { findMany: labelOf('Ginza Flagship') };
      if (uid === UID.product) return { findMany: labelOf('Weekender 50'), findFirst: async () => null };
      throw new Error(`These tests have no ${uid}.`);
    };
    const base = fakeStrapi({ documents });
    return { appointments: appointments({ strapi: base }), questions: questions({ strapi: base }), inquiries: inquiries({ strapi: base }) };
  };

  it('sends the model no full LINE user ID and no LINE name: not in the instructions, the messages or any tool result', async () => {
    const world = setup({
      turns: [
        toolCallTurn('list_requests', { status: 'all' }),
        toolCallTurn('list_questions', { status: 'all' }),
        toolCallTurn('list_inquiries', { filter: 'all' }),
        toolCallTurn('list_questions', { reference: 'Q-1001' }),
        textTurn('Done.'),
      ],
      services: demoServices(),
    });
    const { events } = await run(world, 'Show me everything.');
    expect(errorsOf(events)).toEqual([]);
    expect(world.requests).toHaveLength(5);

    // Everything the fake adapter received, as the model would read it.
    const received = world.requests.map((request) => JSON.stringify({ system: request.systemPrompts, messages: request.messages, tools: request.tools?.map((tool: Doc) => [tool.name, tool.description]) })).join('\n');

    // The scan has something to find: the rows were read, and the customers are there, masked.
    expect(received).toContain('line:Uaaa…aa');
    expect(received).toContain('line:Ubbb…bb');
    expect(received).toContain('APT-1001');
    expect(received).toContain('Q-1002');
    expect(received).not.toMatch(/U[0-9a-f]{32}/);
    for (const name of NAMES.slice(0, 4)) expect(received, name).not.toContain(name);
    // A name inside a staff answer is not a LINE name, and a staff answer is never sent either.
    expect(received).not.toContain('Thank you, Mei W.');
    expect(received).not.toContain('We will repair it.');
  });
});
