import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, bootStrapi } from './harness.mjs';

const INQUIRY = 'plugin::maison.inquiry';
const TOKEN = 'maison-test-channel-token';
const SENT = { sentMessages: [{ id: '1', quoteToken: 'q' }] };
/** What LINE says of this month's messages: how many were sent, and the most the channel may send. */
const USAGE = { totalUsage: 12 };
const QUOTA = { type: 'limited', value: 200 };

// The three turns of the first sweep, and a fourth that a person labels before any sweep sees it.
const STRAP = 'The strap on my bag broke after a week.';
const DELIVERY = 'Do you deliver to Osaka by Friday?';
const ZIP = 'The zip of my coffret broke. Can someone call me about a repair?';
const CLASP = 'The clasp of my trunk broke on the first day.';
/** A turn that arrives with AI off: the sweep skips it, and a person labels it by hand. */
const SUNDAY = 'Are you open on Sunday?';
/** What staff send the customer who wrote CLASP: the text the page suggests for a complaint in English. */
const APOLOGY =
  "We're sorry about this, and thank you for telling us. A member of our team will look into it and reply in this chat with the next step.";

/**
 * LINE's Messaging API on a free port of this machine. It answers a customer's profile with a display name, the month's
 * message total and limit as `USAGE` and `QUOTA`, and every push with `SENT`. It keeps every request, and `pushes()` is
 * the pushes among them. Nothing here reaches LINE, so nothing reaches a phone.
 */
const startLineStub = async () => {
  const requests = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body: raw ? JSON.parse(raw) : null });
      const answer =
        request.method === 'GET' && request.url.startsWith('/v2/bot/profile/')
          ? { displayName: 'Paul (test)' }
          : request.method === 'GET' && request.url === '/v2/bot/message/quota'
            ? QUOTA
            : request.method === 'GET' && request.url === '/v2/bot/message/quota/consumption'
              ? USAGE
              : SENT;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(answer));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    pushes: () => requests.filter((request) => request.method === 'POST' && request.url === '/v2/bot/message/push'),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

/*
 * The labelling service is a stub in this phase: with AI off it marks pending rows skipped, and with a key it does nothing
 * yet. So staff label by hand here. The tests that label through a model come back in phase 5.
 */
describe('inquiries, labelled by hand and replied to on LINE', () => {
  let strapi;
  let line;
  let inquiries;
  let labelling;
  let reference;

  const stored = (message) => strapi.documents(INQUIRY).findFirst({ filters: { message: { $eq: message } } });
  const listed = async (filter) => {
    const result = await inquiries.list({ filter });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value;
  };
  const logTurn = async (turn) => {
    const result = await inquiries.log({ subject: SUBJECT_A, locale: 'en', ...turn });
    assert.deepEqual(result, { ok: true, value: { logged: true } });
  };

  before(async () => {
    line = await startLineStub();
    // No aiApiKey and no Ollama host: AI is off, as the harness leaves it.
    strapi = await bootStrapi('inquiries', { maisonConfig: { lineChannelAccessToken: TOKEN, lineApiBaseUrl: line.url } });
    inquiries = strapi.plugin('maison').service('inquiries');
    labelling = strapi.plugin('maison').service('labelling');
  });

  after(async () => {
    await strapi?.destroy();
    await line?.close();
  });

  it('logs a complaint, a question nobody answered, and a hand-off with a real question', async () => {
    const asked = await strapi
      .plugin('maison')
      .service('questions')
      .ask({ subject: SUBJECT_A, question: 'Can someone call me about a repair?', reason: 'no_answer', locale: 'en' });
    assert.equal(asked.ok, true, JSON.stringify(asked));
    reference = asked.value.reference;

    await logTurn({ message: STRAP, reply: 'I am sorry to hear that.', knowledgeFound: false, handedOff: false });
    await logTurn({ message: DELIVERY, knowledgeFound: false, handedOff: false });
    await logTurn({ message: ZIP, reply: 'A member of our team will answer you here.', knowledgeFound: false, handedOff: true, questionReference: reference });

    for (const message of [STRAP, DELIVERY, ZIP]) {
      const row = await stored(message);
      assert.equal(row.analysisStatus, 'pending', message);
      assert.equal(row.humanCorrected, false, message);
      assert.equal(row.kind ?? null, null, message);
    }
    // Only the hand-off needs an answer before any label.
    assert.deepEqual(await inquiries.summary(), { needsAnswer: 1, complaint: 0, praise: 0, notLabelled: 3 });
  });

  it('marks the three skipped while AI is off', async () => {
    const result = await labelling.sweep();

    assert.deepEqual(result, { labelled: 0, failed: 0, skipped: 3 });
    for (const message of [STRAP, DELIVERY, ZIP]) assert.equal((await stored(message)).analysisStatus, 'skipped', message);
    // Skipped rows still wait under Not labelled.
    assert.deepEqual(await inquiries.summary(), { needsAnswer: 1, complaint: 0, praise: 0, notLabelled: 3 });
  });

  it('staff label them by hand, and each lands in the queue the rule gives it', async () => {
    const complaint = await inquiries.changeLabel((await stored(STRAP)).documentId, { kind: 'complaint', sentimentLabel: 'negative' });
    assert.equal(complaint.ok, true, JSON.stringify(complaint));
    assert.equal(complaint.value.queue, 'complaint');
    const question = await inquiries.changeLabel((await stored(DELIVERY)).documentId, { kind: 'question' });
    assert.equal(question.ok, true, JSON.stringify(question));
    assert.equal(question.value.queue, 'needs-answer');
    // A hand-off is in Needs an answer whatever its kind is: it is answered under Questions.
    const handOff = await inquiries.changeLabel((await stored(ZIP)).documentId, { kind: 'complaint' });
    assert.equal(handOff.ok, true, JSON.stringify(handOff));
    assert.equal(handOff.value.queue, 'needs-answer');
    assert.equal((await stored(ZIP)).questionReference, reference);

    const row = await stored(STRAP);
    assert.equal(row.kind, 'complaint');
    assert.equal(row.sentimentLabel, 'negative');
    assert.equal(row.humanCorrected, true);
    assert.equal(row.analysisStatus, 'skipped', 'only the sweep says whether AI was on');
  });

  it('counts them for the cards, and lists them under their queues', async () => {
    assert.deepEqual(await inquiries.summary(), { needsAnswer: 2, complaint: 1, praise: 0, notLabelled: 0 });

    const needsAnswer = await listed('needs-answer');
    assert.deepEqual(needsAnswer.map((view) => view.message).sort(), [DELIVERY, ZIP].sort());
    assert.deepEqual((await listed('complaint')).map((view) => view.message), [STRAP]);
    assert.deepEqual(await listed('not-labelled'), []);
    const handOff = needsAnswer.find((view) => view.message === ZIP);
    assert.deepEqual(handOff.question, { reference, status: 'open' });
  });

  it('a second sweep has nothing to do', async () => {
    assert.deepEqual(await labelling.sweep(), { labelled: 0, failed: 0, skipped: 0 });
  });

  it('Change label moves the complaint to praise and marks it corrected, and a sweep leaves it alone', async () => {
    const complaint = await stored(STRAP);
    const changed = await inquiries.changeLabel(complaint.documentId, { kind: 'praise' });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    assert.equal(changed.value.kind, 'praise');
    assert.equal(changed.value.queue, 'praise');
    assert.equal(changed.value.humanCorrected, true);
    assert.deepEqual(await inquiries.summary(), { needsAnswer: 2, complaint: 0, praise: 1, notLabelled: 0 });

    assert.deepEqual(await labelling.sweep(), { labelled: 0, failed: 0, skipped: 0 });

    const row = await stored(STRAP);
    assert.equal(row.kind, 'praise');
    assert.equal(row.queue, 'praise');
    assert.equal(row.humanCorrected, true);
  });

  it('a row a person labels before the sweep sees it leaves Not labelled, and the sweep with AI off marks it skipped and keeps the label', async () => {
    await logTurn({ message: CLASP, reply: 'I am sorry to hear that.', knowledgeFound: false, handedOff: false });
    assert.deepEqual(await inquiries.summary(), { needsAnswer: 2, complaint: 0, praise: 1, notLabelled: 1 });

    const clasp = await stored(CLASP);
    const changed = await inquiries.changeLabel(clasp.documentId, { kind: 'complaint' });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    // Change label leaves the status as it is: only the sweep says whether AI was on.
    assert.equal(changed.value.analysisStatus, 'pending');
    assert.deepEqual(await inquiries.summary(), { needsAnswer: 2, complaint: 1, praise: 1, notLabelled: 0 });

    // With AI off the sweep marks every pending row skipped, a labelled one too: `skipped` says only that AI was off.
    assert.deepEqual(await labelling.sweep(), { labelled: 0, failed: 0, skipped: 1 });

    const row = await stored(CLASP);
    assert.equal(row.analysisStatus, 'skipped');
    assert.equal(row.kind, 'complaint');
    assert.equal(row.humanCorrected, true);
    assert.equal(row.reason ?? null, null, 'no model gave a reason');
  });

  it("Reply on LINE to the complaint pushes one message to the stand-in, with the spec's text, and records it", async () => {
    const clasp = await stored(CLASP);
    assert.equal(line.pushes().length, 0, 'nothing was pushed before the reply');

    const outcome = await inquiries.reply(clasp.documentId, APOLOGY, 'Paul');

    assert.deepEqual(outcome, { documentId: clasp.documentId, status: 'sent', message: 'Sent the reply on LINE.' });
    assert.equal(line.pushes().length, 1);
    const [push] = line.pushes();
    assert.equal(push.authorization, `Bearer ${TOKEN}`);
    assert.equal(push.body.to, SUBJECT_A.slice('line:'.length), 'the customer on the row, without the line: prefix');
    assert.deepEqual(push.body.messages, [{ type: 'text', text: `About your message: "${CLASP}"\n\n${APOLOGY}\n\nMaison` }]);

    const row = await stored(CLASP);
    assert.equal(row.status, 'replied');
    assert.equal(row.replyText, APOLOGY);
    assert.equal(row.repliedBy, 'Paul');
    assert.ok(row.repliedAt, 'it says when');
    assert.equal(row.lineOutcome, 'sent');
    // It has left Complaints, and the other counts are as they were.
    assert.deepEqual(await inquiries.summary(), { needsAnswer: 2, complaint: 0, praise: 1, notLabelled: 0 });
    const all = await listed('all');
    assert.deepEqual(all.find((view) => view.message === CLASP).line, { outcome: 'sent', detail: null });
  });

  it('a second reply to it is refused with already_replied, and pushes nothing more', async () => {
    const clasp = await stored(CLASP);

    const outcome = await inquiries.reply(clasp.documentId, 'Another reply.', 'Paul');

    assert.deepEqual(outcome, { documentId: clasp.documentId, status: 'already_replied', message: 'This inquiry has been replied to already.' });
    assert.equal(line.pushes().length, 1);
    assert.equal((await stored(CLASP)).replyText, APOLOGY);
  });

  it('a reply to the hand-off is refused with use_question, and pushes nothing: it is answered under Questions', async () => {
    const handOff = await stored(ZIP);

    const outcome = await inquiries.reply(handOff.documentId, 'We will call you.', 'Paul');

    assert.deepEqual(outcome, { documentId: handOff.documentId, status: 'use_question', message: `Answer it under Questions (${reference}).` });
    assert.equal(line.pushes().length, 1, 'still only the first reply');
    const row = await stored(ZIP);
    assert.equal(row.status, 'open');
    assert.equal(row.replyText ?? null, null);
  });

  it("answers that LINE is set up, with the month's total and limit from the stand-in, asked with the token", async () => {
    assert.deepEqual(await inquiries.quota(), { configured: true, used: 12, limit: 200 });

    const asked = line.requests.filter((request) => request.url.startsWith('/v2/bot/message/quota'));
    assert.deepEqual(asked.map((request) => `${request.method} ${request.url}`).sort(), [
      'GET /v2/bot/message/quota',
      'GET /v2/bot/message/quota/consumption',
    ]);
    for (const request of asked) assert.equal(request.authorization, `Bearer ${TOKEN}`);
  });

  it('answers that LINE is not set up, and asks it nothing, when Strapi has no channel access token', async () => {
    const before = line.requests.length;
    strapi.config.set('plugin::maison.lineChannelAccessToken', null);
    try {
      assert.deepEqual(await inquiries.quota(), { configured: false, used: null, limit: null });
      assert.equal(line.requests.length, before, 'the stand-in got no request');
    } finally {
      strapi.config.set('plugin::maison.lineChannelAccessToken', TOKEN);
    }
  });

  // The README's AI-off path: with no key, Change label is the only way to label, and Question is the likeliest pick.
  it('with AI off, a skipped row a person labels Question lands in Needs an answer, where a sentiment alone could not have put it', async () => {
    await logTurn({ message: SUNDAY, reply: 'I am not sure.', knowledgeFound: false, handedOff: false });
    assert.deepEqual(await labelling.sweep(), { labelled: 0, failed: 0, skipped: 1 });
    const skipped = await stored(SUNDAY);
    assert.equal(skipped.analysisStatus, 'skipped');
    assert.equal(skipped.queue, 'none');
    assert.deepEqual(await inquiries.summary(), { needsAnswer: 2, complaint: 0, praise: 1, notLabelled: 1 });

    // A sentiment alone would leave a row with no kind in no queue and out of Not labelled: it is refused, and nothing changes.
    const refused = await inquiries.changeLabel(skipped.documentId, { sentimentLabel: 'neutral' });
    assert.equal(refused.ok, false, JSON.stringify(refused));
    assert.equal(refused.code, 'invalid_input');
    assert.equal(refused.message, 'Pick a kind too.');
    assert.equal((await stored(SUNDAY)).humanCorrected, false);
    assert.deepEqual(await inquiries.summary(), { needsAnswer: 2, complaint: 0, praise: 1, notLabelled: 1 });

    const changed = await inquiries.changeLabel(skipped.documentId, { kind: 'question' });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    assert.equal(changed.value.kind, 'question');
    assert.equal(changed.value.answered, null, 'a person gave no answered value');
    assert.equal(changed.value.queue, 'needs-answer');
    assert.equal(changed.value.analysisStatus, 'skipped', 'only the sweep says whether AI was on');

    const row = await stored(SUNDAY);
    assert.equal(row.queue, 'needs-answer');
    assert.equal(row.humanCorrected, true);
    assert.deepEqual(await inquiries.summary(), { needsAnswer: 3, complaint: 0, praise: 1, notLabelled: 0 });
    assert.deepEqual((await listed('needs-answer')).map((view) => view.message).sort(), [DELIVERY, SUNDAY, ZIP].sort());
    assert.deepEqual(await listed('not-labelled'), []);
  });

  it('with a key set, the stub does nothing yet: a new turn stays pending until phase 5 labels it', async () => {
    await logTurn({ message: STRAP, reply: 'Another reply.', knowledgeFound: false, handedOff: false });
    strapi.config.set('plugin::maison.aiApiKey', 'a-key-for-a-test-that-reaches-no-model');
    try {
      assert.deepEqual(await labelling.sweep(), { labelled: 0, failed: 0, skipped: 0 });
      const rows = await strapi.documents(INQUIRY).findMany({ filters: { message: { $eq: STRAP }, analysisStatus: { $eq: 'pending' } } });
      assert.equal(rows.length, 1);
    } finally {
      strapi.config.set('plugin::maison.aiApiKey', null);
    }
  });
});
