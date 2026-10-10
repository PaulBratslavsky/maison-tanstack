import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, bootStrapi, tokyoDate, tokyoTime } from './harness.mjs';

const APPOINTMENT = 'plugin::maison.appointment';
const QUESTION = 'plugin::maison.question';
const INQUIRY = 'plugin::maison.inquiry';
const NOTIFICATION = 'plugin::maison.notification';
const BOUTIQUE = 'plugin::maison.boutique';
const STOCK_LEVEL = 'plugin::maison.stock-level';
const KNOWLEDGE = 'plugin::maison.knowledge';
const LIFF_URL = 'https://liff.line.me/1234567890-AbCdEfGh';
const TOKEN = 'maison-test-channel-token';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TOKYO_OFFSET_MS = 9 * HOUR_MS;
/** The five made-up customers' subjects, and how staff see them. */
const DEMO_SUBJECT = /^line:Udec0de0{25}[1-5]$/;
const isDemo = (masked) => /^line:Udec…0[1-5]$/.test(masked);
/** A full LINE user ID, anywhere in a text. */
const LINE_USER_ID = /U[0-9a-f]{32}/;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ADDED = { created: true, customers: 5, appointments: 5, confirmed: 2, questions: 5, inquiries: 10 };
const NOTHING = { created: false, customers: 0, appointments: 0, confirmed: 0, questions: 0, inquiries: 0 };

/** A moment on Tokyo's wall clock: its calendar date, its weekday and its minutes since midnight. */
const inTokyo = (iso) => {
  const shifted = new Date(Date.parse(iso) + TOKYO_OFFSET_MS);
  return { isoDate: shifted.toISOString().slice(0, 10), weekday: WEEKDAYS[shifted.getUTCDay()], minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
};
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Paul's own LINE account, as MAISON_DEMO_LINE_USER_ID gives it: a user ID made up for these tests. */
const PAUL_ID = `U${'5ca1ab1e'.repeat(4)}`;
const PAUL = `line:${PAUL_ID}`;
const PAUL_NAME = 'Paul (test)';
/** How long the stand-in takes to give Paul's display name, so a load that asks for it is still running a moment later. */
const PROFILE_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `predicate` until it holds, and fails once `timeoutMs` has passed. */
const waitFor = async (predicate, timeoutMs, what) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Still waiting for ${what} after ${timeoutMs} ms`);
    await sleep(100);
  }
};

/**
 * LINE's Messaging API on a free port of this machine. It keeps every request. It takes a push to Paul's account, and
 * refuses any other, as LINE refuses a user nobody has. It gives Paul's display name after PROFILE_DELAY_MS, and nobody
 * else's.
 */
const startLineStub = async () => {
  const requests = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', async () => {
      const body = JSON.parse(raw || 'null');
      requests.push({ method: request.method, url: request.url, body });
      if (request.method === 'GET' && request.url === `/v2/bot/profile/${PAUL_ID}`) {
        await sleep(PROFILE_DELAY_MS);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ userId: PAUL_ID, displayName: PAUL_NAME }));
        return;
      }
      const ok = request.method === 'POST' && body?.to === PAUL_ID;
      response.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(ok ? { sentMessages: [{ id: '1', quoteToken: 'q' }] } : { message: 'Failed to send messages' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
};

describe('Load demo activity', () => {
  let strapi;
  let seed;
  let line;
  let loadedAt;
  /** What Paul's own rehearsal left: one request, one question and one inquiry of a customer of his own. */
  const own = {};

  /** The demo customers' rows of a content type, read straight from the database, with every field. */
  const demoRows = async (uid, params = {}) =>
    (await strapi.documents(uid).findMany({ limit: 100, ...params })).filter((row) => DEMO_SUBJECT.test(row.customer));

  before(async () => {
    line = await startLineStub();
    process.env.MAISON_LIFF_URL = LIFF_URL;
    strapi = await bootStrapi('demo-activity', { maisonConfig: { liffUrl: LIFF_URL, lineChannelAccessToken: TOKEN, lineApiBaseUrl: line.url } });
    seed = strapi.plugin('maison').service('seed');
    await seed.loadDemoCatalog();

    const booked = await strapi.plugin('maison').service('appointments').request({
      subject: SUBJECT_A, boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: tokyoTime(tokyoDate(10), '14:00'), createdVia: 'app',
    });
    assert.equal(booked.ok, true, JSON.stringify(booked));
    own.appointment = booked.value.reference;
    own.question = (await strapi.documents(QUESTION).create({ data: { reference: 'Q-9001', customer: SUBJECT_A, question: 'Can I pay in bitcoin?', status: 'open' } })).documentId;
    await strapi.plugin('maison').service('inquiries').log({ subject: SUBJECT_A, message: 'Can I pay in bitcoin?', knowledgeFound: false, handedOff: false });
    own.inquiry = (await strapi.documents(INQUIRY).findFirst({ filters: { customer: { $eq: SUBJECT_A } } })).documentId;
    line.requests.length = 0;
  });

  after(async () => {
    await strapi?.destroy();
    await line?.close();
    delete process.env.MAISON_LIFF_URL;
  });

  it('adds five requests, five questions and ten inquiries from five made-up customers, and answers so', async () => {
    loadedAt = new Date();
    assert.deepEqual(await seed.loadDemoActivity(), { ok: true, value: ADDED });
    assert.equal((await demoRows(APPOINTMENT, { status: 'draft' })).length, 5);
    assert.equal((await demoRows(QUESTION)).length, 5);
    assert.equal((await demoRows(INQUIRY)).length, 10);
    assert.equal(new Set((await demoRows(QUESTION)).map((row) => row.customer)).size, 5, 'one question per customer');
  });

  it("makes three requests wait for staff and confirms two, recording a demo outcome for each with no LINE call", async () => {
    const { value: rows } = await strapi.plugin('maison').service('appointments').listRequests({ status: 'all', limit: 50 });
    const demo = rows.filter((row) => isDemo(row.customer));
    assert.equal(demo.length, 5);
    assert.equal(new Set(demo.map((row) => row.customer)).size, 5, 'one request per customer');
    assert.deepEqual(demo.map((row) => row.status).sort(), ['confirmed', 'confirmed', 'requested', 'requested', 'requested']);
    for (const row of demo) {
      assert.match(row.reference, /^APT-\d{4}$/);
      assert.equal(row.confirmationSent, false, `${row.reference}: not sent`);
      assert.equal(row.demoCustomer, true, `${row.reference}: a demo customer's`);
      assert.equal(row.yourLine, false, `${row.reference}: nobody's own LINE account without demoLineUserId`);
    }

    const confirmed = demo.filter((row) => row.status === 'confirmed').map((row) => row.reference);
    const notifications = await strapi.documents(NOTIFICATION).findMany({ filters: { appointmentReference: { $in: confirmed } } });
    assert.deepEqual(
      notifications.map((row) => [row.outcome, row.recordedBy, row.detail]),
      [['demo', 'strapi', 'Demo customer: no LINE message'], ['demo', 'strapi', 'Demo customer: no LINE message']]
    );
    assert.equal(await strapi.documents(NOTIFICATION).count({ filters: { outcome: { $eq: 'sent' } } }), 0, 'no record says sent');
    // The publish ran the confirmation hook, which skipped LINE for the made-up customers.
    assert.equal(line.requests.length, 0);

    const { value: waiting } = await strapi.plugin('maison').service('appointments').listRequests({ status: 'requested', limit: 50 });
    assert.equal(waiting.filter((row) => isDemo(row.customer)).length, 3, "the board's Waiting for staff view lists the three");
    // A demo outcome isn't pending: pending_confirmations lists neither confirmed visit.
    const pending = await strapi.plugin('maison').service('confirmations').listPending(50);
    assert.deepEqual(pending.value.filter((row) => confirmed.includes(row.reference)), []);
    // And "LINE sent" counts neither.
    assert.equal((await strapi.plugin('maison').service('appointments').summarizeRequests()).counts.confirmationsSent, 0);
  });

  it('gives no item to anyone but the five made-up customers without demoLineUserId', async () => {
    const owners = new Set();
    for (const uid of [APPOINTMENT, QUESTION, INQUIRY]) {
      for (const row of await strapi.documents(uid).findMany({ limit: 100 })) owners.add(row.customer);
    }
    owners.delete(SUBJECT_A); // Paul's rehearsal, from before the load
    assert.equal(owners.size, 5);
    for (const owner of owners) assert.match(owner, DEMO_SUBJECT);
  });

  it("books every visit 2 to 13 days ahead, on a half-hour inside its boutique's hours, never Osaka on a Tuesday, for pieces the boutique has", async () => {
    const hours = Object.fromEntries(
      (await strapi.documents(BOUTIQUE).findMany({ locale: 'ja', status: 'published' })).map((boutique) => [boutique.slug, boutique.openingHours])
    );
    const stock = await strapi.documents(STOCK_LEVEL).findMany({ limit: 100 });
    const { value: rows } = await strapi.plugin('maison').service('appointments').listRequests({ status: 'all', limit: 50 });
    const demo = rows.filter((row) => isDemo(row.customer));
    assert.deepEqual(new Set(demo.map((row) => row.boutique.slug)), new Set(['ginza', 'omotesando', 'osaka']));

    const today = Date.parse(`${inTokyo(loadedAt.toISOString()).isoDate}T00:00:00Z`);
    for (const row of demo) {
      const { isoDate, weekday, minutes } = inTokyo(row.requestedFor);
      const away = (Date.parse(`${isoDate}T00:00:00Z`) - today) / DAY_MS;
      assert.ok(away >= 2 && away <= 13, `${row.reference}: ${away} days ahead`);
      assert.equal(minutes % 30, 0, `${row.reference}: on a half-hour`);
      const day = hours[row.boutique.slug].find((entry) => entry.weekday === weekday);
      assert.ok(day, `${row.reference}: ${row.boutique.slug} is open on ${weekday}`);
      assert.ok(minutes >= toMinutes(day.opens) && minutes + 30 <= toMinutes(day.closes), `${row.reference}: inside ${day.opens}-${day.closes}`);
      if (row.boutique.slug === 'osaka') assert.notEqual(weekday, 'tue', `${row.reference}: Osaka is closed on Tuesdays`);
      assert.ok(row.products.length > 0, `${row.reference}: for at least one piece`);
      for (const { slug } of row.products) {
        const level = stock.find((candidate) => candidate.productSlug === slug && candidate.boutiqueSlug === row.boutique.slug);
        assert.ok(level?.quantity > 0, `${row.reference}: ${row.boutique.slug} has ${slug}`);
      }
    }

    const drafts = await demoRows(APPOINTMENT, { status: 'draft' });
    assert.deepEqual(new Set(drafts.map((row) => row.language)), new Set(['ja', 'en']));
    assert.deepEqual(new Set(drafts.map((row) => row.createdVia)), new Set(['app', 'concierge']));
    assert.equal(drafts.filter((row) => row.customerNote).length, 2, 'two carry a note');
  });

  it('records the questions: three open, one taken, one answered, each with a Q- reference and the customer\'s name', async () => {
    const { value: rows } = await strapi.plugin('maison').service('questions').list({ status: 'all', limit: 100 });
    const demo = rows.filter((row) => isDemo(row.customer));
    assert.equal(demo.length, 5);
    for (const row of demo) {
      assert.match(row.reference, /^Q-\d{4}$/);
      assert.ok(row.customerName, `${row.reference}: named`);
      assert.equal(row.line, null, `${row.reference}: nothing says it went out on LINE`);
      assert.equal(row.addedToKnowledge, false);
    }
    const open = demo.filter((row) => row.status === 'open');
    assert.deepEqual(open.map((row) => row.reason).sort(), ['asked_for_person', 'no_answer', 'no_answer']);
    const [taken] = demo.filter((row) => row.status === 'taken');
    assert.ok(taken.staffName && taken.takenAt, 'taken by someone, at a time');
    const [answered] = demo.filter((row) => row.status === 'answered');
    assert.ok(answered.staffName && answered.answeredAt && answered.answer, 'answered by someone, at a time, with the answer');
    assert.deepEqual(new Set(demo.map((row) => row.language)), new Set(['ja', 'en']));
    assert.ok(demo.filter((row) => row.product).length >= 2, 'some are about a piece');
  });

  it('logs ten inquiries: five hand-offs in Needs an answer, two complaints, one praise, one answered from knowledge, one for the sweep', async () => {
    const { value: rows } = await strapi.plugin('maison').service('inquiries').list({ filter: 'all', limit: 100 });
    const demo = rows.filter((row) => isDemo(row.customer));
    assert.equal(demo.length, 10);

    const questions = (await demoRows(QUESTION)).map((row) => [row.reference, row.status]);
    const handOffs = demo.filter((row) => row.handedOff);
    assert.deepEqual(handOffs.map((row) => [row.question.reference, row.question.status]).sort(), [...questions].sort(), 'one per question');
    for (const row of handOffs) {
      assert.equal(row.queue, 'needs-answer');
      assert.equal(row.kind, 'question');
      assert.equal(row.status, row.question.status === 'answered' ? 'replied' : 'open', row.question.reference);
    }
    const [replied] = handOffs.filter((row) => row.status === 'replied');
    assert.ok(replied.replyText && replied.repliedAt && replied.repliedBy, "the answered question's inquiry carries the answer");
    assert.equal(replied.line, null, 'and nothing says it went out on LINE');

    const standalone = demo.filter((row) => !row.handedOff);
    assert.deepEqual(standalone.map((row) => row.queue).sort(), ['complaint', 'complaint', 'none', 'none', 'praise']);
    for (const row of standalone.filter(({ kind }) => kind === 'complaint')) assert.equal(row.sentimentLabel, 'negative');
    for (const row of standalone.filter(({ kind }) => kind === 'praise')) assert.equal(row.sentimentLabel, 'positive');
    const [fromKnowledge] = standalone.filter((row) => row.kind === 'question');
    assert.equal(fromKnowledge.knowledgeFound, true);
    assert.equal(fromKnowledge.answered, true);
    const entries = await strapi.documents(KNOWLEDGE).findMany({ locale: 'en', status: 'published', limit: 100 });
    assert.ok(entries.some((entry) => fromKnowledge.reply.includes(entry.answer)), 'its reply is a seeded entry, word for word');
    const pending = standalone.filter((row) => row.analysisStatus === 'pending');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, null);

    for (const row of await demoRows(INQUIRY)) {
      assert.equal(row.via, 'concierge');
      assert.ok(row.reply, 'each has a reply');
      if (row.analysisStatus === 'pending') continue;
      assert.equal(row.analysisStatus, 'analyzed');
      assert.equal(row.analysisAttempts, 0);
      assert.equal(row.modelVersion, 'demo-seed');
      assert.equal(row.promptVersion, null, "no prompt version: nobody takes these labels for a model's");
      assert.ok(row.reason && row.topic, 'a reason and a topic for staff');
    }
    assert.deepEqual(new Set(demo.map((row) => row.language)), new Set(['ja', 'en']));

    // The open demo inquiries in each queue, beside Paul's own inquiry, which waits for the sweep.
    assert.deepEqual(await strapi.plugin('maison').service('inquiries').summary(), { needsAnswer: 4, complaint: 2, praise: 1, notLabelled: 2 });
  });

  it('spreads when the rows came in over the last three days, never two at the same moment', async () => {
    const times = [
      ...(await demoRows(APPOINTMENT, { status: 'draft' })),
      ...(await demoRows(APPOINTMENT, { status: 'published' })),
      ...(await demoRows(QUESTION)),
      ...(await demoRows(INQUIRY)),
    ].map((row) => Date.parse(row.createdAt));
    assert.equal(times.length, 22);
    for (const time of times) assert.ok(time > loadedAt.getTime() - 3 * DAY_MS && time < loadedAt.getTime(), new Date(time).toISOString());
    const drafts = (await demoRows(APPOINTMENT, { status: 'draft' })).map((row) => Date.parse(row.createdAt));
    const others = [...drafts, ...[...(await demoRows(QUESTION)), ...(await demoRows(INQUIRY))].map((row) => Date.parse(row.createdAt))];
    assert.equal(new Set(others).size, 20, 'no two rows at the same moment');
    assert.ok(Math.max(...others) - Math.min(...others) >= 48 * HOUR_MS, 'over more than two days');
    // A confirmed visit's published row came in when its request did.
    for (const published of await demoRows(APPOINTMENT, { status: 'published' })) {
      const [draft] = await demoRows(APPOINTMENT, { status: 'draft', filters: { documentId: { $eq: published.documentId } } });
      assert.equal(published.createdAt, draft.createdAt, published.reference);
    }
  });

  it("adds nothing the second time, and leaves everyone else's activity as it was", async () => {
    assert.deepEqual(await seed.loadDemoActivity(), { ok: true, value: NOTHING });
    assert.equal((await demoRows(APPOINTMENT, { status: 'draft' })).length, 5);
    assert.equal((await demoRows(QUESTION)).length, 5);
    assert.equal((await demoRows(INQUIRY)).length, 10);
    assert.equal(line.requests.length, 0, 'nothing was sent');
    assert.equal(await strapi.documents(APPOINTMENT).count({ filters: { reference: { $eq: own.appointment } } }), 1);
    assert.ok(await strapi.documents(QUESTION).findOne({ documentId: own.question }));
    assert.ok(await strapi.documents(INQUIRY).findOne({ documentId: own.inquiry }));
  });

  describe('through the services the admin routes call', () => {
    let staff;
    let appointmentsService;
    let questionsService;
    let inquiriesService;

    /** Every answer a service gave in this suite, to check none of them carries a full LINE user ID. */
    const answers = [];
    const seen = (what, answer) => {
      answers.push({ path: what, text: JSON.stringify(answer) });
      return answer;
    };

    /** The pushes the LINE stand-in received, as `to` (whose user ID) and the kind of message. */
    const pushes = () => line.requests.filter((request) => request.method === 'POST').map((request) => ({ to: request.body.to, type: request.body.messages[0].type }));

    /** The staff views the board and the two tabs list, as the routes list them. */
    const boardRows = async () => seen('appointments', (await appointmentsService.listRequests({ status: 'all', limit: 50 })).value);
    const questionRows = async (status = 'all') => seen(`questions ${status}`, (await questionsService.list({ status, limit: 100 })).value);
    const inquiryRows = async (filter = 'all') => seen(`inquiries ${filter}`, (await inquiriesService.list({ filter, limit: 100 })).value);

    before(() => {
      // Staff speak for Maison's client advisor team here, as an admin with no first name does.
      staff = null;
      appointmentsService = strapi.plugin('maison').service('appointments');
      questionsService = strapi.plugin('maison').service('questions');
      inquiriesService = strapi.plugin('maison').service('inquiries');
    });

    it('answers at once that it is all there, and starts nothing, when the demo activity is already loaded', async () => {
      assert.deepEqual(await seed.startDemoActivity(), { ok: true, value: { started: false, result: NOTHING } });
    });

    it('never shows a full LINE user ID in the requests, questions or inquiries, and lists show when each came in', async () => {
      const lists = { appointments: await boardRows(), questions: await questionRows(), inquiries: await inquiryRows() };
      for (const [key, rows] of Object.entries(lists)) {
        const demo = rows.filter((row) => isDemo(row.customer));
        assert.ok(demo.length >= 5, `${key} lists the demo rows`);
        assert.doesNotMatch(JSON.stringify(rows), LINE_USER_ID, `${key} masks every customer`);
        // Without demoLineUserId, no row is yours: the label is shown only for the account the setting names.
        assert.deepEqual(rows.filter((row) => row.yourLine !== false), [], `${key}: yourLine is false on every row`);
        const times = demo.map((row) => Date.parse(row.createdAt));
        assert.ok(Math.max(...times) - Math.min(...times) >= 24 * HOUR_MS, `${key}: received over more than a day`);
        assert.ok(times.every((time) => time > loadedAt.getTime() - 3 * DAY_MS), `${key}: within the last three days`);
      }
    });

    it("makes no LINE call for a made-up customer on Confirm, Send again, Let them know, Answer or Reply, and records demo", async () => {
      line.requests.length = 0;
      const board = await boardRows();
      const waiting = board.find((row) => isDemo(row.customer) && row.status === 'requested');
      const confirmedRow = await appointmentsService.confirm(waiting.reference);
      assert.equal(confirmedRow.ok, true, JSON.stringify(confirmedRow));
      assert.equal(confirmedRow.value.appointment.confirmationSent, false);
      assert.equal(confirmedRow.value.appointment.demoCustomer, true);
      const [notification] = await strapi.documents(NOTIFICATION).findMany({ filters: { appointmentReference: { $eq: waiting.reference } } });
      assert.deepEqual([notification.outcome, notification.detail], ['demo', 'Demo customer: no LINE message']);

      const again = await strapi.plugin('maison').service('line-confirmations').sendConfirmation(waiting.reference);
      assert.equal(again.status, 'demo');

      const open = await questionRows('open');
      const toNotify = open.find((row) => isDemo(row.customer) && row.status === 'open');
      const notified = await questionsService.notify(toNotify.reference, staff);
      assert.deepEqual([notified.status, notified.message], ['demo', `Marked ${toNotify.reference} taken. Demo customer: no LINE message.`]);

      const answered = await questionsService.answer(toNotify.reference, { text: 'Yes, we can.', addToKnowledge: false }, staff);
      assert.equal(answered.status, 'demo', JSON.stringify(answered));
      const [question] = await strapi.documents(QUESTION).findMany({ filters: { reference: { $eq: toNotify.reference } } });
      assert.deepEqual([question.status, question.lineOutcome, question.lineDetail], ['answered', 'demo', 'Demo customer: no LINE message']);
      const [handOff] = await strapi.documents(INQUIRY).findMany({ filters: { questionReference: { $eq: toNotify.reference } } });
      assert.deepEqual([handOff.status, handOff.lineOutcome], ['replied', 'demo']);

      const complaint = (await inquiryRows('complaint')).find((row) => isDemo(row.customer));
      const replied = await inquiriesService.reply(complaint.documentId, 'We are sorry.', staff);
      assert.deepEqual([replied.status, replied.message], ['demo', 'Marked it replied. Demo customer: no LINE message.']);

      // The rows show the outcome as demo, never as a failure.
      const all = await inquiryRows();
      assert.deepEqual(all.find((row) => row.documentId === complaint.documentId).line, { outcome: 'demo', detail: 'Demo customer: no LINE message' });
      assert.deepEqual(pushes(), [], 'no push for a made-up customer');
    });

    describe('with demoLineUserId set to your own LINE account', () => {
      before(async () => {
        await seed.resetDemoAppointments();
        strapi.config.set('plugin::maison.demoLineUserId', PAUL_ID);
        line.requests.length = 0;
      });
      after(() => strapi.config.set('plugin::maison.demoLineUserId', null));

      it('answers at once, a second press while it loads starts nothing, and the rows appear within a few seconds', async () => {
        const [first, second] = await Promise.all([seed.startDemoActivity(), sleep(200).then(() => seed.startDemoActivity())]);
        assert.equal(first.ok, true, JSON.stringify(first));
        assert.equal(first.value.started, true);
        assert.deepEqual(first.value.counts, { appointments: 5, questions: 5, inquiries: 10 });
        assert.equal(second.ok, false);
        assert.equal(second.code, 'already_loading');
        assert.equal(second.message, 'Demo activity is still loading from the last press: the lists fill in over the next few seconds.');

        const everyone = { filters: { customer: { $in: [...Array.from({ length: 5 }, (_, n) => `line:Udec0de${'0'.repeat(25)}${n + 1}`), PAUL] } } };
        await waitFor(
          async () =>
            (await strapi.documents(QUESTION).count(everyone)) === 5 &&
            (await strapi.documents(INQUIRY).count(everyone)) === 10 &&
            (await strapi.documents(APPOINTMENT).count({ ...everyone, status: 'draft' })) === 5 &&
            (await strapi.documents(NOTIFICATION).count()) === 2,
          10_000,
          'the demo activity'
        );
        // Once it has finished, a press answers that it is there.
        await first.value.done;
        const last = await seed.startDemoActivity();
        assert.equal(last.ok, true, JSON.stringify(last));
        assert.equal(last.value.started, false);
      });

      it('gives you one waiting request, one open question named from your LINE profile, and one open complaint', async () => {
        const visits = await strapi.documents(APPOINTMENT).findMany({ status: 'draft', filters: { customer: { $eq: PAUL } } });
        assert.equal(visits.length, 1);
        assert.equal(await strapi.documents(APPOINTMENT).count({ status: 'published', filters: { customer: { $eq: PAUL } } }), 0, 'waiting');
        const questions = await strapi.documents(QUESTION).findMany({ filters: { customer: { $eq: PAUL } } });
        assert.deepEqual(questions.map((row) => [row.status, row.reason, row.customerName]), [['open', 'no_answer', PAUL_NAME]]);
        const inquiries = await strapi.documents(INQUIRY).findMany({ filters: { customer: { $eq: PAUL }, handedOff: { $eq: false } } });
        assert.deepEqual(inquiries.map((row) => [row.kind, row.status]), [['complaint', 'open']]);
        assert.ok(line.requests.some((request) => request.url === `/v2/bot/profile/${PAUL_ID}`), 'your name came from LINE');
        assert.deepEqual(pushes(), [], 'loading sent nothing');
        // The made-up customers still have the rest.
        assert.equal((await demoRows(QUESTION)).length, 4);
        assert.equal((await demoRows(INQUIRY)).length, 8);
        assert.equal((await demoRows(APPOINTMENT, { status: 'draft' })).length, 4);
      });

      it('marks yourLine on exactly your rows: one request, one question and two inquiries, the hand-off and the complaint', async () => {
        const requests = await boardRows();
        const questions = await questionRows();
        const inquiries = await inquiryRows();
        const summary = seen('summary', (await appointmentsService.summarizeRequests()).recent);
        const YOURS = 'line:U5ca…1e';

        for (const [what, rows] of [['request', requests], ['question', questions], ['inquiry', inquiries], ['summary row', summary]]) {
          assert.ok(rows.length > 0, `there are ${what}s`);
          for (const row of rows) assert.equal(typeof row.yourLine, 'boolean', `every ${what} says whether it is yours`);
          // yourLine is true for the rows that show your masked ID, and for no other. It never depends on the made-up customers.
          assert.deepEqual(
            rows.filter((row) => row.yourLine).map((row) => row.customer),
            rows.filter((row) => row.customer === YOURS).map((row) => row.customer),
            `${what}s: yourLine is on the rows of your account only`
          );
          for (const row of rows.filter((candidate) => isDemo(candidate.customer))) assert.equal(row.yourLine, false, `a made-up customer's ${what}`);
        }

        const yourRequests = requests.filter((row) => row.yourLine);
        assert.deepEqual(yourRequests.map((row) => [row.customer, row.status, row.demoCustomer]), [[YOURS, 'requested', false]]);
        const yourQuestions = questions.filter((row) => row.yourLine);
        assert.deepEqual(yourQuestions.map((row) => [row.customer, row.status, row.reason]), [[YOURS, 'open', 'no_answer']]);
        const yourInquiries = inquiries.filter((row) => row.yourLine);
        assert.equal(yourInquiries.length, 2, 'the hand-off and the complaint');
        const handOff = yourInquiries.find((row) => row.handedOff);
        const complaint = yourInquiries.find((row) => !row.handedOff);
        assert.equal(handOff?.question?.reference, yourQuestions[0].reference, 'the hand-off of your question');
        assert.equal(complaint?.kind, 'complaint', 'the complaint');

        // Everything else is false, Paul's rehearsal and the made-up customers' rows included.
        assert.equal(requests.filter((row) => !row.yourLine).length, requests.length - 1);
        assert.equal(questions.filter((row) => !row.yourLine).length, questions.length - 1);
        assert.equal(inquiries.filter((row) => !row.yourLine).length, inquiries.length - 2);
        assert.ok(requests.some((row) => row.demoCustomer && row.yourLine === false), 'made-up customers stay false');
        // The summary's newest rows carry it as the board does.
        assert.deepEqual(
          summary.map((row) => [row.reference, row.yourLine]),
          summary.map((row) => [row.reference, requests.find((candidate) => candidate.reference === row.reference).yourLine])
        );
        // And the label is all there is: no row names your ID.
        assert.ok(!JSON.stringify([requests, questions, inquiries, summary]).includes(PAUL_ID), 'your ID is in no row');
      });

      it('sends real LINE messages to your account on Confirm, Let them know, Answer and Reply', async () => {
        line.requests.length = 0;
        const [visit] = await strapi.documents(APPOINTMENT).findMany({ status: 'draft', filters: { customer: { $eq: PAUL } } });
        const confirmed = seen('confirm', await appointmentsService.confirm(visit.reference));
        assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
        assert.equal(confirmed.value.appointment.confirmationSent, true);
        assert.equal(confirmed.value.appointment.demoCustomer, false);
        assert.equal(confirmed.value.appointment.yourLine, true, "Confirm's answer says it is yours");

        const [question] = await strapi.documents(QUESTION).findMany({ filters: { customer: { $eq: PAUL } } });
        const notified = seen('notify', await questionsService.notify(question.reference, staff));
        assert.equal(notified.status, 'sent', JSON.stringify(notified));
        const answered = seen('answer', await questionsService.answer(question.reference, { text: 'Yes, it matches.', addToKnowledge: false }, staff));
        assert.equal(answered.status, 'sent', JSON.stringify(answered));

        const [complaint] = await strapi.documents(INQUIRY).findMany({ filters: { customer: { $eq: PAUL }, handedOff: { $eq: false } } });
        const replied = seen('reply', await inquiriesService.reply(complaint.documentId, 'We are sorry about the strap.', staff));
        assert.equal(replied.status, 'sent', JSON.stringify(replied));

        assert.deepEqual(pushes(), [
          { to: PAUL_ID, type: 'flex' },
          { to: PAUL_ID, type: 'text' },
          { to: PAUL_ID, type: 'text' },
          { to: PAUL_ID, type: 'text' },
        ]);
      });

      it('never shows a full LINE user ID in any answer a staff view gives, yours included', async () => {
        const requests = await boardRows();
        assert.ok(requests.some((row) => row.customer === `line:U5ca…1e`), 'the board lists your request, masked');
        seen('summary', await appointmentsService.summarizeRequests());
        await questionRows();
        await inquiryRows();
        assert.ok(answers.length > 10);
        for (const { path, text } of answers) {
          assert.doesNotMatch(text, LINE_USER_ID, `${path} masks every customer`);
          assert.ok(!text.includes(PAUL_ID), `${path} never carries your user ID`);
        }
      });
    });
  });

  it('Reset demo activity clears it, and it loads again afterwards', async () => {
    await seed.resetDemoAppointments();
    assert.equal((await demoRows(APPOINTMENT, { status: 'draft' })).length, 0);
    assert.equal((await demoRows(QUESTION)).length, 0);
    assert.equal((await demoRows(INQUIRY)).length, 0);
    assert.equal(await strapi.documents(NOTIFICATION).count(), 0);
    assert.deepEqual(await seed.loadDemoActivity(), { ok: true, value: ADDED });
  });
});
