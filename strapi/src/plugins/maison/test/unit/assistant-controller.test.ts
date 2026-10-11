import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION, ASSISTANT_LIMITS } from '../../server/src/constants';
import controllers from '../../server/src/controllers';
import assistantController from '../../server/src/controllers/assistant';
import routes from '../../server/src/routes';
import assistantService from '../../server/src/services/assistant';
import { fakeStrapi } from './fake-strapi';

type Doc = Record<string, any>;

const KEY = 'sk-ant-api03-TEST-KEY-123';
const NO_KEY = "The assistant isn't set up. It needs an Anthropic API key in AI_API_KEY, with AI_PROVIDER unset or anthropic. Then restart Strapi.";
const TOO_LONG = 'This chat is long. Start a new chat.';

/** An answer from the service's turn: a server-sent event stream with one finished run. */
const finishedRun = () => new Response('data: {"type":"RUN_FINISHED","threadId":"t","runId":"r"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });

/**
 * The controller over the real assistant service, with `turn` standing in for the model: it records what it was given.
 * Everything before the model, the status, the readiness check, the body and the limit, is the service's own.
 */
const world = ({
  config = {},
  turn = vi.fn(async (..._args: any[]) => finishedRun()),
  service = {},
}: { config?: Doc; turn?: (...args: any[]) => Promise<Response>; service?: Doc } = {}) => {
  const settings = { aiApiKey: KEY, ...config };
  const real = assistantService({ strapi: fakeStrapi({ config: settings }) });
  const strapi = fakeStrapi({ services: { assistant: { ...real, ...service, turn } }, config: settings });
  return { controller: assistantController({ strapi }), turn: turn as ReturnType<typeof vi.fn>, strapi };
};

/** Enough of a Koa context for the chat: Strapi's error helpers, ctx.set, and the Node response with its events. */
const fakeCtx = (overrides: Doc = {}) => {
  const headers: Record<string, string> = {};
  const res: any = Object.assign(new EventEmitter(), { writableEnded: false });
  const ctx: any = {
    request: { body: undefined },
    state: { userAbility: { can: () => true }, user: { id: 7 } },
    status: 404,
    body: undefined,
    headers,
    res,
    set: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    ...overrides,
  };
  for (const [helper, status] of Object.entries({ badRequest: 400, internalServerError: 500 })) {
    ctx[helper] = vi.fn((message: string) => {
      ctx.status = status;
      ctx.body = { error: { message } };
    });
  }
  return ctx;
};

const message = (role: string, index: number) => ({ id: `${role}-${index}`, role, content: `${role} ${index}` });
/** An AG-UI run input with `count` staff messages, each but the last followed by an answer. */
const chatOf = (count: number) => ({
  threadId: 'thread-1',
  runId: 'run-1',
  messages: Array.from({ length: count }, (_, index) => [message('user', index), ...(index < count - 1 ? [message('assistant', index)] : [])]).flat(),
  tools: [],
  context: [],
});

/** What a Koa body of a Node stream sends, as text. */
const textOf = async (body: unknown): Promise<string> => {
  let text = '';
  for await (const chunk of body as Readable) text += chunk.toString();
  return text;
};
const eventsOf = async (body: unknown): Promise<Doc[]> =>
  (await textOf(body))
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)));

/** The seven read tools with the labels staff read, in the order the chat offers them. */
const ALL_TOOLS = [
  { name: 'list_requests', label: 'Visit requests' },
  { name: 'list_questions', label: 'Customer questions' },
  { name: 'list_inquiries', label: 'Inquiries' },
  { name: 'inquiry_counts', label: 'Inquiry counts' },
  { name: 'search_knowledge', label: 'Product knowledge' },
  { name: 'search_products', label: 'Product search' },
  { name: 'view_product', label: 'Product details' },
];
/** A Koa context whose admin may do only these actions. */
const ctxFor = (...granted: string[]) => fakeCtx({ state: { userAbility: { can: (action: string) => granted.includes(action) }, user: { id: 7 } } });

describe('assistant.status', () => {
  it('answers ready with the model and the tools, for an admin when there is a key and the provider is anthropic', async () => {
    const ctx = fakeCtx();
    await world().controller.status(ctx);
    expect(ctx.body).toEqual({ ready: true, model: 'claude-sonnet-5-5', tools: ALL_TOOLS });
  });

  it("lists the tools this admin's chat really gets: only what their role allows", async () => {
    const inquiries = ctxFor(ACTION.inquiriesView);
    await world().controller.status(inquiries);
    expect(inquiries.body.tools).toEqual([
      { name: 'list_inquiries', label: 'Inquiries' },
      { name: 'inquiry_counts', label: 'Inquiry counts' },
    ]);

    const nothing = ctxFor(ACTION.assistantUse);
    await world().controller.status(nothing);
    expect(nothing.body).toEqual({ ready: true, model: 'claude-sonnet-5-5', tools: [] });
  });

  it('leaves out the catalog tools that disabledTools names, as the chat does: the list is never every tool the plugin has', async () => {
    const ctx = fakeCtx();
    await world({ config: { disabledTools: ['search_products', 'view_product'] } }).controller.status(ctx);
    expect(ctx.body.tools.map((tool: Doc) => tool.name)).toEqual(['list_requests', 'list_questions', 'list_inquiries', 'inquiry_counts', 'search_knowledge']);
  });

  it('lists no tools when the context has no ability at all', async () => {
    const ctx = fakeCtx({ state: { user: { id: 7 } } });
    await world().controller.status(ctx);
    expect(ctx.body).toEqual({ ready: true, model: 'claude-sonnet-5-5', tools: [] });
  });

  it('answers not ready with the reason, for no key and for another provider', async () => {
    const noKey = fakeCtx();
    await world({ config: { aiApiKey: null } }).controller.status(noKey);
    expect(noKey.body).toEqual({ ready: false, reason: NO_KEY });
    const openai = fakeCtx();
    await world({ config: { aiProvider: 'openai' } }).controller.status(openai);
    expect(openai.body).toEqual({ ready: false, reason: 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.' });
  });

  it('never carries the key', async () => {
    for (const config of [{}, { aiApiKey: null }, { aiProvider: 'openai' }]) {
      const ctx = fakeCtx();
      await world({ config }).controller.status(ctx);
      expect(JSON.stringify(ctx.body)).not.toContain(KEY);
    }
  });
});

describe('assistant.chat, before the model', () => {
  it.each([
    ['there is no key', { aiApiKey: null }, NO_KEY],
    ['the provider is not anthropic', { aiProvider: 'openai' }, 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.'],
  ])('answers 200 with one not_ready RUN_ERROR when %s, and runs no turn', async (_why, config, reason) => {
    const { controller, turn } = world({ config });
    const ctx = fakeCtx({ request: { body: chatOf(1) } });
    await controller.chat(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(await eventsOf(ctx.body)).toEqual([expect.objectContaining({ type: 'RUN_ERROR', code: 'not_ready', message: reason })]);
    expect(turn).not.toHaveBeenCalled();
  });

  it('checks readiness before it reads the body: not ready with a body that is no run input is still not_ready, not a 400', async () => {
    const ctx = fakeCtx({ request: { body: { nonsense: true } } });
    await world({ config: { aiApiKey: null } }).controller.chat(ctx);
    expect(ctx.status).toBe(200);
    expect((await eventsOf(ctx.body))[0]).toMatchObject({ code: 'not_ready' });
    expect(ctx.badRequest).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, { threadId: 'x' }, { ...chatOf(1), messages: 'hi' }, { ...chatOf(1), messages: [{ id: 'x', role: 'wizard', content: 'hi' }] }])(
    'answers a body that is not an AG-UI run input with a 400 and its message, and runs no turn: %j',
    async (body) => {
      const { controller, turn } = world();
      const ctx = fakeCtx({ request: { body } });
      await controller.chat(ctx);
      expect(ctx.badRequest).toHaveBeenCalledOnce();
      expect(ctx.status).toBe(400);
      expect(ctx.badRequest.mock.calls[0][0]).toMatch(/not a valid AG-UI RunAgentInput/);
      expect(turn).not.toHaveBeenCalled();
    }
  );

  it('refuses the 21st staff message with 200 and one chat_too_long RUN_ERROR, and runs no turn', async () => {
    const { controller, turn } = world();
    const ctx = fakeCtx({ request: { body: chatOf(ASSISTANT_LIMITS.staffMessages + 1) } });
    await controller.chat(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.badRequest).not.toHaveBeenCalled();
    expect(await eventsOf(ctx.body)).toEqual([expect.objectContaining({ type: 'RUN_ERROR', code: 'chat_too_long', message: TOO_LONG })]);
    expect(turn).not.toHaveBeenCalled();
  });

  it('checks readiness before the limit: a chat that is too long while not ready is still not_ready', async () => {
    const { controller, turn } = world({ config: { aiApiKey: null } });
    const ctx = fakeCtx({ request: { body: chatOf(ASSISTANT_LIMITS.staffMessages + 1) } });
    await controller.chat(ctx);
    expect(ctx.status).toBe(200);
    expect(await eventsOf(ctx.body)).toEqual([expect.objectContaining({ type: 'RUN_ERROR', code: 'not_ready', message: NO_KEY })]);
    expect(turn).not.toHaveBeenCalled();
  });

  it('checks the body before the limit: a body that is no run input but has too many staff messages is a 400, not chat_too_long', async () => {
    const { controller, turn } = world();
    const ctx = fakeCtx({ request: { body: { ...chatOf(ASSISTANT_LIMITS.staffMessages + 1), threadId: undefined } } });
    await controller.chat(ctx);
    expect(ctx.badRequest).toHaveBeenCalledOnce();
    expect(ctx.status).toBe(400);
    expect(ctx.badRequest.mock.calls[0][0]).toMatch(/not a valid AG-UI RunAgentInput/);
    expect(turn).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an Error',
      () => new Error(`[maison] The assistant and inquiry labelling need @tanstack/ai, and it could not be loaded. Original error: Cannot find module '/secret/path' (key ${KEY})`),
    ],
    ['a thrown string', () => `Cannot find module '/secret/path' (key ${KEY})`],
  ])('answers a failure that is not a bad body, such as an SDK that did not load, with 200 and one internal RUN_ERROR, no raw text, and one log line: %s', async (_kind, thrown) => {
    const { controller, turn, strapi } = world({
      service: {
        parseBody: vi.fn(async () => {
          throw thrown();
        }),
      },
    });
    const ctx = fakeCtx({ request: { body: chatOf(1) } });
    await controller.chat(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.badRequest).not.toHaveBeenCalled();
    expect(ctx.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    const text = await textOf(ctx.body);
    const events = text
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice('data: '.length)));
    expect(events).toEqual([expect.objectContaining({ type: 'RUN_ERROR', code: 'internal', message: 'Something went wrong. Try again.' })]);
    for (const raw of ['/secret/path', 'Cannot find module', KEY, '[maison]']) expect(text).not.toContain(raw);
    expect(turn).not.toHaveBeenCalled();
    // The original goes to Strapi's log once, with the key taken out.
    expect(strapi.log.error).toHaveBeenCalledOnce();
    const logged = strapi.log.error.mock.calls[0][0] as string;
    expect(logged).toContain('/secret/path');
    expect(logged).not.toContain(KEY);
    // The plugin's tag is there once: a loader's message starts with it already.
    expect(logged.match(/\[maison\]/g)).toHaveLength(1);
  });

  describe('with an SDK that cannot be loaded at all', () => {
    const RAW = "Cannot find package '@tanstack/ai' imported from /secret/path/dist/server/index.js";

    afterEach(() => {
      vi.doUnmock('@tanstack/ai');
      vi.resetModules();
    });

    it('answers 200 with one internal RUN_ERROR in staff words and no raw text, never a 500, and logs the original once', async () => {
      // Fresh modules, so the service's load of the SDK, which the real parseBody makes, fails as it would in a broken install.
      vi.resetModules();
      vi.doMock('@tanstack/ai', () => {
        throw new Error(RAW);
      });
      const { default: freshService } = await import('../../server/src/services/assistant');
      const { default: freshController } = await import('../../server/src/controllers/assistant');
      const settings = { aiApiKey: KEY };
      const strapi = fakeStrapi({ services: { assistant: freshService({ strapi: fakeStrapi({ config: settings }) }) }, config: settings });
      const ctx = fakeCtx({ request: { body: chatOf(1) } });

      await freshController({ strapi }).chat(ctx);

      expect(ctx.status).toBe(200);
      expect(ctx.badRequest).not.toHaveBeenCalled();
      expect(ctx.internalServerError).not.toHaveBeenCalled();
      expect(ctx.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
      const text = await textOf(ctx.body);
      expect(await eventsOf(Readable.from([text]))).toEqual([expect.objectContaining({ type: 'RUN_ERROR', code: 'internal', message: 'Something went wrong. Try again.' })]);
      for (const raw of ['secret', 'Cannot find package', 'need @tanstack/ai', 'npm install', '[maison]', KEY]) expect(text, raw).not.toContain(raw);
      expect(strapi.log.error).toHaveBeenCalledOnce();
      const logged = strapi.log.error.mock.calls[0][0] as string;
      expect(logged).toContain('The assistant and inquiry labelling need @tanstack/ai');
      expect(logged).toContain('run npm install');
      expect(logged.match(/\[maison\]/g)).toHaveLength(1);
    });
  });

  it('does not refuse the 20th: it runs the turn', async () => {
    const { controller, turn } = world();
    const ctx = fakeCtx({ request: { body: chatOf(ASSISTANT_LIMITS.staffMessages) } });
    await controller.chat(ctx);
    expect(turn).toHaveBeenCalledOnce();
    expect(await eventsOf(ctx.body)).toEqual([expect.objectContaining({ type: 'RUN_FINISHED' })]);
  });

  it('counts only the staff messages, not the answers or the tool results between them', async () => {
    const { controller, turn } = world();
    const messages = [
      ...Array.from({ length: ASSISTANT_LIMITS.staffMessages }, (_, index) => [message('user', index), message('assistant', index), { id: `t-${index}`, role: 'tool', content: '{}', toolCallId: `c-${index}` }]).flat(),
    ];
    const ctx = fakeCtx({ request: { body: { ...chatOf(1), messages } } });
    await controller.chat(ctx);
    expect(turn).toHaveBeenCalledOnce();
  });
});

describe('assistant.chat, the turn', () => {
  it("runs the turn with the signed-in admin's ability and id, and the parsed body", async () => {
    const { controller, turn } = world();
    const ability = { can: vi.fn(() => true) };
    const ctx = fakeCtx({ request: { body: chatOf(2) }, state: { userAbility: ability, user: { id: 42 } } });
    await controller.chat(ctx);
    expect(turn).toHaveBeenCalledOnce();
    const [params, request] = turn.mock.calls[0];
    expect(params).toMatchObject({ threadId: 'thread-1', runId: 'run-1', messages: expect.any(Array) });
    expect(params.messages).toHaveLength(3);
    expect(request.ability).toBe(ability);
    expect(request.adminId).toBe(42);
    expect(request.responseController).toBeInstanceOf(AbortController);
  });

  it('gives an admin with no ability no permission at all, and no id', async () => {
    const { controller, turn } = world();
    const ctx = fakeCtx({ request: { body: chatOf(1) }, state: {} });
    await controller.chat(ctx);
    const [, request] = turn.mock.calls[0];
    expect(request.ability.can('plugin::maison.catalog.read')).toBe(false);
    expect(request.adminId).toBeNull();
  });

  it('sends the answer with status 200 and the four headers that keep the stream open and unbuffered', async () => {
    const ctx = fakeCtx({ request: { body: chatOf(1) } });
    await world().controller.chat(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.headers).toEqual({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  });

  it('sends the answer as a Node stream: Koa cannot send a web stream, and would send {}', async () => {
    const ctx = fakeCtx({ request: { body: chatOf(1) } });
    await world().controller.chat(ctx);
    expect(ctx.body).toBeInstanceOf(Readable);
    expect(await textOf(ctx.body)).toBe('data: {"type":"RUN_FINISHED","threadId":"t","runId":"r"}\n\n');
  });

  it('answers 500 when the service gives an answer with no body', async () => {
    const { controller } = world({ turn: vi.fn(async () => new Response(null)) });
    const ctx = fakeCtx({ request: { body: chatOf(1) } });
    await controller.chat(ctx);
    expect(ctx.internalServerError).toHaveBeenCalledOnce();
    expect(ctx.status).toBe(500);
  });

  it('stops the model call when the response closes before it ends: a closed tab, or Stop', async () => {
    const { controller, turn } = world();
    const ctx = fakeCtx({ request: { body: chatOf(1) } });
    await controller.chat(ctx);
    const { responseController } = turn.mock.calls[0][1] as { responseController: AbortController };
    expect(responseController.signal.aborted).toBe(false);
    ctx.res.emit('close');
    expect(responseController.signal.aborted).toBe(true);
  });

  it('stops the model call at once when the response was already closed before the turn started: the close event fired earlier', async () => {
    const { controller, turn } = world();
    const res: any = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: true });
    const ctx = fakeCtx({ request: { body: chatOf(1) }, res });
    await controller.chat(ctx);
    const { responseController } = turn.mock.calls[0][1] as { responseController: AbortController };
    expect(responseController.signal.aborted).toBe(true);
  });

  it('leaves the model call alone when the response closes after it ended: the normal end', async () => {
    const { controller, turn } = world();
    const ctx = fakeCtx({ request: { body: chatOf(1) } });
    await controller.chat(ctx);
    const { responseController } = turn.mock.calls[0][1] as { responseController: AbortController };
    ctx.res.writableEnded = true;
    ctx.res.emit('close');
    expect(responseController.signal.aborted).toBe(false);
  });
});

describe('the assistant routes', () => {
  const gate = (action: string) => ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: [action] } }];
  const routeOf = (method: string, path: string) => routes.admin.routes.find((route) => route.method === method && route.path === path);

  it('are two admin routes, each for admins who hold assistant.use, served as /maison/assistant/status and /maison/assistant/chat', () => {
    expect(routeOf('GET', '/assistant/status')).toEqual({ method: 'GET', path: '/assistant/status', handler: 'assistant.status', config: { policies: gate(ACTION.assistantUse) } });
    expect(routeOf('POST', '/assistant/chat')).toEqual({ method: 'POST', path: '/assistant/chat', handler: 'assistant.chat', config: { policies: gate(ACTION.assistantUse) } });
    expect(gate(ACTION.assistantUse)[1]).toEqual({ name: 'admin::hasPermissions', config: { actions: ['plugin::maison.assistant.use'] } });
  });

  it('name controller actions that exist', () => {
    const instance = (controllers as Doc).assistant({ strapi: fakeStrapi() });
    expect(typeof instance.status).toBe('function');
    expect(typeof instance.chat).toBe('function');
  });
});
