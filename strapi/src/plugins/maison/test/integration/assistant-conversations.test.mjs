import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bootStrapi } from './harness.mjs';

const CONVERSATION = 'plugin::maison.conversation';
const NO_CHAT = 'There is no saved chat with that ID.';
const NO_CHAT_HINT = 'Reload the page: it may have been deleted.';
const NOT_SAVED = 'This chat could not be saved.';

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

/** What the controller makes of a body that is not an object, for the service to refuse. The routes and the controller come with task 2D. */
const asBody = (body) => (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {});

describe("the Ask tab's saved chats service, on a real Strapi", () => {
  let strapi;
  let chats;
  let seed;

  const stored = () => strapi.documents(CONVERSATION).findMany({ limit: 500 });

  before(async () => {
    strapi = await bootStrapi('assistant-conversations');
    chats = strapi.plugin('maison').service('conversations');
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
    const created = await chats.create(1, { title: '今日のお客様からの問い合わせは? 😀', messages: CHAT });
    assert.equal(created.ok, true, JSON.stringify(created));
    const { documentId, title } = created.value;
    assert.equal(title, '今日のお客様からの問い合わせは? 😀');
    assert.deepEqual(Object.keys(created.value).sort(), ['documentId', 'title', 'updatedAt']);

    const listed = await chats.list(1);
    assert.deepEqual(listed.map((chat) => chat.documentId), [documentId]);

    const opened = await chats.view(1, documentId);
    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.messages, CHAT);
    // A text part keeps its metadata too: a text part that did not keep extra keys would lose it on save, with no error.
    assert.deepEqual(opened.value.messages[1].parts[1].metadata, { anthropic: { citations: [] } });
    // In the database it is the envelope.
    const row = await strapi.documents(CONVERSATION).findOne({ documentId });
    assert.deepEqual(row.messages, { v: 1, messages: CHAT });
    assert.equal(row.adminUserId, 1);
  });

  it("keeps one admin's chat from another: it is not in their list, and opening, saving and deleting it answer not_found, as an ID nobody has does", async () => {
    const mine = (await chats.create(11, { title: 'Mine', messages: CHAT })).value.documentId;

    assert.deepEqual(await chats.list(12), []);
    const refused = { ok: false, code: 'not_found', message: NO_CHAT, hint: NO_CHAT_HINT };
    for (const [name, run] of [
      ['view', (documentId) => chats.view(12, documentId)],
      ['update', (documentId) => chats.update(12, documentId, { title: 'Theirs now' })],
      ['remove', (documentId) => chats.remove(12, documentId)],
    ]) {
      const theirs = await run(mine);
      const nobody = await run('no-such-chat');
      assert.deepEqual(theirs, refused, name);
      assert.deepEqual(nobody, theirs, name);
    }

    // Nothing of it changed, and its admin still has it.
    const row = await strapi.documents(CONVERSATION).findOne({ documentId: mine });
    assert.equal(row.title, 'Mine');
    assert.equal(row.adminUserId, 11);
    assert.equal((await chats.view(11, mine)).ok, true);
  });

  it('takes the admin from the argument, never from the body', async () => {
    const created = await chats.create(13, { title: 'x', messages: CHAT, adminUserId: 99 });
    const row = await strapi.documents(CONVERSATION).findOne({ documentId: created.value.documentId });
    assert.equal(row.adminUserId, 13);
    await chats.update(13, row.documentId, { adminUserId: 99, title: 'y' });
    assert.equal((await strapi.documents(CONVERSATION).findOne({ documentId: row.documentId })).adminUserId, 13);
  });

  it('refuses a body that is not a chat with a staff text, and saves nothing', async () => {
    const before = (await stored()).length;
    for (const body of [undefined, 'hello', [], { title: 'x' }, { title: 'x', messages: 'hello' }, { title: 'x', messages: [{ id: 'm1', role: 'wizard', parts: [] }] }]) {
      const created = await chats.create(14, asBody(body));
      assert.equal(created.ok, false, JSON.stringify(body));
      assert.equal(created.message, NOT_SAVED);
      assert.equal(created.code, 'invalid_input');
    }
    assert.equal((await stored()).length, before);

    const id = (await chats.create(14, { title: 'Keep', messages: CHAT })).value.documentId;
    const bad = await chats.update(14, id, { title: 'Lost', messages: 'hello' });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'invalid_input');
    const row = await strapi.documents(CONVERSATION).findOne({ documentId: id });
    assert.equal(row.title, 'Keep');
    assert.deepEqual(row.messages, { v: 1, messages: CHAT });
  });

  it('lists the newest first: a chat saved again moves to the top', async () => {
    const admin = 15;
    const ids = [];
    for (const title of ['First', 'Second', 'Third']) {
      ids.push((await chats.create(admin, { title, messages: CHAT })).value.documentId);
      await sleep(15);
    }
    assert.deepEqual((await chats.list(admin)).map((chat) => chat.title), ['Third', 'Second', 'First']);

    await chats.update(admin, ids[0], { messages: [...CHAT, { id: 'u2', role: 'user', parts: [{ type: 'text', content: 'More' }] }] });
    assert.deepEqual((await chats.list(admin)).map((chat) => chat.title), ['First', 'Third', 'Second']);
  });

  it('lists at most 100 chats: the newest', async () => {
    const admin = 16;
    for (let index = 0; index < 101; index += 1) {
      await strapi.documents(CONVERSATION).create({ data: { title: `Chat ${String(index).padStart(3, '0')}`, messages: { v: 1, messages: [] }, adminUserId: admin } });
      // updatedAt has the precision of a millisecond: each chat gets a moment of its own, so "newest" has one answer.
      await sleep(2);
    }
    const conversations = await chats.list(admin);
    assert.equal(conversations.length, 100);
    assert.equal(conversations[0].title, 'Chat 100');
    assert.ok(!conversations.some((chat) => chat.title === 'Chat 000'));
  });

  it('cuts a long title to 80 characters, and never splits an emoji or a Japanese character', async () => {
    const created = await chats.create(17, { title: '😀'.repeat(100), messages: CHAT });
    assert.equal(created.value.title, '😀'.repeat(80));
    const japanese = '今日のお客様からの問い合わせを教えてください。'.repeat(5);
    const second = await chats.create(17, { title: japanese, messages: CHAT });
    assert.equal(Array.from(second.value.title).length, 80);
    assert.ok(japanese.startsWith(second.value.title));
  });

  it('opens a chat whose stored messages cannot be read as an empty chat, and leaves the stored value alone', async () => {
    const row = await strapi.documents(CONVERSATION).create({ data: { title: 'Damaged', messages: { v: 9, other: 'shape' }, adminUserId: 18 } });
    const opened = await chats.view(18, row.documentId);
    assert.equal(opened.ok, true);
    assert.deepEqual(opened.value.messages, []);
    assert.deepEqual((await strapi.documents(CONVERSATION).findOne({ documentId: row.documentId })).messages, { v: 9, other: 'shape' });
  });

  it('deletes a chat at once', async () => {
    const id = (await chats.create(19, { title: 'Gone', messages: CHAT })).value.documentId;
    const removed = await chats.remove(19, id);
    assert.deepEqual(removed, { ok: true, value: { documentId: id } });
    assert.equal(await strapi.documents(CONVERSATION).findOne({ documentId: id }), null);
  });

  it("is cleared by Reset demo activity: every admin's chats, and nothing else of the answer changes", async () => {
    assert.ok((await stored()).length > 0, 'there are chats to clear');
    assert.deepEqual(await seed.resetDemoAppointments(), { appointments: 0, notifications: 0, questions: 0, inquiries: 0, knowledge: 0 });
    assert.equal(await strapi.documents(CONVERSATION).count(), 0);
    assert.deepEqual(await chats.list(1), []);
  });
});
