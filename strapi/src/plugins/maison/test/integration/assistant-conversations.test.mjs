import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bootStrapi } from './harness.mjs';

const CONVERSATION = 'plugin::maison.conversation';
const NO_CHAT = 'There is no saved chat with that ID.';
const NO_CHAT_HINT = 'Reload the page: it may have been deleted.';
const NOT_SAVED = 'This chat could not be saved.';
const USE = 'plugin::maison.assistant.use';
const MANAGE = 'plugin::maison.demo.manage';

/** The messages of a chat as the page saves them: TanStack AI's UIMessage, with the parts a real chat has. */
const CHAT = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', content: '今日のお客様からの問い合わせは? 😀' }] },
  {
    id: 'a1',
    role: 'assistant',
    createdAt: '2026-10-07T01:02:03.000Z',
    parts: [
      { type: 'thinking', content: 'Let me look.', signature: 'EqQBCkYIBRgCIkD+/=', providerMetadata: { anthropic: { index: 0 } } },
      { type: 'text', content: 'Looking.\n\n| a | b |\n| - | - |\n| 1 | 2 |', metadata: { anthropic: { citations: [] } } },
      { type: 'tool-call', id: 'c1', name: 'list_inquiries', arguments: '{}', state: 'complete', input: {}, output: { inquiries: [{ documentId: 'k1', customer: 'line:U4af…88', message: '<customer_message>Hello</customer_message>' }], capped: false } },
      { type: 'tool-result', toolCallId: 'c1', content: '{"inquiries":[]}', state: 'complete' },
      { type: 'structured-output', status: 'complete', raw: '{}', data: { nested: [1, [2, { three: null }]], line: 'a b' } },
    ],
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A Koa context with what the controller reads, and Strapi's error helpers, which the HTTP stack adds and a direct call lacks. */
const ctxFor = (admin, { params = {}, body } = {}) => {
  const ctx = { state: admin === null ? {} : { user: { id: admin } }, params, request: { body }, status: 200, body: undefined };
  for (const [helper, status] of Object.entries({ badRequest: 400, unauthorized: 401, notFound: 404 })) {
    ctx[helper] = (message, details) => {
      ctx.status = status;
      ctx.body = { error: { message, details } };
    };
  }
  return ctx;
};

describe('the Ask tab\'s saved chats, on a real Strapi', () => {
  let strapi;
  let chats;
  let seed;

  /** Runs one of the controller's handlers as `admin`, and answers the context it left. */
  const call = async (handler, admin, options) => {
    const ctx = ctxFor(admin, options);
    await chats[handler](ctx);
    return ctx;
  };
  const stored = () => strapi.documents(CONVERSATION).findMany({ limit: 500 });

  before(async () => {
    strapi = await bootStrapi('assistant-conversations');
    chats = strapi.plugin('maison').controller('conversations');
    seed = strapi.plugin('maison').service('seed');
  });
  after(async () => {
    await strapi?.destroy();
  });

  it('is a content type that Strapi loaded, hidden from the Content Manager and the Content-Type Builder', () => {
    const type = strapi.contentTypes[CONVERSATION];
    assert.ok(type, 'plugin::maison.conversation is loaded');
    assert.equal(type.collectionName, 'maison_conversations');
    assert.equal(type.options.draftAndPublish, false);
    assert.equal(type.pluginOptions['content-manager'].visible, false);
    assert.equal(type.pluginOptions['content-type-builder'].visible, false);
  });

  it('saves a chat, lists it and opens it, and every key of every part comes back as it was saved', async () => {
    const created = await call('create', 1, { body: { title: '今日のお客様からの問い合わせは? 😀', messages: CHAT } });
    assert.equal(created.status, 201);
    const { documentId, title } = created.body.conversation;
    assert.equal(title, '今日のお客様からの問い合わせは? 😀');
    assert.deepEqual(Object.keys(created.body.conversation).sort(), ['documentId', 'title', 'updatedAt']);

    const listed = await call('list', 1);
    assert.deepEqual(listed.body.conversations.map((chat) => chat.documentId), [documentId]);

    const opened = await call('findOne', 1, { params: { documentId } });
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.body.conversation.messages, CHAT);
    // A text part keeps its metadata too: a text part that did not keep extra keys would lose it on save, with no error.
    assert.deepEqual(opened.body.conversation.messages[1].parts[1].metadata, { anthropic: { citations: [] } });
    // In the database it is the envelope.
    const row = await strapi.documents(CONVERSATION).findOne({ documentId });
    assert.deepEqual(row.messages, { v: 1, messages: CHAT });
    assert.equal(row.adminUserId, 1);
  });

  it("keeps one admin's chat from another: it is not in their list, and opening, saving and deleting it answer 404, as an ID nobody has does", async () => {
    const mine = (await call('create', 11, { body: { title: 'Mine', messages: CHAT } })).body.conversation.documentId;

    assert.deepEqual((await call('list', 12)).body.conversations, []);
    const message = { message: NO_CHAT, details: { code: 'not_found', hint: 'Reload the page: it may have been deleted.' } };
    for (const [handler, options] of [
      ['findOne', {}],
      ['update', { body: { title: 'Theirs now' } }],
      ['remove', {}],
    ]) {
      const theirs = await call(handler, 12, { ...options, params: { documentId: mine } });
      const nobody = await call(handler, 12, { ...options, params: { documentId: 'no-such-chat' } });
      assert.equal(theirs.status, 404, handler);
      assert.deepEqual(theirs.body, { error: message }, handler);
      assert.deepEqual(nobody.body, theirs.body, handler);
    }

    // Nothing of it changed, and its admin still has it.
    const row = await strapi.documents(CONVERSATION).findOne({ documentId: mine });
    assert.equal(row.title, 'Mine');
    assert.equal(row.adminUserId, 11);
    assert.equal((await call('findOne', 11, { params: { documentId: mine } })).status, 200);
  });

  it('takes the admin from the session, never from the body', async () => {
    const created = await call('create', 13, { body: { title: 'x', messages: CHAT, adminUserId: 99 } });
    const row = await strapi.documents(CONVERSATION).findOne({ documentId: created.body.conversation.documentId });
    assert.equal(row.adminUserId, 13);
    await call('update', 13, { params: { documentId: row.documentId }, body: { adminUserId: 99, title: 'y' } });
    assert.equal((await strapi.documents(CONVERSATION).findOne({ documentId: row.documentId })).adminUserId, 13);
  });

  it('answers 400 with a staff text for a body that is not a chat, and saves nothing', async () => {
    const before = (await stored()).length;
    for (const body of [undefined, 'hello', [], { title: 'x' }, { title: 'x', messages: 'hello' }, { title: 'x', messages: [{ id: 'm1', role: 'wizard', parts: [] }] }]) {
      const created = await call('create', 14, { body });
      assert.equal(created.status, 400, JSON.stringify(body));
      assert.equal(created.body.error.message, NOT_SAVED);
      assert.equal(created.body.error.details.code, 'invalid_input');
    }
    assert.equal((await stored()).length, before);

    const id = (await call('create', 14, { body: { title: 'Keep', messages: CHAT } })).body.conversation.documentId;
    const bad = await call('update', 14, { params: { documentId: id }, body: { title: 'Lost', messages: 'hello' } });
    assert.equal(bad.status, 400);
    const row = await strapi.documents(CONVERSATION).findOne({ documentId: id });
    assert.equal(row.title, 'Keep');
    assert.deepEqual(row.messages, { v: 1, messages: CHAT });
  });

  it('lists the newest first: a chat saved again moves to the top', async () => {
    const admin = 15;
    const ids = [];
    for (const title of ['First', 'Second', 'Third']) {
      ids.push((await call('create', admin, { body: { title, messages: CHAT } })).body.conversation.documentId);
      await sleep(15);
    }
    assert.deepEqual((await call('list', admin)).body.conversations.map((chat) => chat.title), ['Third', 'Second', 'First']);

    await call('update', admin, { params: { documentId: ids[0] }, body: { messages: [...CHAT, { id: 'u2', role: 'user', parts: [{ type: 'text', content: 'More' }] }] } });
    assert.deepEqual((await call('list', admin)).body.conversations.map((chat) => chat.title), ['First', 'Third', 'Second']);
  });

  it('lists at most 100 chats: the newest', async () => {
    const admin = 16;
    for (let index = 0; index < 101; index += 1) {
      await strapi.documents(CONVERSATION).create({ data: { title: `Chat ${String(index).padStart(3, '0')}`, messages: { v: 1, messages: [] }, adminUserId: admin } });
      // updatedAt has the precision of a millisecond: each chat gets a moment of its own, so "newest" has one answer.
      await sleep(2);
    }
    const { conversations } = (await call('list', admin)).body;
    assert.equal(conversations.length, 100);
    assert.equal(conversations[0].title, 'Chat 100');
    assert.ok(!conversations.some((chat) => chat.title === 'Chat 000'));
  });

  it('cuts a long title to 80 characters, and never splits an emoji or a Japanese character', async () => {
    const created = await call('create', 17, { body: { title: '😀'.repeat(100), messages: CHAT } });
    assert.equal(created.body.conversation.title, '😀'.repeat(80));
    const japanese = '今日のお客様からの問い合わせを教えてください。'.repeat(5);
    const second = await call('create', 17, { body: { title: japanese, messages: CHAT } });
    assert.equal(Array.from(second.body.conversation.title).length, 80);
    assert.ok(japanese.startsWith(second.body.conversation.title));
  });

  it('opens a chat whose stored messages cannot be read as an empty chat, and leaves the stored value alone', async () => {
    const row = await strapi.documents(CONVERSATION).create({ data: { title: 'Damaged', messages: { v: 9, other: 'shape' }, adminUserId: 18 } });
    const opened = await call('findOne', 18, { params: { documentId: row.documentId } });
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.body.conversation.messages, []);
    assert.deepEqual((await strapi.documents(CONVERSATION).findOne({ documentId: row.documentId })).messages, { v: 9, other: 'shape' });
  });

  it('deletes a chat at once', async () => {
    const id = (await call('create', 19, { body: { title: 'Gone', messages: CHAT } })).body.conversation.documentId;
    const removed = await call('remove', 19, { params: { documentId: id } });
    assert.deepEqual(removed.body, { documentId: id });
    assert.equal(await strapi.documents(CONVERSATION).findOne({ documentId: id }), null);
  });

  it("is cleared by Reset demo activity: every admin's chats, and nothing else of the answer changes", async () => {
    assert.ok((await stored()).length > 0, 'there are chats to clear');
    assert.deepEqual(await seed.resetDemoAppointments(), { appointments: 0, notifications: 0, questions: 0, inquiries: 0, knowledge: 0 });
    assert.equal(await strapi.documents(CONVERSATION).count(), 0);
    assert.deepEqual((await call('list', 1)).body.conversations, []);
  });

  // The same rules over real HTTP. The tests above call the controller with a request they built by hand, so they cannot see a route that
  // loses its permission check, an admin that the session carries in a form the controller does not expect, or a body limit that changed.
  // These use real roles, real admin users with their session tokens, and the routes Strapi serves.
  describe('over the admin routes, with real admins', () => {
    let baseUrl;
    let manager;

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

    /** An admin who may use the assistant. Each test makes its own, so each starts with no chats. */
    const assistantAdmin = (name) => adminWith(name, [USE]);

    /** One request to an admin route, as `who` (an admin from `adminWith`, or nobody), with a JSON body when given one. Tokens are sent, never logged. */
    const request = async (method, path, who, body) => {
      const headers = { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
      const response = await fetch(new URL(path, baseUrl), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // An answer that is not JSON is checked by its status and its text.
      }
      return { status: response.status, text, body: parsed };
    };

    /** Saves a chat for `who` through the route, and answers its ID. */
    const saveChat = async (who, title) => {
      const created = await request('POST', '/maison/conversations', who, { title, messages: CHAT });
      assert.equal(created.status, 201, created.text);
      return created.body.conversation.documentId;
    };

    before(async () => {
      manager = await adminWith('chat-demo-manager', [MANAGE]);
      await new Promise((resolve, reject) => {
        strapi.server.listen(0, '127.0.0.1', resolve).once('error', reject);
      });
      baseUrl = `http://127.0.0.1:${strapi.server.httpServer.address().port}`;
    });

    it('lets an admin save, list, open, save again and delete their own chat, and answers nothing but the documented keys', async () => {
      const alice = await assistantAdmin('own-alice');
      const created = await request('POST', '/maison/conversations', alice, { title: 'Which visits are waiting?', messages: CHAT, adminUserId: 999 });
      assert.equal(created.status, 201, created.text);
      assert.deepEqual(Object.keys(created.body.conversation).sort(), ['documentId', 'title', 'updatedAt']);
      const { documentId } = created.body.conversation;
      // The chat belongs to the admin who is signed in, as that admin's real ID, and not to the one the body names.
      assert.equal((await strapi.documents(CONVERSATION).findOne({ documentId })).adminUserId, alice.id);

      const listed = await request('GET', '/maison/conversations', alice);
      assert.equal(listed.status, 200, listed.text);
      assert.deepEqual(listed.body.conversations.map((chat) => chat.documentId), [documentId]);
      assert.deepEqual(Object.keys(listed.body.conversations[0]).sort(), ['documentId', 'title', 'updatedAt']);

      const opened = await request('GET', `/maison/conversations/${documentId}`, alice);
      assert.equal(opened.status, 200, opened.text);
      assert.deepEqual(opened.body.conversation.messages, CHAT);
      assert.equal('adminUserId' in opened.body.conversation, false);

      const saved = await request('PUT', `/maison/conversations/${documentId}`, alice, { title: 'Renamed' });
      assert.equal(saved.status, 200, saved.text);
      assert.equal(saved.body.conversation.title, 'Renamed');
      assert.equal((await strapi.documents(CONVERSATION).findOne({ documentId })).title, 'Renamed');

      const removed = await request('DELETE', `/maison/conversations/${documentId}`, alice);
      assert.equal(removed.status, 200, removed.text);
      assert.deepEqual(removed.body, { documentId });
      assert.equal((await request('GET', `/maison/conversations/${documentId}`, alice)).status, 404);
    });

    it("keeps one admin's chat from another: their list is empty, and opening, saving and deleting it answer 404, with the body an ID nobody has gets", async () => {
      const alice = await assistantAdmin('privacy-alice');
      const bob = await assistantAdmin('privacy-bob');
      const mine = await saveChat(alice, 'Only Alice reads this');

      assert.deepEqual((await request('GET', '/maison/conversations', bob)).body, { conversations: [] });
      for (const [method, body] of [['GET'], ['PUT', { title: 'Bob renames it' }], ['DELETE']]) {
        const theirs = await request(method, `/maison/conversations/${mine}`, bob, body);
        const nobody = await request(method, '/maison/conversations/no-such-chat', bob, body);
        assert.equal(theirs.status, 404, `${method}: ${theirs.text}`);
        assert.equal(theirs.body.error.message, NO_CHAT, method);
        assert.deepEqual(theirs.body.error.details, { code: 'not_found', hint: NO_CHAT_HINT }, method);
        assert.equal(theirs.text, nobody.text, `${method}: the same body, byte for byte, as for an ID nobody has`);
      }

      // Nothing of it changed, and its admin still has it.
      const row = await strapi.documents(CONVERSATION).findOne({ documentId: mine });
      assert.equal(row.title, 'Only Alice reads this');
      assert.equal(row.adminUserId, alice.id);
      const opened = await request('GET', `/maison/conversations/${mine}`, alice);
      assert.equal(opened.status, 200, opened.text);
      assert.equal(opened.body.conversation.title, 'Only Alice reads this');
    });

    it("lists only the signed-in admin's own chats", async () => {
      const alice = await assistantAdmin('lists-alice');
      const bob = await assistantAdmin('lists-bob');
      const aliceChats = [await saveChat(alice, 'Alice 1'), await saveChat(alice, 'Alice 2')];
      const bobChats = [await saveChat(bob, 'Bob 1')];
      const idsOf = async (who) => (await request('GET', '/maison/conversations', who)).body.conversations.map((chat) => chat.documentId).sort();
      assert.deepEqual(await idsOf(alice), aliceChats.sort());
      assert.deepEqual(await idsOf(bob), bobChats);
    });

    it('answers 403 to an admin without the permission and 401 to nobody, on all five routes, and changes nothing', async () => {
      const alice = await assistantAdmin('gate-alice');
      const mine = await saveChat(alice, 'Gate chat');
      const chatsBefore = await strapi.documents(CONVERSATION).count();
      const routes = [
        ['GET', '/maison/conversations'],
        ['POST', '/maison/conversations', { title: 'x', messages: CHAT }],
        ['GET', `/maison/conversations/${mine}`],
        ['PUT', `/maison/conversations/${mine}`, { title: 'Renamed by someone without the permission' }],
        ['DELETE', `/maison/conversations/${mine}`],
      ];
      for (const [method, path, body] of routes) {
        // The demo manager holds a Maison permission, but not the assistant's.
        const denied = await request(method, path, manager, body);
        const anonymous = await request(method, path, null, body);
        assert.equal(denied.status, 403, `${method} ${path}: ${denied.text}`);
        assert.equal(anonymous.status, 401, `${method} ${path}: ${anonymous.text}`);
        // Neither learns whether the ID is there: the answer is the one an ID nobody has gets.
        if (path.includes(mine)) {
          const unknownPath = path.replace(mine, 'no-such-chat');
          assert.equal(denied.text, (await request(method, unknownPath, manager, body)).text, `${method}: 403 for an ID nobody has`);
          assert.equal(anonymous.text, (await request(method, unknownPath, null, body)).text, `${method}: 401 for an ID nobody has`);
        }
      }
      assert.equal(await strapi.documents(CONVERSATION).count(), chatsBefore, 'nothing was saved or deleted');
      assert.equal((await strapi.documents(CONVERSATION).findOne({ documentId: mine })).title, 'Gate chat');
    });

    it('answers 413 to a body over 1 MB and saves nothing, and takes one just under it', async () => {
      const alice = await assistantAdmin('limit-alice');
      const mine = await saveChat(alice, 'Limit chat');
      const chatsBefore = await strapi.documents(CONVERSATION).count();
      // Strapi's body limit is 1 MB, which is 1,048,576 bytes: a message of 1,100,000 characters is over it, and one of 1,000,000 is under.
      const bodyOf = (characters) => ({ title: 'Big', messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', content: 'x'.repeat(characters) }] }] });

      const created = await request('POST', '/maison/conversations', alice, bodyOf(1_100_000));
      assert.equal(created.status, 413, created.text.slice(0, 200));
      const saved = await request('PUT', `/maison/conversations/${mine}`, alice, bodyOf(1_100_000));
      assert.equal(saved.status, 413, saved.text.slice(0, 200));
      assert.equal(await strapi.documents(CONVERSATION).count(), chatsBefore, 'nothing was saved');
      assert.deepEqual((await strapi.documents(CONVERSATION).findOne({ documentId: mine })).messages, { v: 1, messages: CHAT }, 'the chat is as it was');

      const nearly = await request('POST', '/maison/conversations', alice, bodyOf(1_000_000));
      assert.equal(nearly.status, 201, nearly.text.slice(0, 200));
      const opened = await request('GET', `/maison/conversations/${nearly.body.conversation.documentId}`, alice);
      assert.equal(opened.status, 200);
      assert.equal(opened.body.conversation.messages[0].parts[0].content.length, 1_000_000);
    });

    it("is cleared by POST /maison/demo/reset, pressed by an admin who holds only the demo permission: every admin's chats go", async () => {
      const alice = await assistantAdmin('reset-alice');
      const bob = await assistantAdmin('reset-bob');
      const aliceChat = await saveChat(alice, 'Alice before the reset');
      await saveChat(alice, 'Alice again');
      await saveChat(bob, 'Bob before the reset');
      const chatsBefore = await strapi.documents(CONVERSATION).count();
      assert.ok(chatsBefore >= 3, 'there are chats to clear');

      // Reset deletes every admin's chats, so it is for the demo permission only: an admin who may just use the assistant gets 403, and nobody signed in gets 401.
      assert.equal((await request('POST', '/maison/demo/reset', alice)).status, 403);
      assert.equal((await request('POST', '/maison/demo/reset', null)).status, 401);
      assert.equal(await strapi.documents(CONVERSATION).count(), chatsBefore, 'the chats are still there');

      const reset = await request('POST', '/maison/demo/reset', manager);
      assert.equal(reset.status, 200, reset.text);
      // The answer counts the demo requests, questions and inquiries, and not the chats.
      assert.deepEqual(Object.keys(reset.body).sort(), ['appointments', 'inquiries', 'knowledge', 'notifications', 'questions']);

      assert.equal(await strapi.documents(CONVERSATION).count(), 0);
      for (const who of [alice, bob]) assert.deepEqual((await request('GET', '/maison/conversations', who)).body, { conversations: [] });
      assert.equal((await request('GET', `/maison/conversations/${aliceChat}`, alice)).status, 404);
    });
  });
});
