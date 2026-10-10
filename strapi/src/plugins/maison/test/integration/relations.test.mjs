import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, bootStrapi, ensureLocales, requireFromApp } from './harness.mjs';

const UID = {
  collection: 'plugin::maison.collection',
  product: 'plugin::maison.product',
  boutique: 'plugin::maison.boutique',
  stock: 'plugin::maison.stock-level',
  appointment: 'plugin::maison.appointment',
  notification: 'plugin::maison.notification',
};
const saturday = [{ weekday: 'sat', opens: '11:00', closes: '20:00' }];

describe('relations across locales and draft/publish (Strapi 5.57)', () => {
  let strapi;
  let boutique;
  let product;

  before(async () => {
    strapi = await bootStrapi('relations');
    await ensureLocales(strapi);
    boutique = (await strapi.documents(UID.boutique).create({
      locale: 'ja', status: 'published', data: { name: '銀座', slug: 'ginza', openingHours: saturday },
    })).documentId;
    product = (await strapi.documents(UID.product).create({
      locale: 'ja', status: 'published', data: { name: '検証', slug: 'probe', sku: 'PROBE-1', category: 'bag', priceJpy: 1000 },
    })).documentId;
  });

  after(async () => {
    await strapi?.destroy();
  });

  it('keys stock levels by slug, so republishing a product or adding a locale never orphans them', async () => {
    await strapi.documents(UID.stock).create({ data: { productSlug: 'probe', boutiqueSlug: 'ginza', quantity: 2 } });
    const read = () => strapi.documents(UID.stock).findMany({ filters: { productSlug: { $eq: 'probe' } } });
    assert.equal((await read()).length, 1);

    await strapi.documents(UID.product).update({ documentId: product, locale: 'ja', data: { priceJpy: 2000 } });
    await strapi.documents(UID.product).publish({ documentId: product, locale: 'ja' });
    await strapi.documents(UID.product).update({ documentId: product, locale: 'en', data: { name: 'Probe', slug: 'probe' } });
    await strapi.documents(UID.product).publish({ documentId: product, locale: 'en' });

    const rows = await read();
    assert.equal(rows.length, 1, 'the stock level is still found by product slug');
    assert.equal(rows[0].boutiqueSlug, 'ginza');
    assert.equal(rows[0].quantity, 2);
  });

  it('keeps an appointment linked when it is published and when its boutique is republished', async () => {
    const created = await strapi.documents(UID.appointment).create({
      data: {
        reference: 'APT-0001',
        customer: SUBJECT_A,
        requestedFor: '2026-10-10T05:00:00.000Z',
        boutique: { documentId: boutique, locale: 'ja' },
        products: [{ documentId: product, locale: 'ja' }],
        createdVia: 'app',
      },
    });
    const populate = { boutique: { fields: ['documentId'] }, products: { fields: ['documentId'] } };
    const draft = await strapi.documents(UID.appointment).findOne({ documentId: created.documentId, status: 'draft', populate });
    assert.equal(draft.boutique?.documentId, boutique);
    assert.equal(draft.products?.length, 1);

    await strapi.documents(UID.appointment).publish({ documentId: created.documentId });
    const published = await strapi.documents(UID.appointment).findOne({ documentId: created.documentId, status: 'published', populate });
    assert.equal(published.boutique?.documentId, boutique, 'published appointment keeps its boutique');
    assert.equal(published.products?.[0]?.documentId, product, 'published appointment keeps its product');

    await strapi.documents(UID.boutique).update({ documentId: boutique, locale: 'ja', data: { name: '銀座本店' } });
    await strapi.documents(UID.boutique).publish({ documentId: boutique, locale: 'ja' });
    const again = await strapi.documents(UID.appointment).findOne({ documentId: created.documentId, status: 'published', populate });
    assert.equal(again.boutique?.documentId, boutique, 'relation survives a boutique republish');

    await strapi.documents(UID.product).update({ documentId: product, locale: 'ja', data: { priceJpy: 3000 } });
    await strapi.documents(UID.product).publish({ documentId: product, locale: 'ja' });
    const afterProduct = await strapi.documents(UID.appointment).findOne({ documentId: created.documentId, status: 'published', populate });
    assert.equal(afterProduct.products?.[0]?.documentId, product, 'relation survives a product republish');

    await strapi.documents(UID.notification).create({
      data: { appointmentReference: 'APT-0001', channel: 'line', outcome: 'sent', sentAt: new Date().toISOString(), detail: 'probe', recordedBy: 'test' },
    });
    const logged = () => strapi.documents(UID.notification).findMany({ filters: { appointmentReference: { $eq: 'APT-0001' } } });
    assert.equal((await logged()).length, 1, 'notification is found by appointment reference');

    await strapi.documents(UID.appointment).update({ documentId: created.documentId, data: { customerNote: 'edited after confirmation' } });
    await strapi.documents(UID.appointment).publish({ documentId: created.documentId });
    assert.equal((await logged()).length, 1, 'notification survives a republish of its appointment');
    const republished = await strapi.documents(UID.appointment).findOne({ documentId: created.documentId, status: 'published', populate });
    assert.equal(republished.boutique?.documentId, boutique, 'the republished appointment keeps its boutique');
    assert.equal(republished.products?.[0]?.documentId, product, 'and its product');
  });

  it('keeps a product in its collection when the collection is republished', async () => {
    const collection = (await strapi.documents(UID.collection).create({
      locale: 'ja', status: 'published', data: { name: '旅', slug: 'voyage-probe' },
    })).documentId;
    await strapi.documents(UID.product).update({ documentId: product, locale: 'ja', data: { collection } });
    await strapi.documents(UID.product).publish({ documentId: product, locale: 'ja' });
    const inCollection = () => strapi.documents(UID.product).findMany({
      locale: 'ja', status: 'published', filters: { collection: { slug: { $eq: 'voyage-probe' } } }, fields: ['slug'],
    });
    assert.deepEqual((await inCollection()).map((p) => p.slug), ['probe']);

    await strapi.documents(UID.collection).update({ documentId: collection, locale: 'ja', data: { name: '旅の品' } });
    await strapi.documents(UID.collection).publish({ documentId: collection, locale: 'ja' });
    assert.deepEqual((await inCollection()).map((p) => p.slug), ['probe'], 'the product stays in its collection');
  });

  it("applies the validation middleware, rejecting with the app's own ValidationError", async () => {
    // Core's error middleware answers 400 only for errors from the app's @strapi/utils. A plugin that bundles its own
    // copy throws a look-alike class, and the Content Manager shows staff "Internal Server Error" instead of the reason.
    const { errors } = requireFromApp('@strapi/utils');
    const appValidationError = (message) => (error) => {
      assert.ok(error instanceof errors.ValidationError, `${error?.name} is not the app's @strapi/utils ValidationError`);
      assert.match(error.message, message);
      return true;
    };
    await assert.rejects(
      strapi.documents(UID.stock).create({ data: { productSlug: 'probe', boutiqueSlug: 'ginza', quantity: 1 } }),
      appValidationError(/already exists/)
    );
    await assert.rejects(
      strapi.documents(UID.product).create({
        locale: 'ja',
        data: { name: 'x', slug: 'bad-occasion', sku: 'X-1', category: 'bag', priceJpy: 1, giftOccasions: ['graduation'] },
      }),
      appValidationError(/graduation/)
    );
    await assert.rejects(
      strapi.documents(UID.boutique).create({
        locale: 'ja',
        data: { name: 'x', slug: 'bad-hours', openingHours: [{ weekday: 'mon', opens: '20:00', closes: '11:00' }] },
      }),
      appValidationError(/open before/)
    );
  });
});
