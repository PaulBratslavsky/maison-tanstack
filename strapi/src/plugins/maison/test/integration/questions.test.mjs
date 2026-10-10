import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, SUBJECT_B, bootStrapi } from './harness.mjs';

const TOKEN = 'maison-test-channel-token';
const QUESTION = 'plugin::maison.question';
const KNOWLEDGE = 'plugin::maison.knowledge';
const SENT = { sentMessages: [{ id: '1', quoteToken: 'q' }] };
const ASKED = 'Can the coffret hold a watch?';
const ANSWER = 'Yes, a watch up to 42 mm fits.';

/**
 * LINE's Messaging API on a free port of this machine. It keeps every request, and answers a customer's profile with a
 * display name and every push with `SENT`. Nothing here reaches LINE, so nothing reaches a phone.
 */
const startLineStub = async () => {
  const requests = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        body: JSON.parse(raw || 'null'),
      });
      const isProfile = request.method === 'GET' && request.url.startsWith('/v2/bot/profile/');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(isProfile ? { displayName: 'Paul (test)' } : SENT));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

describe('customer questions, from the hand-off to product knowledge', () => {
  let strapi;
  let line;
  let questions;
  /** The question the tests below follow, one step at a time: each one needs the one before it. */
  let reference;
  let knowledgeDocumentId;

  /** What the stand-in received as pushes, in order. */
  const pushes = () => line.requests.filter((request) => request.method === 'POST' && request.url === '/v2/bot/message/push');
  const stored = () => strapi.documents(QUESTION).findFirst({ filters: { reference: { $eq: reference } } });
  const listed = async (filters) => {
    const result = await questions.list(filters);
    assert.equal(result.ok, true, JSON.stringify(result));
    const view = result.value.find((row) => row.reference === reference);
    assert.ok(view, `the list has ${reference}`);
    return view;
  };

  before(async () => {
    line = await startLineStub();
    strapi = await bootStrapi('questions', {
      maisonConfig: { lineChannelAccessToken: TOKEN, lineApiBaseUrl: line.url },
    });
    await strapi.plugin('maison').service('seed').loadDemoCatalog();
    questions = strapi.plugin('maison').service('questions');
  });

  after(async () => {
    await strapi?.destroy();
    await line?.close();
  });

  it("records a hand-off about a piece, with the customer's LINE name", async () => {
    const result = await questions.ask({
      subject: SUBJECT_A, question: ASKED, reason: 'no_answer', productSlug: 'jewelry-coffret', locale: 'en',
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    reference = result.value.reference;
    assert.match(reference, /^Q-\d{4}$/);
    assert.deepEqual(result.value, { reference, status: 'open', product: { slug: 'jewelry-coffret', name: 'Jewelry Coffret' } });

    const row = await stored();
    assert.equal(row.customerName, 'Paul (test)');
    assert.equal(row.status, 'open');
    assert.equal(row.language, 'en');
    assert.equal(row.productSlug, 'jewelry-coffret');
    // The only call to LINE was for the name, with Strapi's token. Nothing was pushed.
    assert.equal(line.requests.length, 1, JSON.stringify(line.requests));
    assert.equal(line.requests[0].url, `/v2/bot/profile/${SUBJECT_A.slice('line:'.length)}`);
    assert.equal(line.requests[0].authorization, `Bearer ${TOKEN}`);
    assert.equal(pushes().length, 0);
  });

  it("lists it for staff: the customer masked, with the piece's English name", async () => {
    const view = await listed();
    assert.equal(view.customer, 'line:Uaaa…aa');
    assert.equal(view.customerName, 'Paul (test)');
    assert.equal(view.question, ASKED);
    assert.equal(view.status, 'open');
    assert.equal(view.language, 'en');
    assert.deepEqual(view.product, { slug: 'jewelry-coffret', name: 'Jewelry Coffret' });
    assert.equal(view.line, null);
    assert.equal(
      JSON.stringify(await questions.list()).includes(SUBJECT_A.slice('line:U'.length)),
      false,
      "the customer's full LINE ID is nowhere in the list"
    );
  });

  it('answers the same reference, and records nothing, when the customer asks the same question again', async () => {
    const again = await questions.ask({
      subject: SUBJECT_A, question: `  CAN the coffret\n hold a   watch? `, reason: 'no_answer', productSlug: 'jewelry-coffret', locale: 'en',
    });
    assert.deepEqual(again, { ok: true, value: { reference, status: 'open', product: { slug: 'jewelry-coffret', name: 'Jewelry Coffret' } } });
    assert.equal(await strapi.documents(QUESTION).count({ filters: { customer: { $eq: SUBJECT_A } } }), 1, 'there is still one question');
    assert.equal(line.requests.length, 1, 'it asked LINE for nothing: the only call is the name, from the first hand-off');
  });

  it("Let them know pushes the customer one text message in Jane's name, and the question is taken", async () => {
    const outcome = await questions.notify(reference, 'Jane');
    assert.deepEqual(outcome, { reference, status: 'sent', message: `Sent the LINE message for ${reference}.` });

    const sent = pushes();
    assert.equal(sent.length, 1, JSON.stringify(sent));
    const [push] = sent;
    assert.equal(push.authorization, `Bearer ${TOKEN}`);
    assert.match(push.contentType, /^application\/json/);
    assert.equal(push.body.to, SUBJECT_A.slice('line:'.length));
    assert.equal(push.body.messages.length, 1);
    const [message] = push.body.messages;
    assert.equal(message.type, 'text');
    assert.ok(message.text.includes(`"${ASKED}"`), 'it quotes the question');
    assert.ok(message.text.includes('Jane, Maison'), "it is signed with Jane's name");

    const row = await stored();
    assert.equal(row.status, 'taken');
    assert.equal(row.staffName, 'Jane');
    assert.equal(row.lineOutcome, 'sent');
    assert.equal(row.lineDetail ?? '', '');
    assert.ok(row.takenAt, 'it says when');
    const view = await listed();
    assert.equal(view.status, 'taken');
    assert.equal(view.staffName, 'Jane');
    assert.deepEqual(view.line, { outcome: 'sent', detail: '' });
  });

  it('a second Let them know sends nothing: already_taken', async () => {
    const second = await questions.notify(reference, 'Tom');
    assert.equal(second.status, 'already_taken', JSON.stringify(second));
    assert.equal(second.message, 'Jane has let the customer know already.');
    assert.equal(pushes().length, 1, 'the stand-in got nothing more');
  });

  it("Answer pushes the answer in Jane's name, and adds it to product knowledge in English, published", async () => {
    const outcome = await questions.answer(reference, { text: ANSWER, addToKnowledge: true, category: 'sizing' }, 'Jane');
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.equal(outcome.message, `Sent the answer to ${reference} on LINE. Added it to product knowledge.`);
    assert.ok(outcome.knowledgeDocumentId, 'it names the knowledge entry');
    knowledgeDocumentId = outcome.knowledgeDocumentId;

    const sent = pushes();
    assert.equal(sent.length, 2, 'the answer is the second push');
    assert.equal(sent[1].body.to, SUBJECT_A.slice('line:'.length));
    const [message] = sent[1].body.messages;
    assert.equal(message.type, 'text');
    assert.ok(message.text.includes(ANSWER), 'it carries the answer');
    assert.ok(message.text.includes('Jane, Maison'), "it is signed with Jane's name");

    const row = await stored();
    assert.equal(row.status, 'answered');
    assert.equal(row.staffName, 'Jane');
    assert.equal(row.answer, ANSWER);
    assert.equal(row.knowledgeDocumentId, knowledgeDocumentId);
    assert.equal(row.lineOutcome, 'sent');
    const view = await listed({ status: 'answered' });
    assert.equal(view.status, 'answered');
    assert.equal(view.addedToKnowledge, true);

    const entry = await strapi.documents(KNOWLEDGE).findOne({ documentId: knowledgeDocumentId, locale: 'en', status: 'published' });
    assert.ok(entry, 'the entry has a published English version');
    assert.equal(entry.title, ASKED);
    assert.equal(entry.answer, ANSWER);
    assert.equal(entry.category, 'sizing');
    assert.deepEqual(entry.productSlugs, ['jewelry-coffret']);
  });

  it('the next customer who asks about the coffret gets that answer from product knowledge', async () => {
    const result = await strapi
      .plugin('maison')
      .service('catalog')
      .searchKnowledge('en', { query: 'Will a watch fit in the coffret?', productSlugs: ['jewelry-coffret'] });
    assert.equal(result.ok, true, JSON.stringify(result));
    const titles = result.value.entries.map((entry) => entry.title);
    const entry = result.value.entries.find((candidate) => candidate.title === ASKED);
    assert.ok(entry, `the entries found are ${JSON.stringify(titles)}`);
    assert.equal(entry.answer, ANSWER);
    assert.deepEqual(entry.productSlugs, ['jewelry-coffret']);
  });

  it("Answer with a title of its own gives the entry that title, and the customer's own words stay out of product knowledge", async () => {
    // The first question is answered, so this one is not a repeat of it.
    const asked = await questions.ask({
      subject: SUBJECT_A, question: 'My name is Paul. Can the coffret be engraved?', reason: 'no_answer', productSlug: 'jewelry-coffret', locale: 'en',
    });
    assert.equal(asked.ok, true, JSON.stringify(asked));
    assert.notEqual(asked.value.reference, reference, 'a new question');

    const outcome = await questions.answer(
      asked.value.reference,
      { text: 'Yes, with up to three initials.', addToKnowledge: true, category: 'personalization', title: 'Can the coffret be engraved?' },
      'Jane'
    );
    assert.equal(outcome.status, 'sent', JSON.stringify(outcome));
    assert.ok(outcome.knowledgeDocumentId, 'it names the knowledge entry');

    const entry = await strapi.documents(KNOWLEDGE).findOne({ documentId: outcome.knowledgeDocumentId, locale: 'en', status: 'published' });
    assert.ok(entry, 'the entry has a published English version');
    assert.equal(entry.title, 'Can the coffret be engraved?');
    assert.equal(entry.answer, 'Yes, with up to three initials.');
    assert.equal([entry.title, entry.answer, entry.keywords].join(' ').includes('Paul'), false, 'nothing of the customer is in the entry');
    // The customer's own message still quotes their words.
    const [message] = pushes().at(-1).body.messages;
    assert.ok(message.text.includes('"My name is Paul. Can the coffret be engraved?"'), 'it quotes the question as asked');
    assert.ok(message.text.includes('Yes, with up to three initials.'), 'it carries the answer');
  });

  it('refuses a customer’s sixth question while five are still open: too_many_open_questions', async () => {
    const results = [];
    for (let number = 1; number <= 6; number += 1) {
      results.push(await questions.ask({ subject: SUBJECT_B, question: `Question number ${number}?`, reason: 'no_answer', locale: 'en' }));
    }
    assert.deepEqual(results.map((result) => result.ok), [true, true, true, true, true, false], JSON.stringify(results));
    assert.equal(results[5].code, 'too_many_open_questions');
  });
});
