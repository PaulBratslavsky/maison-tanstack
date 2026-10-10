import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, SUBJECT_B, bootStrapi } from './harness.mjs';

const NOW = new Date('2026-10-01T00:00:00Z'); // 09:00 on Thursday 1 October in Tokyo
const APPOINTMENT = 'plugin::maison.appointment';

describe('staff review and confirmation', () => {
  let strapi;
  let appointments;
  const refs = {};
  /** Creates a request as a customer would. The pause keeps createdAt distinct, so "newest first" is stable. */
  const request = async (key, overrides) => {
    const result = await appointments.request({
      subject: SUBJECT_A, boutique: 'ginza', productSlugs: ['weekender-50'], createdVia: 'app', now: NOW, ...overrides,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    refs[key] = result.value.reference;
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const list = (filters = {}) => appointments.listRequests({ now: NOW, ...filters });
  const references = async (filters) => (await list(filters)).value.map((a) => a.reference);

  before(async () => {
    strapi = await bootStrapi('staff');
    await strapi.plugin('maison').service('seed').loadDemoCatalog();
    appointments = strapi.plugin('maison').service('appointments');
    // Created in this order, so newest first is: late, soon, other.
    await request('other', {
      subject: SUBJECT_B, boutique: 'omotesando', productSlugs: ['passport-cover'], requestedFor: '2026-10-11T15:00:00+09:00',
      createdVia: 'concierge', note: 'For my sister',
    });
    await request('soon', { requestedFor: '2026-10-02T14:00:00+09:00' });
    await request('late', { requestedFor: '2026-10-10T14:00:00+09:00', productSlugs: ['weekender-50', 'passport-cover'] });
  });

  after(async () => {
    await strapi?.destroy();
  });

  it('lists requests waiting for staff, soonest visit first, with the customer masked', async () => {
    const result = await list();
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.map((a) => a.reference), [refs.soon, refs.late, refs.other]);
    const [soon] = result.value;
    assert.equal(soon.status, 'requested');
    assert.equal(soon.customer, 'line:Uaaa…aa');
    assert.deepEqual(soon.boutique, { slug: 'ginza', name: '銀座本店' });
    assert.equal(soon.requestedFor, '2026-10-02T14:00:00+09:00');
    assert.deepEqual(soon.products, [{ slug: 'weekender-50', name: 'ウィークエンダー 50' }]);
    assert.equal(soon.createdVia, 'app');
    assert.equal(soon.confirmationSent, false);
    assert.match(soon.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
    assert.ok(!JSON.stringify(result.value).includes(SUBJECT_A.slice('line:'.length)), 'never the LINE user ID');
  });

  it('filters by boutique, visit day and limit, and names follow the locale', async () => {
    assert.deepEqual(await references({ boutique: 'omotesando' }), [refs.other]);
    assert.deepEqual(await references({ date: '2026-10-10' }), [refs.late]);
    assert.deepEqual(await references({ limit: 1 }), [refs.soon]);
    assert.equal((await list({ boutique: 'kyoto' })).code, 'not_found');

    const [other] = (await list({ boutique: 'omotesando', locale: 'en' })).value;
    assert.equal(other.customer, 'line:Ubbb…bb');
    assert.deepEqual(other.boutique, { slug: 'omotesando', name: 'Omotesando' });
    assert.deepEqual(other.products, [{ slug: 'passport-cover', name: 'Passport Cover' }]);
    assert.equal(other.createdVia, 'concierge');
    assert.equal(other.note, 'For my sister');
  });

  it('files a visit under its day in Tokyo, even when it is stored on the day before in UTC', async () => {
    const ginza = await strapi.documents('plugin::maison.boutique').findFirst({ locale: 'ja', status: 'published', filters: { slug: 'ginza' } });
    const early = await strapi.documents(APPOINTMENT).create({
      data: {
        reference: 'APT-9830', customer: SUBJECT_A, requestedFor: '2026-10-10T08:30:00+09:00',
        boutique: { documentId: ginza.documentId, locale: 'ja' }, createdVia: 'app',
      },
    });
    try {
      const stored = await strapi.documents(APPOINTMENT).findOne({ documentId: early.documentId });
      assert.equal(new Date(stored.requestedFor).toISOString(), '2026-10-09T23:30:00.000Z', 'stored on 9 October in UTC');
      assert.deepEqual(await references({ date: '2026-10-10' }), ['APT-9830', refs.late], 'listed on 10 October, its day in Tokyo');
      assert.deepEqual(await references({ date: '2026-10-09' }), [], 'not listed on 9 October');
    } finally {
      await strapi.documents(APPOINTMENT).delete({ documentId: early.documentId });
    }
  });

  it('confirms by publishing, and confirming again changes nothing', async () => {
    const first = await appointments.confirm(refs.late, NOW);
    assert.equal(first.ok, true);
    assert.equal(first.value.alreadyConfirmed, false);
    assert.equal(first.value.appointment.reference, refs.late);
    assert.equal(first.value.appointment.status, 'confirmed');
    assert.equal(await strapi.documents(APPOINTMENT).count({ status: 'published', filters: { reference: refs.late } }), 1);

    const again = await appointments.confirm(refs.late, NOW);
    assert.equal(again.value.alreadyConfirmed, true);
    assert.equal(again.value.appointment.status, 'confirmed');

    assert.deepEqual(await references(), [refs.soon, refs.other]);
    assert.deepEqual(await references({ status: 'confirmed' }), [refs.late]);
  });

  it('refuses unknown references and visits that have started, and publishes nothing', async () => {
    assert.equal((await appointments.confirm('APT-0000', NOW)).code, 'not_found');

    const later = new Date('2026-10-02T06:00:00Z'); // 15:00 on 2 October in Tokyo, an hour after the visit
    const past = await appointments.confirm(refs.soon, later);
    assert.equal(past.code, 'in_the_past');
    assert.match(past.message, /2026-10-02T14:00:00\+09:00/);
    assert.equal(await strapi.documents(APPOINTMENT).count({ status: 'published', filters: { reference: refs.soon } }), 0);

    assert.deepEqual(await references({ now: later }), [refs.other], 'a request whose time has passed no longer waits for staff');
    assert.ok((await references({ status: 'all', now: later })).includes(refs.soon), 'it is still listed under all');
  });

  it('lists all requests newest first, with the LINE confirmation state', async () => {
    const sent = await strapi.plugin('maison').service('confirmations').record({ reference: refs.late, status: 'sent', detail: 'ok' });
    assert.equal(sent.ok, true);

    const all = (await list({ status: 'all' })).value;
    assert.deepEqual(all.map((a) => a.reference), [refs.late, refs.soon, refs.other]);
    assert.deepEqual(all.map((a) => a.status), ['confirmed', 'requested', 'requested']);
    assert.deepEqual(all.map((a) => a.confirmationSent), [true, false, false]);
  });

  // Last: it changes the catalog.
  it('labels come from published versions, never from draft edits', async () => {
    const ginza = await strapi.documents('plugin::maison.boutique').findFirst({ locale: 'ja', status: 'draft', filters: { slug: 'ginza' } });
    await strapi.documents('plugin::maison.boutique').update({ documentId: ginza.documentId, locale: 'ja', data: { name: '銀座本店（改装中の下書き）' } });
    const cover = await strapi.documents('plugin::maison.product').findFirst({ locale: 'ja', status: 'published', filters: { slug: 'passport-cover' } });
    await strapi.documents('plugin::maison.product').unpublish({ documentId: cover.documentId, locale: '*' });

    const late = (await list({ status: 'all' })).value.find((a) => a.reference === refs.late);
    assert.deepEqual(late.boutique, { slug: 'ginza', name: '銀座本店' }, 'the published name, not the draft edit');
    assert.deepEqual(late.products.map((p) => p.slug), ['weekender-50'], 'an unpublished product is left out');
  });
});
