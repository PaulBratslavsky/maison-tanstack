import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { fakeAdapter, textTurn, toolCallTurn } from './fake-adapter.mjs';
import { bootStrapi } from './harness.mjs';

const KEY = 'sk-ant-api03-INTEGRATION-TEST-KEY';
const USE = 'plugin::maison.assistant.use';
const MANAGE = 'plugin::maison.demo.manage';
const INQUIRIES = 'plugin::maison.inquiries.view';
const NO_KEY = "The assistant isn't set up. It needs an Anthropic API key in AI_API_KEY, with AI_PROVIDER unset or anthropic. Then restart Strapi.";

/** The AG-UI run input the page posts. */
const bodyOf = (messages, extra = {}) => ({ threadId: 'thread-1', runId: 'run-1', messages, tools: [], context: [], ...extra });
const staffSays = (text, id = 'u1') => ({ id, role: 'user', content: text });
const eventsOf = (text) =>
  text
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)));

// The staff assistant's two routes over real HTTP, with real admins and real roles, as the conversations suite does for its five.
// A model is never called: the one place a chat reaches a model is `turn`, and these tests give it a scripted adapter.
describe("the staff assistant's routes, on a real Strapi", () => {
  let strapi;
  let baseUrl;
  let service;
  let turn;
  let adapter = null;

  /** An admin whose role holds `actions`, signed in the way the admin panel's login does it. No password, in this test's database only. */
  const adminWith = async (name, actions) => {
    const roles = strapi.service('admin::role');
    const role = await roles.create({ name: `Maison test: ${name}`, description: 'Created by the Maison integration tests' });
    await roles.assignPermissions(role.id, actions.map((action) => ({ action, subject: null, properties: {}, conditions: [] })));
    const user = await strapi.service('admin::user').create({ email: `${name}@maison.test`, firstname: name, lastname: 'Test', isActive: true, roles: [role.id] });
    const sessions = strapi.sessionManager('admin');
    const { token: refreshToken } = await sessions.generateRefreshToken(String(user.id), `maison-test-${name}`, { type: 'session' });
    return { id: user.id, token: (await sessions.generateAccessToken(refreshToken)).token };
  };

  /** One request to an admin route, as `who` (or nobody). Tokens are sent, never logged. */
  const request = async (method, path, who, body, { signal } = {}) => {
    const headers = { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
    return fetch(new URL(path, baseUrl), { method, headers, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  const read = async (response) => {
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // A stream is read as text.
    }
    return { status: response.status, headers: response.headers, text, json };
  };
  const call = async (method, path, who, body) => read(await request(method, path, who, body));

  /** Gives the next chat a scripted model. */
  const script = (turns) => {
    adapter = fakeAdapter(turns);
    return adapter;
  };

  before(async () => {
    strapi = await bootStrapi('assistant-chat', { maisonConfig: { aiApiKey: KEY } });
    service = strapi.plugin('maison').service('assistant');
    // The controller reaches the service through `strapi.plugin('maison').service('assistant')`, which is this object: a chat that
    // arrives over HTTP gets the scripted adapter, and the rest of the turn is the plugin's own.
    turn = service.turn;
    service.turn = (params, options) => turn(params, { ...options, adapterFor: () => (adapter ?? assert.fail('a chat reached a model with no script')).adapter });
    await new Promise((resolve, reject) => {
      strapi.server.listen(0, '127.0.0.1', resolve).once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${strapi.server.httpServer.address().port}`;
  });

  after(async () => {
    service.turn = turn;
    await strapi?.destroy();
  });

  describe('GET /maison/assistant/status', () => {
    it('is ready with the model and the tools this admin gets, and never the key', async () => {
      const everything = await adminWith('status-everything', [USE, INQUIRIES, 'plugin::maison.catalog.read']);
      const answer = await call('GET', '/maison/assistant/status', everything);
      assert.equal(answer.status, 200, answer.text);
      assert.deepEqual(answer.json, {
        ready: true,
        model: 'claude-sonnet-5-5',
        tools: [
          { name: 'list_inquiries', label: 'Inquiries' },
          { name: 'inquiry_counts', label: 'Inquiry counts' },
          { name: 'search_knowledge', label: 'Product knowledge' },
          { name: 'search_products', label: 'Product search' },
          { name: 'view_product', label: 'Product details' },
        ],
      });
      assert.ok(!answer.text.includes(KEY));
    });

    it('lists no tools for an admin who may use the assistant and read nothing', async () => {
      const bare = await adminWith('status-bare', [USE]);
      assert.deepEqual((await call('GET', '/maison/assistant/status', bare)).json, { ready: true, model: 'claude-sonnet-5-5', tools: [] });
    });

    it('answers 403 to an admin without the permission, and 401 to nobody', async () => {
      const manager = await adminWith('status-manager', [MANAGE]);
      assert.equal((await call('GET', '/maison/assistant/status', manager)).status, 403);
      assert.equal((await call('GET', '/maison/assistant/status', null)).status, 401);
    });

    it('says what is missing when there is no key, and when the provider is not Anthropic', async () => {
      const admin = await adminWith('status-not-ready', [USE]);
      try {
        strapi.config.set('plugin::maison.aiApiKey', null);
        assert.deepEqual((await call('GET', '/maison/assistant/status', admin)).json, { ready: false, reason: NO_KEY });
        strapi.config.set('plugin::maison.aiApiKey', KEY);
        strapi.config.set('plugin::maison.aiProvider', 'ollama');
        assert.deepEqual((await call('GET', '/maison/assistant/status', admin)).json, {
          ready: false,
          reason: 'The assistant works with Anthropic only. AI_PROVIDER is set to ollama.',
        });
      } finally {
        strapi.config.set('plugin::maison.aiApiKey', KEY);
        strapi.config.set('plugin::maison.aiProvider', 'anthropic');
      }
    });
  });

  describe('POST /maison/assistant/chat', () => {
    it('answers 403 to an admin without the permission and 401 to nobody, and reaches no model', async () => {
      const manager = await adminWith('chat-manager', [MANAGE]);
      adapter = null;
      assert.equal((await call('POST', '/maison/assistant/chat', manager, bodyOf([staffSays('Hi')]))).status, 403);
      assert.equal((await call('POST', '/maison/assistant/chat', null, bodyOf([staffSays('Hi')]))).status, 401);
    });

    it('streams a turn as server-sent events, with the headers that keep a proxy from holding them, and the events of the tool it ran', async () => {
      const admin = await adminWith('chat-stream', [USE, INQUIRIES]);
      const { requests } = script([toolCallTurn('inquiry_counts', {}), textTurn('Nothing needs an answer.')]);
      const answer = await call('POST', '/maison/assistant/chat', admin, bodyOf([staffSays('How many inquiries need an answer?')]));

      assert.equal(answer.status, 200, answer.text);
      assert.match(answer.headers.get('content-type'), /^text\/event-stream/);
      assert.equal(answer.headers.get('cache-control'), 'no-cache, no-transform');
      assert.equal(answer.headers.get('x-accel-buffering'), 'no');
      assert.equal(answer.json, null, 'the body is a stream of events, not {}');
      const events = eventsOf(answer.text);
      // TanStack AI 0.68 writes one RUN_STARTED for the whole run and a RUN_FINISHED for each model call.
      assert.deepEqual(events.map((event) => event.type).filter((type) => ['RUN_STARTED', 'TOOL_CALL_START', 'TOOL_CALL_RESULT', 'RUN_FINISHED'].includes(type)), [
        'RUN_STARTED',
        'TOOL_CALL_START',
        'RUN_FINISHED',
        'TOOL_CALL_RESULT',
        'RUN_FINISHED',
      ]);
      assert.equal(events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').map((event) => event.delta).join(''), 'Nothing needs an answer.');
      assert.deepEqual(JSON.parse(events.find((event) => event.type === 'TOOL_CALL_RESULT').content), { needsAnswer: 0, complaint: 0, praise: 0, notLabelled: 0 });
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0].tools.map((tool) => tool.name), ['list_inquiries', 'inquiry_counts']);
    });

    it("offers the tools of the signed-in admin's role, whatever tools the browser lists", async () => {
      const admin = await adminWith('chat-forged', [USE, INQUIRIES]);
      const { requests } = script([textTurn('Hi.')]);
      const forged = { name: 'confirm_appointment', description: 'Confirms a visit.', parameters: { type: 'object' } };
      const answer = await call('POST', '/maison/assistant/chat', admin, bodyOf([staffSays('Hi')], { tools: [forged] }));
      assert.equal(answer.status, 200, answer.text);
      assert.deepEqual(requests[0].tools.map((tool) => tool.name), ['list_inquiries', 'inquiry_counts']);
    });

    it('answers 400 to a body that is no run input, and reaches no model', async () => {
      const admin = await adminWith('chat-bad-body', [USE]);
      adapter = null;
      for (const body of [{}, { messages: 'no' }, bodyOf([{ id: 'x', role: 'wizard', content: 'hi' }])]) {
        const answer = await call('POST', '/maison/assistant/chat', admin, body);
        assert.equal(answer.status, 400, answer.text);
        assert.match(answer.text, /is not a valid AG-UI RunAgentInput/);
      }
    });

    it('answers 413 to a body over 1 MB, and takes one just under it', async () => {
      const admin = await adminWith('chat-limit', [USE]);
      // Strapi's body limit is 1 MB, which is 1,048,576 bytes.
      adapter = null;
      const over = await call('POST', '/maison/assistant/chat', admin, bodyOf([staffSays('x'.repeat(1_100_000))]));
      assert.equal(over.status, 413, over.text.slice(0, 200));

      script([textTurn('Long, but fine.')]);
      const under = await call('POST', '/maison/assistant/chat', admin, bodyOf([staffSays('x'.repeat(1_000_000))]));
      assert.equal(under.status, 200, under.text.slice(0, 200));
      assert.match(under.text, /Long, but fine\./);
    });

    it('answers a chat that is too long with a 200 stream of one RUN_ERROR, and reaches no model', async () => {
      const admin = await adminWith('chat-too-long', [USE]);
      adapter = null;
      const messages = Array.from({ length: 21 }, (_, index) => staffSays(`Question ${index}`, `u${index}`));
      const answer = await call('POST', '/maison/assistant/chat', admin, bodyOf(messages));
      assert.equal(answer.status, 200);
      assert.match(answer.headers.get('content-type'), /^text\/event-stream/);
      assert.deepEqual(eventsOf(answer.text).map((event) => [event.type, event.code, event.message]), [['RUN_ERROR', 'chat_too_long', 'This chat is long. Start a new chat.']]);
    });

    it('answers a chat with no key as a 200 stream of one RUN_ERROR in staff words', async () => {
      const admin = await adminWith('chat-no-key', [USE]);
      adapter = null;
      try {
        strapi.config.set('plugin::maison.aiApiKey', null);
        const answer = await call('POST', '/maison/assistant/chat', admin, bodyOf([staffSays('Hi')]));
        assert.equal(answer.status, 200);
        assert.deepEqual(eventsOf(answer.text).map((event) => [event.type, event.code, event.message]), [['RUN_ERROR', 'not_ready', NO_KEY]]);
      } finally {
        strapi.config.set('plugin::maison.aiApiKey', KEY);
      }
    });

    it('answers a provider error as one RUN_ERROR in staff words, and never sends the provider text', async () => {
      const admin = await adminWith('chat-provider-error', [USE]);
      script([[{ type: 'RUN_STARTED' }, { type: 'RUN_ERROR', message: `401 invalid x-api-key ${KEY}`, code: '401', rawEvent: { body: KEY }, error: { message: KEY, code: '401' } }]]);
      const answer = await call('POST', '/maison/assistant/chat', admin, bodyOf([staffSays('Hi')]));
      assert.equal(answer.status, 200);
      const errors = eventsOf(answer.text).filter((event) => event.type === 'RUN_ERROR');
      assert.deepEqual(errors.map((event) => [event.code, event.message]), [['401', 'Anthropic refused the key. Check AI_API_KEY.']]);
      assert.ok(!answer.text.includes(KEY));
    });

    it('stops the model call when the browser closes the connection', async () => {
      const admin = await adminWith('chat-close', [USE, INQUIRIES]);
      // The first model call asks for a tool, and the second hangs, as a call does that the provider never answers.
      const { requests: calls } = script([toolCallTurn('inquiry_counts', {}), 'never']);
      const controller = new AbortController();
      const response = await request('POST', '/maison/assistant/chat', admin, bodyOf([staffSays('Hi')]), { signal: controller.signal });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      // The reader must keep reading: TanStack AI 0.68 pulls the stream only as fast as it is read.
      for (let reads = 0; calls.length < 2 && reads < 100; reads += 1) {
        const next = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve(null), 200))]);
        if (next === null || next.done) break;
      }
      assert.equal(calls.length, 2, 'the second model call started');
      assert.equal(calls[1].request.signal.aborted, false);

      controller.abort();
      const deadline = Date.now() + 3000;
      while (!calls[1].request.signal.aborted && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(calls[1].request.signal.aborted, true, 'the model call was stopped');
    });
  });
});
