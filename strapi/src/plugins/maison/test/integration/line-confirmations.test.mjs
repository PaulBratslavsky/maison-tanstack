import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, SUBJECT_B, bootStrapi, tokyoDate, tokyoTime } from './harness.mjs';

const LIFF_URL = 'https://liff.line.me/1234567890-AbCdEfGh';
const TOKEN = 'maison-test-channel-token';
const DAY_MS = 24 * 60 * 60 * 1000;
const APPOINTMENT = 'plugin::maison.appointment';
const NOTIFICATION = 'plugin::maison.notification';
const SENT = { sentMessages: [{ id: '1', quoteToken: 'q' }] };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A visit `days` from today at `time` (HH:MM) in Tokyo. Strapi sends no confirmation for a visit that's over, by the
 * real clock, so the suite books against it and never expires. Ginza is open 11:00 to 20:00 every day.
 */
const visit = (days, time) => tokyoTime(tokyoDate(days), time);

/** Polls `predicate` until it holds, and fails once `timeoutMs` has passed. */
const waitFor = async (predicate, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Still waiting after ${timeoutMs} ms`);
    await sleep(50);
  }
};

/** LINE's Messaging API on a free port of this machine: it keeps every request and answers as told, 200 by default. */
const startLineStub = async () => {
  const requests = [];
  let answer = { status: 200, body: SENT };
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
      response.writeHead(answer.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    answerWith: (status, body) => {
      answer = { status, body };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

describe('LINE confirmations sent by Strapi', () => {
  let strapi;
  let line;

  /** A customer's request for `requestedFor` at Ginza, made at `now` (the current time by default). Returns its reference. */
  const request = async (subject, requestedFor, now = new Date()) => {
    const result = await strapi.plugin('maison').service('appointments').request({
      subject, boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor, createdVia: 'app', now,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value.reference;
  };
  /** What the stub received for `reference`: the pushes whose message names it. */
  const pushesFor = (reference) => line.requests.filter((push) => push.body?.messages?.[0]?.altText?.includes(reference));
  const notificationsFor = (reference) =>
    strapi.documents(NOTIFICATION).findMany({ filters: { appointmentReference: { $eq: reference } }, sort: 'sentAt:asc' });

  /** One push of a flex message for `reference` to `subject`'s LINE user, with the configured token. */
  const assertOnePush = (reference, subject) => {
    const pushes = pushesFor(reference);
    assert.equal(pushes.length, 1, JSON.stringify(pushes));
    const [push] = pushes;
    assert.equal(push.method, 'POST');
    assert.equal(push.url, '/v2/bot/message/push');
    assert.equal(push.authorization, `Bearer ${TOKEN}`);
    assert.match(push.contentType, /^application\/json/);
    assert.equal(push.body.to, subject.slice('line:'.length));
    assert.equal(push.body.messages.length, 1);
    const [message] = push.body.messages;
    assert.equal(message.type, 'flex');
    assert.equal(message.altText, `ご来店予約が確定しました（${reference}）`);
    assert.equal(message.contents.type, 'bubble');
    assert.ok(JSON.stringify(message.contents).includes(`${LIFF_URL}/visits/${reference}`), 'its button opens the visit in the app');
  };

  /** One notification for `reference`: sent, by Strapi. */
  const assertRecordedSent = async (reference) => {
    const rows = await notificationsFor(reference);
    assert.deepEqual(rows.map((row) => [row.outcome, row.recordedBy, row.channel]), [['sent', 'strapi', 'line']]);
    assert.deepEqual(JSON.parse(rows[0].detail), SENT, "LINE's answer is the detail");
  };

  before(async () => {
    line = await startLineStub();
    process.env.MAISON_LIFF_URL = LIFF_URL;
    strapi = await bootStrapi('line-confirmations', {
      maisonConfig: { liffUrl: LIFF_URL, lineChannelAccessToken: TOKEN, lineApiBaseUrl: line.url },
    });
    await strapi.plugin('maison').service('seed').loadDemoCatalog();
  });

  after(async () => {
    await strapi?.destroy();
    await line?.close();
    delete process.env.MAISON_LIFF_URL;
  });

  it("confirming through the service pushes the customer one flex message, and records it as sent before it answers", async () => {
    const reference = await request(SUBJECT_A, visit(10, '14:00'));
    const confirmed = await strapi.plugin('maison').service('appointments').confirm(reference);
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
    assertOnePush(reference, SUBJECT_A);
    await assertRecordedSent(reference);
    assert.equal(confirmed.value.appointment.confirmationSent, true, "confirm's answer already shows it as sent");
  });

  it("confirming a visit booked in English pushes its confirmation in English, with the seed's English names", async () => {
    const subject = `line:U${'c'.repeat(32)}`; // a customer of its own, so the other tests' open requests stay as they are
    const booked = await strapi.plugin('maison').service('appointments').request({
      subject, boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: visit(10, '16:00'), createdVia: 'app', locale: 'en',
    });
    assert.equal(booked.ok, true, JSON.stringify(booked));
    const { reference } = booked.value;
    const confirmed = await strapi.plugin('maison').service('appointments').confirm(reference);
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));

    const pushes = pushesFor(reference);
    assert.equal(pushes.length, 1, JSON.stringify(pushes));
    const [push] = pushes;
    assert.equal(push.body.to, subject.slice('line:'.length));
    const [message] = push.body.messages;
    assert.equal(message.type, 'flex');
    assert.equal(message.altText, `Your visit is confirmed (${reference})`);
    const bubble = JSON.stringify(message.contents);
    for (const text of ['Maison', 'Your visit is confirmed', 'Ginza Flagship', '1-2-3 Ginza, Chuo-ku, Tokyo (demo)', 'Weekender 50', 'View your visit']) {
      assert.ok(bubble.includes(`"${text}"`), `the bubble says "${text}"`);
    }
    assert.match(bubble, /"(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec), 16:00"/, 'the date, in English');
    assert.ok(!bubble.includes('銀座本店'), "not the boutique's Japanese name");
    await assertRecordedSent(reference);
  });

  it("publishing inside a transaction, as the Content Manager's Publish does, sends once the transaction commits", async () => {
    const reference = await request(SUBJECT_B, visit(10, '15:00'));
    const draft = await strapi.documents(APPOINTMENT).findFirst({ status: 'draft', filters: { reference: { $eq: reference } } });
    await strapi.db.transaction(async () => {
      await strapi.documents(APPOINTMENT).publish({ documentId: draft.documentId });
      await sleep(300);
      assert.equal(pushesFor(reference).length, 0, 'nothing is pushed before the commit');
    });
    await waitFor(async () => (await notificationsFor(reference)).length > 0, 9000);
    assertOnePush(reference, SUBJECT_B);
    await assertRecordedSent(reference);
  });

  it('a transaction that publishes and then fails sends nothing, and leaves the visit unconfirmed', async () => {
    const reference = await request(SUBJECT_A, visit(12, '14:00'));
    const draft = await strapi.documents(APPOINTMENT).findFirst({ status: 'draft', filters: { reference: { $eq: reference } } });
    await assert.rejects(
      strapi.db.transaction(async () => {
        await strapi.documents(APPOINTMENT).publish({ documentId: draft.documentId });
        throw new Error('rolled back on purpose');
      }),
      /rolled back on purpose/
    );
    await sleep(500);
    assert.equal(pushesFor(reference).length, 0, 'no push');
    assert.deepEqual(await notificationsFor(reference), [], 'no notification');
    const published = await strapi.documents(APPOINTMENT).findFirst({ status: 'published', filters: { reference: { $eq: reference } } });
    assert.equal(published, null, 'no published version');
  });

  it('publishing a confirmed visit again sends nothing new', async () => {
    const reference = await request(SUBJECT_A, visit(11, '14:00'));
    const draft = await strapi.documents(APPOINTMENT).findFirst({ status: 'draft', filters: { reference: { $eq: reference } } });
    await strapi.documents(APPOINTMENT).publish({ documentId: draft.documentId });
    await strapi.documents(APPOINTMENT).publish({ documentId: draft.documentId });
    assertOnePush(reference, SUBJECT_A);
    await assertRecordedSent(reference);
  });

  it('publishing a visit that is over, as the Content Manager can, sends nothing', async () => {
    // Requested three days ago for two days ago, when it was still ahead.
    const reference = await request(SUBJECT_B, visit(-2, '14:00'), new Date(Date.now() - 3 * DAY_MS));
    const draft = await strapi.documents(APPOINTMENT).findFirst({ status: 'draft', filters: { reference: { $eq: reference } } });
    await strapi.documents(APPOINTMENT).publish({ documentId: draft.documentId });
    assert.equal(pushesFor(reference).length, 0, 'no push');
    assert.deepEqual(await notificationsFor(reference), [], 'no notification');
    assert.equal((await strapi.plugin('maison').service('line-confirmations').sendConfirmation(reference)).status, 'past');
  });

  it('records a refused push as failed, and Send again then delivers it once', async () => {
    const reference = await request(SUBJECT_B, visit(11, '15:00'));
    line.answerWith(400, { message: "The property, 'to', in the request body is invalid (line 1, column 6)" });
    try {
      assert.equal((await strapi.plugin('maison').service('appointments').confirm(reference)).ok, true);
    } finally {
      line.answerWith(200, SENT);
    }
    const [failed] = await notificationsFor(reference);
    assert.equal(failed.outcome, 'failed');
    assert.equal(failed.recordedBy, 'strapi');
    assert.equal(failed.detail, "LINE answered 400: The property, 'to', in the request body is invalid (line 1, column 6)");

    // What POST /maison/appointments/:reference/notify calls.
    const sender = strapi.plugin('maison').service('line-confirmations');
    assert.equal((await sender.sendConfirmation(reference)).status, 'sent');
    assert.equal((await sender.sendConfirmation(reference)).status, 'already_sent');
    assert.equal(pushesFor(reference).length, 2, 'the refused push, then the one that went out');
    const rows = await notificationsFor(reference);
    assert.deepEqual(rows.map((row) => row.outcome), ['failed', 'sent']);
  });
});
