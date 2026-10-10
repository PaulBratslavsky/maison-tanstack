import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UID } from '../../server/src/constants';
import { labelSystemPrompt, labelsSchema } from '../../server/src/domain/inquiry-criteria';
import labelling from '../../server/src/services/labelling';
import { fakeStrapi } from './fake-strapi';

/*
 * The real adapters, @tanstack/ai-anthropic and @tanstack/ai-ollama, and the real chat(), with the only fetch they can use: a
 * stand-in that keeps each request and answers like the provider's API. Nothing here reaches a network. The unit tests of the
 * service use a scripted adapter, so these are what show that the real adapters send what the service means them to, and fail
 * the way the service's rules for a failure expect.
 */

type Doc = Record<string, any>;
type Sent = { url: string; headers: Record<string, string>; body: Doc };

const KEY = 'sk-ant-test-0123456789';
const EXCHANGE = { message: 'The strap on my bag broke after a week.', reply: 'I am sorry to hear that.', knowledgeFound: false, handedOff: false };
const LABELS = { kind: 'complaint', sentimentScore: -0.6, sentimentLabel: 'negative', answered: true, reason: 'The strap broke.', topic: 'repairs' };
const OLLAMA = 'http://127.0.0.1:11434';

const sent: Sent[] = [];
/** What the stand-in answers, when a test sets it, instead of the labels: the provider's failures as the adapters meet them. */
let failing: undefined | ((request: Sent) => Response | Promise<Response>);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The Messages API answering a forced tool call with these labels. */
const anthropicAnswer = (labels: unknown) =>
  json({
    id: 'msg_stand_in',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'tool_use', id: 'toolu_stand_in', name: 'structured_output', input: labels }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

/** Ollama's chat route answering with this text as the assistant's message. */
const ollamaAnswer = (text: string) =>
  json({ model: 'qwen3-14b-32k', created_at: '2026-10-10T00:00:00Z', message: { role: 'assistant', content: text }, done: true, done_reason: 'stop' });

const headersOf = (init: RequestInit | undefined): Record<string, string> => {
  const found: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, name) => (found[name] = value));
  return found;
};

beforeEach(() => {
  sent.length = 0;
  failing = undefined;
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    const request: Sent = { url: String(url), headers: headersOf(init), body: JSON.parse(String(init?.body ?? 'null')) };
    sent.push(request);
    if (failing) return failing(request);
    return request.url.includes('/api/chat') ? ollamaAnswer(JSON.stringify(LABELS)) : anthropicAnswer(LABELS);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const service = (config: Doc, documents?: (uid: string) => Record<string, (...args: any[]) => unknown>) => labelling({ strapi: fakeStrapi({ config, documents }) });
const ANTHROPIC = { aiProvider: 'anthropic', aiApiKey: KEY };
const OLLAMA_ON = { aiProvider: 'ollama', aiBaseUrl: OLLAMA };

describe('what labelling sends to Anthropic', () => {
  const labelled = async (config: Doc = ANTHROPIC) => {
    const labels = await service(config).label(EXCHANGE);
    expect(sent).toHaveLength(1);
    return { labels, request: sent[0] };
  };

  it('is one request to the Messages API, with the configured key, for the default model, and its answer is the labels', async () => {
    const { labels, request } = await labelled();

    expect(labels).toEqual(LABELS);
    expect(request.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(request.headers['x-api-key']).toBe(KEY);
    expect(request.body.model).toBe('claude-haiku-4-5-20251001');
    expect(request.body.system).toEqual([{ type: 'text', text: labelSystemPrompt() }]);
    expect(request.body.stream).toBe(false);
  });

  it('sends the model aiModel names', async () => {
    expect((await labelled({ ...ANTHROPIC, aiModel: 'claude-3-5-haiku-20241022' })).request.body.model).toBe('claude-3-5-haiku-20241022');
  });

  // The dated Haiku ID is not in the adapter's list of models that take the schema in the chat request, so the adapter's own
  // structured output runs: one forced call of a tool named structured_output, with the labels schema as its input.
  it('asks for the labels as a forced tool call, in the shape of the labels', async () => {
    const { request } = await labelled();

    expect(request.body.tool_choice).toEqual({ type: 'tool', name: 'structured_output' });
    expect(request.body.tools).toHaveLength(1);
    expect(request.body.tools[0].name).toBe('structured_output');
    expect(request.body.tools[0].input_schema.required).toEqual(Object.keys(labelsSchema.shape));
    expect(Object.keys(request.body.tools[0].input_schema.properties)).toEqual(Object.keys(labelsSchema.shape));
  });

  it('sends the exchange as the one user message, and nothing else of the customer', async () => {
    const { request } = await labelled();

    expect(request.body.messages).toHaveLength(1);
    expect(request.body.messages[0].role).toBe('user');
    expect(JSON.stringify(request.body.messages[0].content)).toContain('<customer_message>\\nThe strap on my bag broke after a week.\\n</customer_message>');
  });

  // Some Claude models refuse a sampling parameter and a disabled thinking mode (a 400), and the labels need neither.
  it('sends no sampling or thinking parameters', async () => {
    const { request } = await labelled();

    for (const name of ['temperature', 'top_p', 'top_k', 'thinking']) expect(request.body, name).not.toHaveProperty(name);
  });

  it('prints nothing of its own: the SDK logger is off, so no error object reaches the console', async () => {
    const spies = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log'), vi.spyOn(console, 'debug')];
    failing = () => json({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }, 401);

    await service(ANTHROPIC).label(EXCHANGE).catch(() => undefined);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('answers wrong-shaped labels with a validation failure, after one request', async () => {
    failing = () => anthropicAnswer({ ...LABELS, sentimentScore: 3 });

    const error = (await service(ANTHROPIC).label(EXCHANGE).catch((thrown: unknown) => thrown)) as Error & { code?: string };

    expect(error.message).toMatch(/^Validation failed: /);
    expect(error.code).toBe('structured-output-validation-failed');
    expect(sent).toHaveLength(1);
  });
});

/*
 * A model that the adapter lists as taking the schema in the chat request (Claude 4.5 and later, by their listed IDs, which
 * AI_MODEL can name) runs the other way: one streamed Messages request with `output_config.format`, and the labels are the
 * text of the answer. The dated Haiku ID is not on that list, so the default never takes this path.
 */
describe('what labelling sends to Anthropic for a model that takes the schema in the chat request', () => {
  const NATIVE = { ...ANTHROPIC, aiModel: 'claude-sonnet-4-5' };

  /** The Messages API streaming this text as the answer. */
  const streamed = (text: string) => {
    const events: Array<[string, Doc]> = [
      ['message_start', { type: 'message_start', message: { id: 'msg_stand_in', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    const body = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  it('is one streamed request with the schema as output_config.format and no tool, and its text is the labels', async () => {
    failing = () => streamed(JSON.stringify(LABELS));

    const labels = await service(NATIVE).label(EXCHANGE);

    expect(labels).toEqual(LABELS);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.model).toBe('claude-sonnet-4-5');
    expect(sent[0].body.stream).toBe(true);
    expect(sent[0].body.output_config.format).toMatchObject({ type: 'json_schema', schema: { type: 'object', additionalProperties: false } });
    expect(sent[0].body.tools ?? []).toEqual([]);
    expect(sent[0].body).not.toHaveProperty('tool_choice');
    for (const name of ['temperature', 'top_p', 'top_k', 'thinking']) expect(sent[0].body, name).not.toHaveProperty(name);
  });

  it('throws a validation failure for labels in the wrong shape, as the other path does', async () => {
    failing = () => streamed(JSON.stringify({ ...LABELS, kind: 'angry' }));

    const error = (await service(NATIVE).label(EXCHANGE).catch((thrown: unknown) => thrown)) as Error & { code?: string };

    expect(error.message).toMatch(/^Validation failed: /);
    expect(error.code).toBe('structured-output-validation-failed');
  });

  // Here the failure ends the run with a RUN_ERROR that has a message and a code, the status as a string, and no more.
  it('throws the SDK message with the status as the code, when the API answers 401', async () => {
    failing = () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);

    const error = (await service(NATIVE).label(EXCHANGE).catch((thrown: unknown) => thrown)) as Error & { code?: string };

    expect(error.message).toContain('401');
    expect(error.message).toContain('invalid x-api-key');
    expect(error.code).toBe('401');
  });

  it('ends a sweep on a 401, as the other path does: the status is read from the fetch', async () => {
    failing = () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
    const stored: Doc = { documentId: 'inq-1', message: 'A message.', reply: 'A reply.', analysisStatus: 'pending', analysisAttempts: 0, humanCorrected: false, createdAt: '2026-10-03T01:00:00.000Z' };
    const strapi = fakeStrapi({
      config: NATIVE,
      documents: () => ({
        findMany: async () => [{ ...stored }],
        findOne: async () => ({ ...stored }),
        update: async ({ data }: Doc) => Object.assign(stored, data),
      }),
    });

    expect(await labelling({ strapi }).sweep()).toEqual({ labelled: 0, failed: 0, skipped: 0 });

    expect(stored).toMatchObject({ analysisStatus: 'pending', analysisAttempts: 0 });
    expect(strapi.log.warn.mock.calls[0][0]).toContain('The AI provider refused the key or the setup');
  });
});

/*
 * What chat() throws when a provider fails, from the real adapters. Both catch the SDK's error and throw a new Error that has
 * only the words: "Structured output generation failed: <message>". The status is gone, and so is the SDK's error class.
 * That is why the service reads the status from the call's fetch, and these show that it does, for each adapter.
 */
describe('what chat() throws when the provider fails, and what the sweep makes of it', () => {
  const failure = (status: number, type: string, message: string) => () => json({ type: 'error', error: { type, message } }, status);

  const thrownBy = (config: Doc) => service(config).label(EXCHANGE).then(() => null, (error: unknown) => error as Error & { status?: number; code?: string });

  it.each([
    [401, 'authentication_error', 'invalid x-api-key'],
    [403, 'permission_error', 'Your API key does not have permission to use the specified resource.'],
    [404, 'not_found_error', 'model: claude-nope'],
    [400, 'invalid_request_error', 'messages: text content blocks must be non-empty'],
  ])('from Anthropic, a %i is an Error with the words only, after one request', async (status, type, message) => {
    failing = failure(status, type, message);

    const error = await thrownBy(ANTHROPIC);

    expect(error?.constructor).toBe(Error);
    expect(error?.message.startsWith(`Structured output generation failed: ${status} `)).toBe(true);
    expect(error?.message).toContain(message);
    expect(error).not.toHaveProperty('status');
    expect(sent).toHaveLength(1);
  });

  it('from Anthropic, a 529 overloaded is tried three times, as the SDK retries it, and then it throws', async () => {
    vi.useFakeTimers();
    failing = failure(529, 'overloaded_error', 'Overloaded');

    const outcome = thrownBy(ANTHROPIC);
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await outcome;

    expect(error?.message).toContain('529');
    expect(sent).toHaveLength(3);
  });

  it('from Anthropic, a connection that never comes up is tried three times, and then it throws "Connection error."', async () => {
    vi.useFakeTimers();
    failing = () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }) });
    };

    const outcome = thrownBy(ANTHROPIC);
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await outcome;

    expect(error?.message).toBe('Structured output generation failed: Connection error.');
    expect(sent).toHaveLength(3);
  });

  it('from Ollama, a 404 for a model it does not have is an Error with the words only, after one request', async () => {
    failing = () => json({ error: "model 'qwen3-nope' not found" }, 404);

    const error = await thrownBy(OLLAMA_ON);

    expect(error?.message).toBe("Structured output generation failed: model 'qwen3-nope' not found");
    expect(error).not.toHaveProperty('status');
    expect(error).not.toHaveProperty('status_code');
    expect(sent).toHaveLength(1);
  });

  it('from Ollama, a refused connection is "fetch failed", after one request', async () => {
    failing = () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }) });
    };

    const error = await thrownBy(OLLAMA_ON);

    expect(error?.message).toBe('Structured output generation failed: fetch failed');
    expect(sent).toHaveLength(1);
  });

  /** One inquiry waiting, a second behind it, and the sweep of them. */
  const swept = async (config: Doc) => {
    const stored: Doc[] = ['inq-1', 'inq-2'].map((documentId, index) => ({
      documentId,
      message: `Message of ${documentId}`,
      reply: 'A reply.',
      knowledgeFound: false,
      handedOff: false,
      analysisStatus: 'pending',
      analysisAttempts: 0,
      humanCorrected: false,
      createdAt: `2026-10-03T01:0${index}:00.000Z`,
    }));
    const documents = () => ({
      findMany: async ({ limit }: Doc) => stored.slice(0, limit).map((candidate) => ({ ...candidate })),
      findOne: async ({ documentId }: Doc) => {
        const found = stored.find((candidate) => candidate.documentId === documentId);
        return found ? { ...found } : null;
      },
      update: async ({ documentId, data }: Doc) => Object.assign(stored.find((candidate) => candidate.documentId === documentId)!, data),
    });
    const strapi = fakeStrapi({ config, documents: (uid) => (uid === UID.inquiry ? documents() : (undefined as never)) });
    const result = await labelling({ strapi }).sweep();
    return { result, stored, strapi };
  };

  it.each([
    [401, 'The AI provider refused the key or the setup'],
    [403, 'The AI provider refused the key or the setup'],
    [404, 'The AI provider refused the key or the setup'],
  ])('a %i from Anthropic ends the sweep with the rows as they were: %s', async (status, what) => {
    failing = failure(status, 'error', 'The provider refuses.');

    const { result, stored, strapi } = await swept(ANTHROPIC);

    expect(result).toEqual({ labelled: 0, failed: 0, skipped: 0 });
    expect(stored.map((candidate) => [candidate.analysisStatus, candidate.analysisAttempts])).toEqual([['pending', 0], ['pending', 0]]);
    expect(sent).toHaveLength(1);
    expect(strapi.log.warn).toHaveBeenCalledOnce();
    expect(strapi.log.warn.mock.calls[0][0]).toContain(what);
  });

  it('a 400 from Anthropic counts against the row it met, and the sweep goes on to the next', async () => {
    failing = failure(400, 'invalid_request_error', 'messages: text content blocks must be non-empty');

    const { result, stored } = await swept(ANTHROPIC);

    expect(result).toEqual({ labelled: 0, failed: 2, skipped: 0 });
    expect(stored.map((candidate) => [candidate.analysisStatus, candidate.analysisAttempts])).toEqual([['failed', 1], ['failed', 1]]);
    expect(sent).toHaveLength(2);
  });

  it('a 529 from Anthropic that outlasts the SDK retries is no answer: the sweep ends, and the rows are as they were', async () => {
    vi.useFakeTimers();
    failing = failure(529, 'overloaded_error', 'Overloaded');

    const sweeping = swept(ANTHROPIC);
    await vi.advanceTimersByTimeAsync(20_000);
    const { result, stored, strapi } = await sweeping;

    expect(result).toEqual({ labelled: 0, failed: 0, skipped: 0 });
    expect(stored.every((candidate) => candidate.analysisStatus === 'pending' && candidate.analysisAttempts === 0)).toBe(true);
    // Three requests, all for the first row.
    expect(sent).toHaveLength(3);
    expect(strapi.log.warn.mock.calls[0][0]).toContain('The AI provider gave no answer');
  });

  it('a connection that never comes up to Anthropic is no answer', async () => {
    vi.useFakeTimers();
    failing = () => {
      throw new TypeError('fetch failed');
    };

    const sweeping = swept(ANTHROPIC);
    await vi.advanceTimersByTimeAsync(20_000);
    const { result, stored, strapi } = await sweeping;

    expect(result).toEqual({ labelled: 0, failed: 0, skipped: 0 });
    expect(stored.every((candidate) => candidate.analysisStatus === 'pending')).toBe(true);
    expect(strapi.log.warn.mock.calls[0][0]).toContain('The AI provider gave no answer');
  });

  it('a model Ollama does not have is refused, and the sweep ends', async () => {
    failing = () => json({ error: "model 'qwen3-nope' not found" }, 404);

    const { result, stored, strapi } = await swept(OLLAMA_ON);

    expect(result).toEqual({ labelled: 0, failed: 0, skipped: 0 });
    expect(stored.every((candidate) => candidate.analysisStatus === 'pending')).toBe(true);
    expect(strapi.log.warn.mock.calls[0][0]).toContain('The AI provider refused the key or the setup');
  });

  it('Ollama not running is no answer, and the sweep ends', async () => {
    failing = () => {
      throw new TypeError('fetch failed');
    };

    const { result, stored, strapi } = await swept(OLLAMA_ON);

    expect(result).toEqual({ labelled: 0, failed: 0, skipped: 0 });
    expect(stored.every((candidate) => candidate.analysisStatus === 'pending')).toBe(true);
    expect(sent).toHaveLength(1);
    expect(strapi.log.warn.mock.calls[0][0]).toContain('The AI provider gave no answer');
  });

  it('cuts the key out of what the sweep logs, though the provider says it', async () => {
    failing = failure(401, 'authentication_error', `Incorrect API key provided: ${KEY}.`);

    const { strapi } = await swept(ANTHROPIC);

    const logged = JSON.stringify(Object.values(strapi.log).flatMap((method: any) => method.mock.calls));
    expect(logged).toContain('[key]');
    expect(logged).not.toContain(KEY);
  });
});

describe('what labelling sends to Ollama', () => {
  const labelled = async (config: Doc = OLLAMA_ON) => {
    const labels = await service(config).label(EXCHANGE);
    expect(sent).toHaveLength(1);
    return { labels, request: sent[0] };
  };

  it('is one request to /api/chat at the host, for the default model, and its answer is the labels', async () => {
    const { labels, request } = await labelled();

    expect(labels).toEqual(LABELS);
    expect(request.url).toBe(`${OLLAMA}/api/chat`);
    expect(request.body.model).toBe('qwen3-14b-32k');
    expect(request.body.stream).toBe(false);
  });

  it('turns thinking off', async () => {
    expect((await labelled()).request.body.think).toBe(false);
  });

  it('puts the criteria first, as the system message, and asks for JSON in the shape of the labels', async () => {
    const { request } = await labelled();

    expect(request.body.messages[0]).toEqual({ role: 'system', content: labelSystemPrompt() });
    expect(request.body.messages[1].role).toBe('user');
    expect(request.body.format).toMatchObject({ type: 'object', additionalProperties: false });
    expect(Object.keys(request.body.format.properties)).toEqual(Object.keys(labelsSchema.shape));
  });

  it('sends the model aiModel names', async () => {
    expect((await labelled({ ...OLLAMA_ON, aiModel: 'llama3.1' })).request.body.model).toBe('llama3.1');
  });

  it('sends no Authorization header, with a key or without: the key is the Anthropic key, and Ollama never gets it', async () => {
    expect((await labelled()).request.headers).not.toHaveProperty('authorization');

    sent.length = 0;
    const { request } = await labelled({ ...OLLAMA_ON, aiApiKey: KEY });
    expect(request.headers).not.toHaveProperty('authorization');
    expect(JSON.stringify(request)).not.toContain(KEY);
  });
});
