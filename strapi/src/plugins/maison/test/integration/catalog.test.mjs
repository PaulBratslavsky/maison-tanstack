import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bootStrapi } from './harness.mjs';

describe('catalog service on seeded data', () => {
  let strapi;
  let catalog;
  before(async () => {
    strapi = await bootStrapi('catalog');
    await strapi.plugin('maison').service('seed').loadDemoCatalog();
    catalog = strapi.plugin('maison').service('catalog');
  });
  after(async () => {
    await strapi?.destroy();
  });

  it('lists the three collections with their product counts', async () => {
    const collections = await catalog.browseCollections('ja');
    assert.deepEqual(collections.map((c) => c.slug).sort(), ['atelier', 'gifts', 'voyage']);
    assert.equal(collections.reduce((sum, c) => sum + c.productCount, 0), 12);
    assert.equal(collections.find((c) => c.slug === 'gifts').name, 'ギフト');
    assert.equal((await catalog.browseCollections('en')).find((c) => c.slug === 'gifts').name, 'Gifts');
  });

  it('answers the demo question: travel gifts under ¥400,000 in stock at Ginza', async () => {
    const result = await catalog.searchProducts('en', { occasion: 'travel', maxPriceJpy: 400000, inStockAt: 'ginza', limit: 10 });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.value.products.map((p) => p.slug), ['weekender-50', 'garment-carrier', 'watch-roll-trois', 'passport-cover', 'luggage-tag-duo']);
    assert.equal(result.value.products[0].name, 'Weekender 50');
  });

  it('returns product details with stock per boutique', async () => {
    const product = await catalog.getProduct('en', 'weekender-50');
    assert.equal(product.locale, 'en');
    assert.deepEqual(product.stock.find((s) => s.boutique === 'ginza'), { boutique: 'ginza', name: 'Ginza Flagship', quantity: 2 });
  });

  it('falls back to ja for a product without an en version', async () => {
    await strapi.documents('plugin::maison.product').create({
      locale: 'ja', status: 'published', data: { name: '限定品', slug: 'ja-only', sku: 'MSN-JA-1', category: 'objet', priceJpy: 10000 },
    });
    const product = await catalog.getProduct('en', 'ja-only');
    assert.equal(product.locale, 'ja');
    assert.equal(product.name, '限定品');
  });

  it('never returns a product that was never published', async () => {
    await strapi.documents('plugin::maison.product').create({
      locale: 'ja', data: { name: '下書き', slug: 'draft-only', sku: 'MSN-DR-1', category: 'objet', priceJpy: 1 },
    });
    const { products } = (await catalog.searchProducts('ja', { limit: 20 })).value;
    assert.ok(!products.some((p) => p.slug === 'draft-only'));
    assert.equal(await catalog.getProduct('ja', 'draft-only'), null);
  });

  it('reports Osaka closed on Tuesday 6 October and stock per boutique', async () => {
    const boutiques = (await catalog.getBoutiques('ja', { date: '2026-10-06', productSlugs: ['weekender-50'] })).value;
    const osaka = boutiques.find((b) => b.slug === 'osaka');
    const ginza = boutiques.find((b) => b.slug === 'ginza');
    assert.equal(osaka.openOnDate, false);
    assert.equal(ginza.openOnDate, true);
    assert.deepEqual(ginza.stock, [{ product: 'weekender-50', quantity: 2 }]);
  });

  it('answers stock questions about an unknown or unpublished product with not_found, never zero stock', async () => {
    const product = 'plugin::maison.product';
    await strapi.documents(product).create({
      locale: 'ja', data: { name: '未公開', slug: 'unpublished-piece', sku: 'MSN-DR-2', category: 'objet', priceJpy: 1 },
    });
    for (const slug of ['no-such-piece', 'unpublished-piece']) {
      const result = await catalog.getBoutiques('ja', { productSlugs: ['weekender-50', slug] });
      assert.equal(result.ok, false, `${slug}: ${JSON.stringify(result)}`);
      assert.equal(result.code, 'not_found');
      assert.match(result.message, new RegExp(`"${slug}"`));
      assert.match(result.hint, /search_products/);
    }

    // A product with no en version is still known in en, as view_product finds it.
    await strapi.documents(product).create({
      locale: 'ja', status: 'published', data: { name: '日本限定', slug: 'japan-only', sku: 'MSN-JA-2', category: 'objet', priceJpy: 20000 },
    });
    const fallback = await catalog.getBoutiques('en', { productSlugs: ['japan-only'] });
    assert.equal(fallback.ok, true, JSON.stringify(fallback));
    assert.ok(fallback.value.every((b) => b.stock[0].quantity === 0), 'known, and not in stock anywhere');
  });

  it('answers a search in an unknown boutique or collection with not_found, never an empty result', async () => {
    const boutique = await catalog.searchProducts('en', { inStockAt: 'kyoto' });
    assert.equal(boutique.code, 'not_found');
    assert.match(boutique.message, /"kyoto"/);
    assert.match(boutique.hint, /find_boutiques/);

    const collection = await catalog.searchProducts('en', { collection: 'no-such-line' });
    assert.equal(collection.code, 'not_found');
    assert.match(collection.message, /"no-such-line"/);
    assert.match(collection.hint, /browse_collections/);
  });
});
