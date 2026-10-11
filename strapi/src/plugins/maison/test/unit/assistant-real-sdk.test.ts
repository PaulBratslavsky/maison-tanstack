import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicAdapter, loadSdk } from '../../server/src/ai/sdk';
import assistantService, { type AdapterFor } from '../../server/src/services/assistant';
import { fakeTextAdapter, textTurn, toolCallTurn, type ScriptedTurn } from './fake-text-adapter';
import { fakeStrapi } from './fake-strapi';

/**
 * Checks of what TanStack AI 0.68 really does, on the real `chat()`, the real wire encoder and the real Anthropic adapter. Nothing here
 * reaches Anthropic: the adapter's fetch is replaced by a function that answers from a script, and a fake adapter stands in elsewhere.
 */

type Doc = Record<string, any>;

const KEY = 'sk-ant-api03-TEST-KEY-123';
const NOW = new Date('2026-10-05T16:30:00.000Z');
const everything = { can: () => true };

const eventsOf = async (response: Response): Promise<Doc[]> =>
  (await response.text())
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)));

const setup = (turns: ScriptedTurn[] = [], services: Record<string, unknown> = {}) => {
  const fake = fakeTextAdapter(turns);
  const strapi = fakeStrapi({ services, config: { aiApiKey: KEY } });
  const adapterFor = vi.fn<AdapterFor>(() => fake.adapter);
  return { service: assistantService({ strapi }), strapi, adapterFor, ...fake };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the history the page sends back', () => {
  it('reaches the model whole: a thinking block with its signature, and each tool call with its result', async () => {
    const { uiMessagesToWire } = await loadSdk();
    // The page's own messages, as `useChat` holds them after an answer that used a tool.
    const ui = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', content: 'Which visits wait?' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'thinking', content: 'I should look.', signature: 'SIGNED-BLOCK' },
          { type: 'tool-call', id: 'call-1', name: 'list_requests', arguments: '{"status":"requested"}', state: 'input-complete', output: { requests: [], capped: false } },
          { type: 'tool-result', toolCallId: 'call-1', content: '{"requests":[],"capped":false}', state: 'complete' },
          { type: 'text', content: 'None wait.' },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', content: 'And questions?' }] },
    ];
    const body = JSON.parse(JSON.stringify({ threadId: 't', runId: 'r', messages: uiMessagesToWire(ui as never), tools: [], context: [], forwardedProps: {} }));

    const world = setup([textTurn('Two are open.')]);
    const params = await world.service.parseBody(body);
    // chatParamsFromRequestBody drops `parts`, and nothing in the server reads them: chat() takes the wire messages as they are.
    expect(params.messages.some((message) => 'parts' in message)).toBe(false);
    const response = await world.service.turn(params, { ability: everything, adminId: 7, responseController: new AbortController(), adapterFor: world.adapterFor, now: NOW });
    await response.text();

    const sent = world.requests[0].messages as Doc[];
    const assistant = sent.find((message) => message.role === 'assistant')!;
    expect(assistant.thinking).toEqual([{ content: 'I should look.', signature: 'SIGNED-BLOCK' }]);
    expect(assistant.toolCalls).toEqual([expect.objectContaining({ id: 'call-1', function: { name: 'list_requests', arguments: '{"status":"requested"}' } })]);
    expect(sent.find((message) => message.role === 'tool')).toMatchObject({ toolCallId: 'call-1', content: '{"requests":[],"capped":false}' });
    expect(sent.at(-1)).toMatchObject({ role: 'user', content: 'And questions?' });
  });

  it('passes the thread and run IDs on, so the page can follow the run', async () => {
    const world = setup([textTurn('Hi.')]);
    const params = await world.service.parseBody({ threadId: 'thread-9', runId: 'run-9', messages: [{ id: 'u', role: 'user', content: 'Hi' }], tools: [], context: [] });
    const response = await world.service.turn(params, { ability: everything, adminId: 7, responseController: new AbortController(), adapterFor: world.adapterFor, now: NOW });
    const events = await eventsOf(response);
    expect(world.requests[0]).toMatchObject({ threadId: 'thread-9', runId: 'run-9' });
    expect(events.find((event) => event.type === 'RUN_STARTED')).toMatchObject({ threadId: 'thread-9', runId: 'run-9' });
    expect(events.find((event) => event.type === 'RUN_FINISHED')).toMatchObject({ threadId: 'thread-9', runId: 'run-9' });
  });
});

describe('a tool call with input the schema refuses', () => {
  it('is answered by the SDK with an error result, never reaches the service, and the model goes on', async () => {
    const listRequests = vi.fn(async () => ({ ok: true, value: [] }));
    const world = setup([toolCallTurn('list_requests', { status: 'archived' }), textTurn('I could not look that up.')], { appointments: { listRequests } });
    const params = await world.service.parseBody({ threadId: 't', runId: 'r', messages: [{ id: 'u', role: 'user', content: 'Archived visits?' }], tools: [], context: [] });
    const response = await world.service.turn(params, { ability: everything, adminId: 7, responseController: new AbortController(), adapterFor: world.adapterFor, now: NOW });
    const events = await eventsOf(response);

    expect(listRequests).not.toHaveBeenCalled();
    const result = events.find((event) => event.type === 'TOOL_CALL_RESULT')!;
    expect(JSON.parse(result.content).error).toMatch(/Input validation failed for tool list_requests/);
    expect(world.requests).toHaveLength(2);
    expect(JSON.stringify(world.requests[1].messages)).toContain('Input validation failed');
    expect(events.filter((event) => event.type === 'RUN_ERROR')).toEqual([]);
  });
});

describe('an error event with every field the Anthropic adapter can add', () => {
  it('reaches the page as the staff text, the code and the run ids, and nothing the provider wrote', async () => {
    const turn: ScriptedTurn = [
      { type: 'RUN_STARTED' },
      {
        type: 'RUN_ERROR',
        message: `429 {"error":{"message":"rate limit for ${KEY}"},"request_id":"req_SECRET"}`,
        code: '429',
        retryAfterMs: 30_000,
        usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 },
        rawEvent: { type: 'error', error: { type: 'rate_limit_error', message: 'SECRET-body' } },
        metadata: { tanstack: { detail: 'SECRET-metadata' } },
        error: { message: 'SECRET-error', code: '429', type: 'rate_limit_error', request_id: 'req_SECRET' },
      },
    ];
    const world = setup([turn]);
    const params = await world.service.parseBody({ threadId: 't', runId: 'r', messages: [{ id: 'u', role: 'user', content: 'Hi' }], tools: [], context: [] });
    const response = await world.service.turn(params, { ability: everything, adminId: 7, responseController: new AbortController(), adapterFor: world.adapterFor, now: NOW });
    const text = await response.text();
    const [error] = (await eventsOf(new Response(text))).filter((event) => event.type === 'RUN_ERROR');

    expect(error).toMatchObject({ code: '429', message: 'Anthropic is busy. Try again in a minute.' });
    expect(Object.keys(error).sort()).toEqual(['code', 'message', 'metadata', 'timestamp', 'type']);
    for (const leaked of [KEY, 'SECRET', 'req_', 'rate limit', 'retryAfterMs', 'rawEvent']) expect(text, leaked).not.toContain(leaked);
  });
});

describe('the real Anthropic adapter, with its fetch answered by a script', () => {
  /** What Anthropic's streaming Messages API sends for one short text answer. */
  const messagesStream = (text: string, stopReason = 'end_turn') =>
    [
      ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }],
      ['message_stop', { type: 'message_stop' }],
    ]
      .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
      .join('');

  const stubFetch = (answer: () => Response) => {
    const calls: Array<{ url: string; init: RequestInit & { headers: Headers | Record<string, string> } }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init: any) => {
        calls.push({ url: String(url instanceof Request ? url.url : url), init });
        return answer();
      })
    );
    return calls;
  };
  const sse = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });

  const turnWithRealAdapter = async (answer: () => Response, config: Doc = {}) => {
    const calls = stubFetch(answer);
    const strapi = fakeStrapi({ config: { aiApiKey: KEY, ...config } });
    const service = assistantService({ strapi });
    const params = await service.parseBody({ threadId: 't', runId: 'r', messages: [{ id: 'u', role: 'user', content: 'Which visits wait?' }], tools: [], context: [] });
    const response = await service.turn(params, { ability: everything, adminId: 7, responseController: new AbortController(), adapterFor: createAnthropicAdapter, now: NOW });
    return { calls, strapi, events: await eventsOf(response) };
  };

  it('sends the chat model, 16,000 output tokens, medium effort, the instructions and the read tools, and only to the Messages API', async () => {
    const { calls, events } = await turnWithRealAdapter(() => sse(messagesStream('None wait.')));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 16_000, stream: true, output_config: { effort: 'medium' } });
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('temperature');
    expect(JSON.stringify(body.system)).toContain('You are the Maison assistant.');
    expect(body.tools.map((tool: Doc) => tool.name)).toEqual(['list_requests', 'list_questions', 'list_inquiries', 'inquiry_counts', 'search_knowledge', 'search_products', 'view_product']);
    // The input schemas reach the model as JSON Schema.
    expect(body.tools[0].input_schema).toMatchObject({ type: 'object', properties: { status: { enum: ['requested', 'confirmed', 'all'] } } });
    expect(events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').map((event) => event.delta).join('')).toBe('None wait.');
    expect(events.filter((event) => event.type === 'RUN_ERROR')).toEqual([]);
  });

  it('sends the key as the API key header and nowhere else', async () => {
    const { calls } = await turnWithRealAdapter(() => sse(messagesStream('Hi.')));
    const headers = new Headers(calls[0].init.headers as Headers);
    expect(headers.get('x-api-key')).toBe(KEY);
    expect(String(calls[0].init.body)).not.toContain(KEY);
    expect(calls[0].url).not.toContain(KEY);
  });

  it('turns an Anthropic 401 into the staff text, and keeps the key out of the page and the log', async () => {
    const { events, strapi } = await turnWithRealAdapter(
      () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` }, request_id: 'req_SECRET' }), {
          status: 401,
          headers: { 'content-type': 'application/json', 'request-id': 'req_SECRET' },
        })
    );
    const errors = events.filter((event) => event.type === 'RUN_ERROR');
    expect(errors).toEqual([expect.objectContaining({ code: '401', message: 'Anthropic refused the key. Check AI_API_KEY.' })]);
    expect(JSON.stringify(events)).not.toMatch(/SECRET|invalid x-api-key|sk-ant/);
    expect(strapi.log.error).toHaveBeenCalledOnce();
    expect(strapi.log.error.mock.calls[0][0]).not.toContain(KEY);
  });

  it('turns an Anthropic 404 into the staff text that names the model', async () => {
    const { events } = await turnWithRealAdapter(
      () => new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-nope' } }), { status: 404, headers: { 'content-type': 'application/json' } }),
      { aiChatModel: 'claude-nope' }
    );
    expect(events.filter((event) => event.type === 'RUN_ERROR')).toEqual([
      expect.objectContaining({ code: '404', message: "Anthropic doesn't know the model claude-nope. Check AI_CHAT_MODEL." }),
    ]);
  });

  it.each([
    [429, 'rate_limit_error'],
    [529, 'overloaded_error'],
  ])('turns an Anthropic %i into the busy text', async (status, type) => {
    const { events } = await turnWithRealAdapter(
      () => new Response(JSON.stringify({ type: 'error', error: { type, message: 'busy' } }), { status, headers: { 'content-type': 'application/json', 'retry-after': '1' } })
    );
    expect(events.filter((event) => event.type === 'RUN_ERROR')).toEqual([expect.objectContaining({ code: String(status), message: 'Anthropic is busy. Try again in a minute.' })]);
  });

  it('turns an answer cut off at the token limit into the max_tokens text', async () => {
    const { events } = await turnWithRealAdapter(() => sse(messagesStream('A long ans', 'max_tokens')));
    expect(events.filter((event) => event.type === 'RUN_ERROR')).toEqual([
      expect.objectContaining({ code: 'max_tokens', message: 'The answer was cut off because it was too long. Ask for less.' }),
    ]);
  });
});
