import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bootStrapi } from './harness.mjs';

const KNOWLEDGE = 'plugin::maison.knowledge';

describe('product knowledge on seeded data', () => {
  let strapi;
  let catalog;
  before(async () => {
    strapi = await bootStrapi('knowledge');
    await strapi.plugin('maison').service('seed').loadDemoCatalog();
    catalog = strapi.plugin('maison').service('catalog');
  });
  after(async () => {
    await strapi?.destroy();
  });

  it('answers a leather care question with the leather care entry first', async () => {
    const result = await catalog.searchKnowledge('en', { query: 'How do I care for the leather?' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.entries[0].title, 'How do I care for the leather?');
    assert.ok(result.value.entries.length <= 4);
  });

  it("puts a piece's own entry first, and leaves out entries about other pieces", async () => {
    const result = await catalog.searchKnowledge('en', { query: 'Will it fit in the overhead bin?', productSlugs: ['cabin-case-55'] });
    assert.equal(result.value.entries[0].title, 'Will the Cabin Case 55 fit in an airline overhead bin?');
    assert.ok(result.value.entries.every((entry) => entry.productSlugs.length === 0 || entry.productSlugs.includes('cabin-case-55')));
  });

  it('finds nothing for a question Maison has not written about', async () => {
    assert.deepEqual((await catalog.searchKnowledge('en', { query: 'Can I pay in bitcoin?' })).value.entries, []);
  });

  it('never returns a draft', async () => {
    await strapi.documents(KNOWLEDGE).create({
      locale: 'en',
      data: { title: 'A draft about zebras', answer: 'Not written yet.', category: 'store', productSlugs: [], keywords: 'zebra' },
    });
    assert.deepEqual((await catalog.searchKnowledge('en', { query: 'zebra' })).value.entries, []);
  });

  it('finds an entry that has no English version from its Japanese one', async () => {
    await strapi.documents(KNOWLEDGE).create({
      locale: 'ja', status: 'published',
      data: { title: 'キリンについて', answer: 'キリンの方針です。', category: 'store', productSlugs: [], keywords: 'giraffe' },
    });
    assert.deepEqual((await catalog.searchKnowledge('en', { query: 'giraffe' })).value.entries.map((entry) => entry.title), ['キリンについて']);
  });

  it('answers an unknown product with not_found and the search_products hint', async () => {
    const result = await catalog.searchKnowledge('en', { query: 'Will it fit?', productSlugs: ['no-such-piece'] });
    assert.equal(result.code, 'not_found');
    assert.equal(result.message, 'No published product "no-such-piece".');
    assert.match(result.hint, /search_products/);
  });
});
