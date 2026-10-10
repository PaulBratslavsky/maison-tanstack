import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, SUBJECT_B, bootStrapi, tokyoDate, tokyoIso, tokyoTime } from './harness.mjs';

// The service counts at NOW, when this file starts, and the admin route at the real clock a moment later. The visits
// still ahead are 10, 20 and 30 days out, so both clocks see them ahead, and the tests never expire. The visits that
// are over were requested as if it were 2020.
const NOW = new Date();
const LONG_AGO = new Date('2020-01-01T00:00:00Z');
const BEFORE_EVERY_VISIT = new Date('2019-12-31T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const IN_10_DAYS = tokyoDate(10);
const IN_20_DAYS = tokyoDate(20);
const IN_30_DAYS = tokyoDate(30);
const APPOINTMENT = 'plugin::maison.appointment';
const NOTIFICATION = 'plugin::maison.notification';
const REVIEW = 'plugin::maison.appointments.review';
const CONFIRM = 'plugin::maison.appointments.confirm';
const ROW_FIELDS = ['boutique', 'confirmationSent', 'createdAt', 'customer', 'demoCustomer', 'note', 'reference', 'requestedFor', 'status', 'yourLine'];
/** A customer's LINE user ID: their subject without "line:". No staff surface ever shows it. */
const lineUserIdOf = (subject) => subject.slice('line:'.length);

describe('the requests summary behind the admin homepage widget', () => {
  let strapi;
  let appointments;
  let confirmations;
  const refs = {};

  /** Creates a request as a customer would. The pause keeps createdAt distinct, so "newest first" is stable. */
  const request = async (key, { now = NOW, ...overrides }) => {
    const result = await appointments.request({
      subject: SUBJECT_A, boutique: 'ginza', productSlugs: ['weekender-50'], createdVia: 'app', now, ...overrides,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    refs[key] = result.value.reference;
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const confirm = async (key, now = NOW) => assert.equal((await appointments.confirm(refs[key], now)).ok, true);
  const sendConfirmation = async (key) =>
    assert.equal((await confirmations.record({ reference: refs[key], status: 'sent', detail: 'ok' })).ok, true);
  const summarize = (now = NOW) => appointments.summarizeRequests(now);
  /** When the request's draft was stored, as the services write a moment. Read from the Document Service, not from the summary. */
  const createdAtOf = async (reference) =>
    tokyoIso(new Date((await strapi.documents(APPOINTMENT).findFirst({ status: 'draft', filters: { reference } })).createdAt));

  before(async () => {
    strapi = await bootStrapi('summary');
    await strapi.plugin('maison').service('seed').loadDemoCatalog();
    appointments = strapi.plugin('maison').service('appointments');
    confirmations = strapi.plugin('maison').service('confirmations');
  });

  after(async () => {
    await strapi?.destroy();
  });

  it('is all zeros, with no rows, before anything has been requested', async () => {
    assert.deepEqual(await summarize(), {
      counts: { waitingForStaff: 0, confirmedUpcoming: 0, confirmationsSent: 0 },
      recent: [],
    });
  });

  describe('with requests', () => {
    before(async () => {
      // Created in this order, so newest first is: late, soon, booked, other, done, early, gone.
      // gone and done have visits that are over by NOW. They are requested as if it were 2020, and done is then
      // confirmed, with its LINE confirmation sent, before its visit.
      await request('gone', { requestedFor: '2020-01-04T14:00:00+09:00', now: LONG_AGO }); // never confirmed
      await request('early', { subject: SUBJECT_B, requestedFor: tokyoTime(IN_30_DAYS, '12:00') }); // waits, but is too old for the five newest
      await request('done', {
        subject: SUBJECT_B, boutique: 'omotesando', productSlugs: ['passport-cover'], requestedFor: '2020-01-05T15:00:00+09:00', now: LONG_AGO,
      });
      await confirm('done', new Date('2020-01-02T00:00:00Z'));
      await sendConfirmation('done');
      // Still ahead of NOW and of the real clock:
      await request('other', {
        subject: SUBJECT_B, boutique: 'omotesando', productSlugs: ['passport-cover'], requestedFor: tokyoTime(IN_20_DAYS, '15:00'),
        createdVia: 'concierge', note: 'For my sister',
      });
      await confirm('other');
      await sendConfirmation('other');
      await request('booked', { requestedFor: tokyoTime(IN_10_DAYS, '14:00') });
      await confirm('booked');
      await request('soon', { requestedFor: tokyoTime(IN_10_DAYS, '16:00') });
      await request('late', { requestedFor: tokyoTime(IN_30_DAYS, '14:00'), productSlugs: ['weekender-50', 'passport-cover'] });
    });

    it('counts what waits for staff, what is confirmed and ahead, and how many of those LINE has confirmed', async () => {
      // early, soon and late wait; other and booked are confirmed and ahead; LINE has confirmed other.
      assert.deepEqual((await summarize()).counts, { waitingForStaff: 3, confirmedUpcoming: 2, confirmationsSent: 1 });
    });

    it('leaves a visit that is over out of all three counts', async () => {
      const now = (await summarize()).counts;
      assert.equal(now.waitingForStaff, 3, 'gone, requested for a visit in 2020, is not waiting for staff');
      assert.equal(now.confirmedUpcoming, 2, 'done, confirmed for a visit in 2020, is not upcoming');
      assert.equal(now.confirmationsSent, 1, "done's LINE confirmation was for a visit that is over");
      // The same requests, counted before their visits, bring all three back.
      assert.deepEqual((await summarize(BEFORE_EVERY_VISIT)).counts, { waitingForStaff: 4, confirmedUpcoming: 3, confirmationsSent: 2 });
    });

    it('lists the five newest requests, newest first, whatever their status or visit time', async () => {
      const { recent } = await summarize();
      assert.deepEqual(recent.map((row) => row.reference), [refs.late, refs.soon, refs.booked, refs.other, refs.done], 'early and gone, the two oldest, are left out');
      assert.deepEqual(recent.map((row) => row.status), ['requested', 'requested', 'confirmed', 'confirmed', 'confirmed']);
      assert.deepEqual(recent.map((row) => row.confirmationSent), [false, false, false, true, true]);
      assert.deepEqual(recent[0], {
        reference: refs.late,
        status: 'requested',
        customer: 'line:Uaaa…aa',
        boutique: { slug: 'ginza', name: '銀座本店' },
        requestedFor: tokyoTime(IN_30_DAYS, '14:00'),
        note: '',
        confirmationSent: false,
        demoCustomer: false,
        yourLine: false,
        createdAt: await createdAtOf(refs.late),
      });
      for (const row of recent) assert.deepEqual(Object.keys(row).sort(), ROW_FIELDS);
    });

    it('gives each row the time its request came in, which is not its visit time, and so reads newest first', async () => {
      const { recent } = await summarize();
      for (const row of recent) {
        assert.equal(row.createdAt, await createdAtOf(row.reference), `${row.reference} carries its own request's time`);
        assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/, 'Tokyo time with its offset, like the visit time');
      }
      // Requested as if it were 2020, done's visit is in 2020 and its request is from today.
      const done = recent.find((row) => row.reference === refs.done);
      assert.equal(done.requestedFor, '2020-01-05T15:00:00+09:00');
      assert.notEqual(done.createdAt, done.requestedFor);
      assert.ok(Date.parse(done.createdAt) >= NOW.getTime() - 1000, "done's createdAt is when it was requested in this run (to the second), not its 2020 visit");
      const times = recent.map((row) => Date.parse(row.createdAt));
      assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest request first (to the second)');
    });

    it("carries each request's note exactly as the customer left it, and an empty one when there is none", async () => {
      const { recent } = await summarize();
      assert.deepEqual(
        recent.map((row) => [row.reference, row.note]),
        [[refs.late, ''], [refs.soon, ''], [refs.booked, ''], [refs.other, 'For my sister'], [refs.done, '']]
      );
    });

    it("shows each row as the board's All requests view does, with the customer masked and without the products", async () => {
      const { recent } = await summarize();
      const board = (await appointments.listRequests({ status: 'all', limit: 5, now: NOW })).value;
      assert.deepEqual(
        recent,
        board.map(({ reference, status, customer, boutique, requestedFor, note, confirmationSent, demoCustomer, yourLine, createdAt }) => ({
          reference, status, customer, boutique, requestedFor, note, confirmationSent, demoCustomer, yourLine, createdAt,
        }))
      );
      assert.deepEqual(recent.map((row) => row.customer), ['line:Uaaa…aa', 'line:Uaaa…aa', 'line:Uaaa…aa', 'line:Ubbb…bb', 'line:Ubbb…bb']);
      const text = JSON.stringify(recent);
      for (const [who, subject] of [["A's", SUBJECT_A], ["B's", SUBJECT_B]]) assert.ok(!text.includes(lineUserIdOf(subject)), `never ${who} LINE user ID`);
      assert.ok(!text.includes('weekender-50') && !text.includes('passport-cover'), 'no products');
    });

    it("agrees with the board's own views at any moment, boundaries included", async () => {
      // Before every visit, now, when booked and when soon start and a second after each, and after every visit.
      const bookedStarts = Date.parse(tokyoTime(IN_10_DAYS, '14:00'));
      const soonStarts = Date.parse(tokyoTime(IN_10_DAYS, '16:00'));
      for (const at of [
        BEFORE_EVERY_VISIT.getTime(), NOW.getTime(), bookedStarts, bookedStarts + 1000, soonStarts, soonStarts + 1000, NOW.getTime() + 400 * DAY_MS,
      ]) {
        const now = new Date(at);
        const view = async (status) => (await appointments.listRequests({ status, limit: 50, now })).value;
        const confirmedAhead = (await view('confirmed')).filter((row) => Date.parse(row.requestedFor) >= at);
        assert.deepEqual((await summarize(now)).counts, {
          waitingForStaff: (await view('requested')).length,
          confirmedUpcoming: confirmedAhead.length,
          confirmationsSent: confirmedAhead.filter((row) => row.confirmationSent).length,
        }, now.toISOString());
      }
    });

    it('follows the board when a confirmed visit is moved in the Content Manager and not published again', async () => {
      // Saving in the Content Manager changes the draft; the published version keeps its old time until Publish.
      const draft = await strapi.documents(APPOINTMENT).findFirst({ status: 'draft', filters: { reference: refs.booked } });
      await strapi.documents(APPOINTMENT).update({ documentId: draft.documentId, data: { requestedFor: '2020-01-06T14:00:00+09:00' } });
      try {
        const board = (await appointments.listRequests({ status: 'confirmed', limit: 50, now: NOW })).value.find((row) => row.reference === refs.booked);
        assert.equal(board.requestedFor, '2020-01-06T14:00:00+09:00', 'the board shows the draft time');
        assert.equal((await summarize()).counts.confirmedUpcoming, 1, 'so booked no longer counts as upcoming');
      } finally {
        await strapi.documents(APPOINTMENT).update({ documentId: draft.documentId, data: { requestedFor: tokyoTime(IN_10_DAYS, '14:00') } });
      }
      assert.equal((await summarize()).counts.confirmedUpcoming, 2);
    });

    it('counts a confirmed upcoming visit once however many `sent` records it has, and no other record', async () => {
      const records = [
        { appointmentReference: refs.other, outcome: 'sent' }, // a second `sent` for a visit that has one
        { appointmentReference: refs.booked, outcome: 'failed' }, // an attempt that did not reach the customer
        { appointmentReference: refs.soon, outcome: 'sent' }, // a request staff haven't confirmed
        { appointmentReference: 'APT-0000', outcome: 'sent' }, // an appointment that no longer exists
      ];
      const created = [];
      for (const record of records) {
        created.push(await strapi.documents(NOTIFICATION).create({ data: { channel: 'line', sentAt: NOW.toISOString(), detail: 'test', ...record } }));
      }
      try {
        assert.equal((await summarize()).counts.confirmationsSent, 1, 'other, and only other');
      } finally {
        for (const { documentId } of created) await strapi.documents(NOTIFICATION).delete({ documentId });
      }
    });
  });

  describe('GET /maison/appointments/summary', () => {
    let baseUrl;
    let reviewer;
    let confirmer;

    /** One request to the admin route. Tokens are sent, never logged. */
    const get = async (path, token) => {
      const response = await fetch(new URL(path, baseUrl), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return { status: response.status, body: await response.json().catch(() => null) };
    };

    /**
     * An admin whose role holds `actions`, signed in the way the admin panel's login does it: a session, then an
     * access token. The account has no password, and exists only in this test's throwaway database.
     */
    const adminWith = async (name, actions) => {
      const roles = strapi.service('admin::role');
      const role = await roles.create({ name: `Maison test: ${name}`, description: 'Created by the Maison integration tests' });
      await roles.assignPermissions(role.id, actions.map((action) => ({ action, subject: null, properties: {}, conditions: [] })));
      const user = await strapi.service('admin::user').create({
        email: `${name}@maison.test`, firstname: name, lastname: 'Test', isActive: true, roles: [role.id],
      });
      const sessions = strapi.sessionManager('admin');
      const { token: refreshToken } = await sessions.generateRefreshToken(String(user.id), `maison-test-${name}`, { type: 'session' });
      const { token } = await sessions.generateAccessToken(refreshToken);
      return token;
    };

    before(async () => {
      // Requests of its own, so this passes on its own too: three wait for staff, two are confirmed and ahead, and LINE
      // has confirmed one of those. One more, confirmed and sent in 2020, is over and the oldest, so it shows nowhere.
      await strapi.plugin('maison').service('seed').resetDemoAppointments();
      await request('pastSentB', {
        subject: SUBJECT_B, boutique: 'omotesando', productSlugs: ['passport-cover'], requestedFor: '2020-01-05T15:00:00+09:00', now: LONG_AGO,
      });
      await confirm('pastSentB', new Date('2020-01-02T00:00:00Z'));
      await sendConfirmation('pastSentB');
      await request('waitingA', { requestedFor: tokyoTime(IN_10_DAYS, '12:00') });
      await request('waitingB', { subject: SUBJECT_B, boutique: 'omotesando', productSlugs: ['passport-cover'], requestedFor: tokyoTime(IN_20_DAYS, '12:00') });
      await request('confirmedB', { subject: SUBJECT_B, requestedFor: tokyoTime(IN_20_DAYS, '13:00') });
      await confirm('confirmedB');
      await request('sentA', { requestedFor: tokyoTime(IN_30_DAYS, '13:00') });
      await confirm('sentA');
      await sendConfirmation('sentA');
      await request('waitingA2', { requestedFor: tokyoTime(IN_30_DAYS, '15:00'), note: 'Window seat, please' });

      reviewer = await adminWith('reviewer', [REVIEW]);
      confirmer = await adminWith('confirmer', [CONFIRM]); // holds a Maison permission, but not the one for reviewing
      await new Promise((resolve, reject) => {
        strapi.server.listen(0, '127.0.0.1', resolve).once('error', reject);
      });
      baseUrl = `http://127.0.0.1:${strapi.server.httpServer.address().port}`;
    });

    it('refuses a caller who is not signed in to the admin', async () => {
      assert.equal((await get('/maison/appointments/summary')).status, 401);
      assert.equal((await get('/maison/appointments/summary', 'not-a-session')).status, 401);
    });

    it('answers 403 to an admin whose role lacks appointments.review, whatever else it holds', async () => {
      const { status, body } = await get('/maison/appointments/summary', confirmer);
      assert.equal(status, 403);
      assert.equal(body.data, null);
      assert.ok(!('counts' in body) && !('recent' in body), 'nothing of the summary');
    });

    it('answers an admin with appointments.review the counts and the five newest requests', async () => {
      const { status, body } = await get('/maison/appointments/summary', reviewer);
      assert.equal(status, 200, JSON.stringify(body));
      assert.deepEqual(body.counts, { waitingForStaff: 3, confirmedUpcoming: 2, confirmationsSent: 1 });
      assert.deepEqual(body.recent.map((row) => row.reference), [refs.waitingA2, refs.sentA, refs.confirmedB, refs.waitingB, refs.waitingA]);
      assert.deepEqual(
        body.recent.map((row) => [row.status, row.confirmationSent]),
        [['requested', false], ['confirmed', true], ['confirmed', false], ['requested', false], ['requested', false]]
      );
      assert.deepEqual(body.recent[0].boutique, { slug: 'ginza', name: '銀座本店' });
      assert.deepEqual(body.recent.map((row) => row.customer), ['line:Uaaa…aa', 'line:Uaaa…aa', 'line:Ubbb…bb', 'line:Ubbb…bb', 'line:Uaaa…aa']);
      for (const row of body.recent) assert.deepEqual(Object.keys(row).sort(), ROW_FIELDS);
      assert.deepEqual(body.recent.map((row) => row.note), ['Window seat, please', '', '', '', ''], "each request's note, as the customer left it");
      for (const row of body.recent) assert.equal(row.createdAt, await createdAtOf(row.reference), `${row.reference}: the time its request came in`);
      const text = JSON.stringify(body);
      for (const [who, subject] of [["A's", SUBJECT_A], ["B's", SUBJECT_B]]) assert.ok(!text.includes(lineUserIdOf(subject)), `never ${who} LINE user ID`);
    });

    it('is not taken for an appointment reference, and leaves the board route alone', async () => {
      const board = await get('/maison/appointments?status=all', reviewer);
      assert.equal(board.status, 200);
      assert.ok(Array.isArray(board.body.appointments));
      const summary = await get('/maison/appointments/summary', reviewer);
      assert.equal(summary.status, 200);
      assert.ok(!('appointments' in summary.body), "the summary, not the board's list");
    });
  });
});
