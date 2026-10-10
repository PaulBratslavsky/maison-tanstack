import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, SUBJECT_B, bootStrapi } from './harness.mjs';

const NOW = new Date('2026-10-01T00:00:00Z'); // 09:00 on Thursday 1 October in Tokyo
const SATURDAY_2PM = '2026-10-10T14:00:00+09:00';
const UID = 'plugin::maison.appointment';

describe('appointments service', () => {
  let strapi;
  let appointments;
  const request = (overrides = {}) =>
    appointments.request({
      subject: SUBJECT_A, boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: SATURDAY_2PM,
      createdVia: 'app', now: NOW, ...overrides,
    });

  before(async () => {
    strapi = await bootStrapi('appointments');
    await strapi.plugin('maison').service('seed').loadDemoCatalog();
    appointments = strapi.plugin('maison').service('appointments');
  });

  after(async () => {
    await strapi?.destroy();
  });

  it('creates a draft owned by the subject and reads it back', async () => {
    const result = await request({ note: 'A gift for a friend who travels', createdVia: 'concierge' });
    assert.equal(result.ok, true);
    const view = result.value;
    assert.match(view.reference, /^APT-\d{4}$/);
    assert.equal(view.status, 'requested');
    assert.equal(view.requestedFor, SATURDAY_2PM);
    assert.deepEqual(view.boutique, { slug: 'ginza', name: '銀座本店' });
    assert.deepEqual(view.products.map((p) => p.slug), ['weekender-50']);
    assert.equal(view.note, 'A gift for a friend who travels');

    const stored = await strapi.documents(UID).findFirst({ status: 'draft', filters: { reference: view.reference } });
    assert.equal(stored.customer, SUBJECT_A);
    assert.equal(stored.createdVia, 'concierge');
    assert.equal(await strapi.documents(UID).count({ status: 'published', filters: { reference: view.reference } }), 0, 'never published');
  });

  it("names the boutique and products in the customer's language, and in the default locale without one", async () => {
    const subject = `line:U${'c'.repeat(32)}`; // a customer of its own, so the other tests' open requests stay as they are
    const english = await request({ subject, locale: 'en', requestedFor: '2026-10-11T14:00:00+09:00' });
    assert.equal(english.ok, true, JSON.stringify(english));
    assert.deepEqual(english.value.boutique, { slug: 'ginza', name: 'Ginza Flagship' });
    assert.deepEqual(english.value.products, [{ slug: 'weekender-50', name: 'Weekender 50' }]);

    const japanese = await request({ subject, locale: 'ja', requestedFor: '2026-10-11T15:00:00+09:00' });
    assert.deepEqual(japanese.value.boutique, { slug: 'ginza', name: '銀座本店' });
    const unnamed = await request({ subject, requestedFor: '2026-10-11T16:00:00+09:00' });
    assert.deepEqual(unnamed.value.boutique, { slug: 'ginza', name: '銀座本店' }, 'the default locale, ja');
    assert.deepEqual(unnamed.value.products, [{ slug: 'weekender-50', name: 'ウィークエンダー 50' }]);
  });

  it("keeps the language the customer booked in, for the visit's LINE confirmation, and Japanese without one", async () => {
    const subject = `line:U${'d'.repeat(32)}`; // a customer of its own, so the other tests' open requests stay as they are
    const english = await request({ subject, locale: 'en', requestedFor: '2026-10-18T14:00:00+09:00' });
    assert.equal(english.ok, true, JSON.stringify(english));
    const unnamed = await request({ subject, requestedFor: '2026-10-18T15:00:00+09:00' });
    assert.equal(unnamed.ok, true, JSON.stringify(unnamed));

    const languageOf = async (reference) => (await strapi.documents(UID).findFirst({ status: 'draft', filters: { reference } })).language;
    assert.equal(await languageOf(english.value.reference), 'en');
    assert.equal(await languageOf(unnamed.value.reference), 'ja', 'the default locale, ja');
  });

  it('rejects unknown slugs and times that are too soon or outside opening hours', async () => {
    assert.equal((await request({ boutique: 'kyoto' })).code, 'not_found');
    assert.equal((await request({ productSlugs: ['weekender-50', 'no-such-piece'] })).code, 'not_found');
    assert.equal((await request({ requestedFor: '2026-10-01T09:10:00+09:00' })).code, 'in_the_past');

    const tuesday = await request({ boutique: 'osaka', requestedFor: '2026-10-06T14:00:00+09:00' });
    assert.equal(tuesday.code, 'boutique_closed');
    assert.match(tuesday.hint, /closed all day on Tuesday 2026-10-06/);

    const utcMondayNight = await request({ boutique: 'osaka', requestedFor: '2026-10-05T23:30:00Z' });
    assert.equal(utcMondayNight.code, 'boutique_closed', 'judged as Tuesday 08:30 in Tokyo');

    const atClosing = await request({ requestedFor: '2026-10-10T20:00:00+09:00' });
    assert.equal(atClosing.code, 'boutique_closed');
    assert.match(atClosing.hint, /from 11:00 to 20:00/);
    assert.equal((await request({ requestedFor: '2026-10-10T19:59:00+09:00' })).ok, true);
  });

  it('limits open requests per customer, counting only unconfirmed future ones', async () => {
    const references = [];
    for (const day of [12, 13, 14]) {
      const result = await request({ subject: SUBJECT_B, requestedFor: `2026-10-${day}T15:00:00+09:00` });
      assert.equal(result.ok, true);
      references.push(result.value.reference);
    }
    const blocked = await request({ subject: SUBJECT_B, requestedFor: '2026-10-15T15:00:00+09:00' });
    assert.equal(blocked.code, 'too_many_open_requests');

    const first = await strapi.documents(UID).findFirst({ status: 'draft', filters: { reference: references[0] } });
    await strapi.documents(UID).publish({ documentId: first.documentId });
    assert.equal((await request({ subject: SUBJECT_B, requestedFor: '2026-10-15T15:00:00+09:00' })).ok, true);
  });

  it("lists only the caller's appointments, newest first, with confirmation state", async () => {
    const mine = await appointments.listForCustomer(SUBJECT_B, 'en');
    assert.equal(mine.length, 4);
    assert.ok(mine.every((a) => a.boutique.name === 'Ginza Flagship'), 'names follow the requested locale');
    assert.equal(mine[0].requestedFor, '2026-10-15T15:00:00+09:00', 'newest first');
    const confirmed = mine.filter((a) => a.status === 'confirmed');
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].confirmationSent, false);

    const theirs = await appointments.listForCustomer(SUBJECT_A, 'ja');
    assert.ok(theirs.length > 0);
    assert.ok(theirs.every((a) => !mine.some((m) => m.reference === a.reference)), 'no overlap between customers');
  });

  it("keeps the customer's LINE user ID out of the Content Manager", async () => {
    const contentTypes = strapi.plugin('content-manager').service('content-types');
    const model = contentTypes.findContentType(UID);
    assert.ok(model.attributes.reference, 'the Content Manager model has the other fields');
    assert.equal(model.attributes.customer, undefined, 'the Content Manager model has no customer field');

    const { layouts } = await contentTypes.findConfiguration(model);
    assert.ok(!layouts.list.includes('customer'), `no customer column in the list view: ${layouts.list}`);
    assert.ok(!layouts.edit.flat().some((field) => field.name === 'customer'), 'no customer field in the edit view');
  });

  it('keeps the customer through a Content Manager save and Publish, which never send it', async () => {
    const requested = await request({ requestedFor: '2026-10-17T14:00:00+09:00' });
    assert.equal(requested.ok, true, JSON.stringify(requested));
    const { documentId } = await strapi.documents(UID).findFirst({ status: 'draft', filters: { reference: requested.value.reference } });
    // What the Content Manager does on Save, then Publish: update the draft with the fields it shows, then publish it.
    await strapi.documents(UID).update({ documentId, data: { customerNote: 'Edited by staff in the admin' } });
    await strapi.documents(UID).publish({ documentId });
    for (const status of ['draft', 'published']) {
      const stored = await strapi.documents(UID).findOne({ documentId, status });
      assert.equal(stored.customer, SUBJECT_A, `the ${status} version keeps the customer`);
      assert.equal(stored.customerNote, 'Edited by staff in the admin');
    }
  });
});
