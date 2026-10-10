import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, bootStrapi } from './harness.mjs';

describe('seed service', () => {
  let strapi;
  let seed;
  before(async () => {
    strapi = await bootStrapi('seed');
    seed = strapi.plugin('maison').service('seed');
  });
  after(async () => {
    await strapi?.destroy();
  });

  it('loads the catalog in ja and en, published', async () => {
    assert.deepEqual(await seed.loadDemoCatalog(), {
      created: true, collections: 3, products: 12, boutiques: 3, stockLevels: 36, knowledge: 16, knowledgeJa: 16,
    });
    for (const locale of ['ja', 'en']) {
      assert.equal(await strapi.documents('plugin::maison.product').count({ locale, status: 'published' }), 12, `12 ${locale} products`);
      assert.equal(await strapi.documents('plugin::maison.boutique').count({ locale, status: 'published' }), 3, `3 ${locale} boutiques`);
    }
    assert.equal(await strapi.documents('plugin::maison.knowledge').count({ locale: 'en', status: 'published' }), 16, '16 en knowledge entries');
    assert.equal(await strapi.documents('plugin::maison.knowledge').count({ locale: 'ja', status: 'published' }), 16, '16 ja knowledge entries');
    const weekender = await strapi.documents('plugin::maison.product').findFirst({
      locale: 'en', status: 'published', filters: { slug: 'weekender-50' }, populate: { images: true, collection: true },
    });
    assert.equal(weekender.name, 'Weekender 50');
    assert.equal(weekender.collection?.slug, 'voyage');
    assert.equal(weekender.images?.length, 1);
  });

  it('does nothing the second time', async () => {
    assert.deepEqual(await seed.loadDemoCatalog(), { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 0, knowledgeJa: 0 });
  });

  it('adds the product knowledge in both languages to a catalog loaded without it, and leaves the catalog as it is', async () => {
    const entries = await strapi.documents('plugin::maison.knowledge').findMany({ locale: 'en', fields: ['documentId'], limit: 100 });
    for (const { documentId } of entries) await strapi.documents('plugin::maison.knowledge').delete({ documentId, locale: '*' });
    assert.deepEqual(await seed.loadDemoCatalog(), { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 16, knowledgeJa: 16 });
    assert.equal(await strapi.documents('plugin::maison.knowledge').count({ locale: 'ja', status: 'published' }), 16);
    assert.equal(await strapi.documents('plugin::maison.product').count({ locale: 'ja', status: 'published' }), 12);
  });

  it('reset removes appointments, notifications and inquiries and keeps the catalog', async () => {
    const boutique = await strapi.documents('plugin::maison.boutique').findFirst({ locale: 'ja', status: 'published', filters: { slug: 'ginza' } });
    await strapi.documents('plugin::maison.appointment').create({
      data: { reference: 'APT-9001', customer: SUBJECT_A, requestedFor: '2026-10-10T05:00:00.000Z', boutique: { documentId: boutique.documentId, locale: 'ja' } },
    });
    await strapi.documents('plugin::maison.inquiry').create({ data: { customer: SUBJECT_A, message: 'Can the coffret hold a watch?' } });
    assert.deepEqual(await seed.resetDemoAppointments(), { appointments: 1, notifications: 0, questions: 0, inquiries: 1, knowledge: 0 });
    assert.equal(await strapi.documents('plugin::maison.inquiry').count(), 0);
    assert.equal(await strapi.documents('plugin::maison.product').count({ locale: 'ja', status: 'published' }), 12);
  });
});
