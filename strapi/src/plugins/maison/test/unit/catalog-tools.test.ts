import { describe, expect, it, vi } from 'vitest';
import { browseCollectionsTool } from '../../server/src/mcp/tools/browse-collections';
import { findBoutiquesTool } from '../../server/src/mcp/tools/find-boutiques';
import { viewProductTool } from '../../server/src/mcp/tools/view-product';
import { searchProductsTool } from '../../server/src/mcp/tools/search-products';
import { searchKnowledgeTool } from '../../server/src/mcp/tools/search-knowledge';
import { fakeStrapi } from './fake-strapi';

const context = { userAbility: {} as any, user: { id: 1 } };
const run = (tool: any, catalog: Record<string, unknown>, args: Record<string, unknown>, config = {}) =>
  tool.createHandler(fakeStrapi({ services: { catalog }, config }), context)({ args, extra: {} });
const matchesOutput = (tool: any, result: any) => tool.resolveOutputSchema(context).parse(result.structuredContent);
const errorOf = (result: any) => JSON.parse(result.content[0].text).error;

const card = { slug: 'weekender-50', name: 'Weekender 50', category: 'travel', priceJpy: 385000, imageUrl: null, occasions: ['travel'], personalizable: true, inStockAt: ['ginza'] };

describe('catalog tool descriptions', () => {
  it("each say what the tool won't do", () => {
    expect(browseCollectionsTool.description).toMatch(/It doesn't list products or prices\./);
    expect(viewProductTool.description).toMatch(/Never invent details the product doesn't have\./);
    expect(findBoutiquesTool.description).toMatch(/It doesn't book anything\./);
    expect(searchKnowledgeTool.description).toMatch(/Never make up a policy\./);
  });
});

describe('browse_collections', () => {
  it('uses the configured default locale and returns schema-valid output', async () => {
    const browseCollections = vi.fn(async () => [{ slug: 'voyage', name: 'ヴォヤージュ', teaser: '旅', heroImageUrl: null, productCount: 4 }]);
    const result = await run(browseCollectionsTool, { browseCollections }, {});
    expect(browseCollections).toHaveBeenCalledWith('ja');
    expect(result.structuredContent.locale).toBe('ja');
    expect(() => matchesOutput(browseCollectionsTool, result)).not.toThrow();
  });
});

describe('search_products', () => {
  it('passes filters through and returns schema-valid output', async () => {
    const searchProducts = vi.fn(async () => ({ ok: true, value: { total: 1, products: [card] } }));
    const args = { occasion: 'travel', maxPriceJpy: 400000, inStockAt: 'ginza', locale: 'en' };
    const result = await run(searchProductsTool, { searchProducts }, args);
    expect(searchProducts).toHaveBeenCalledWith('en', args);
    expect(result.structuredContent).toEqual({ locale: 'en', total: 1, products: [card] });
    expect(() => matchesOutput(searchProductsTool, result)).not.toThrow();
  });

  it('rejects a min price above the max price with invalid_input', async () => {
    const result = await run(searchProductsTool, { searchProducts: vi.fn() }, { minPriceJpy: 500000, maxPriceJpy: 100000 });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error.code).toBe('invalid_input');
  });

  it.each([
    ['boutique', { inStockAt: 'kyoto' }, 'No boutique "kyoto".', 'Call find_boutiques to find valid boutique slugs.'],
    ['collection', { collection: 'no-such-line' }, 'No collection "no-such-line".', 'Call browse_collections to find valid collection slugs.'],
  ])('answers an unknown %s with not_found and its hint, never an empty result', async (_label, args, message, hint) => {
    const searchProducts = vi.fn(async () => ({ ok: false, code: 'not_found', message, hint }));
    const result = await run(searchProductsTool, { searchProducts }, args);
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual({ code: 'not_found', message, hint });
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('view_product', () => {
  it('returns not_found with a recovery hint for an unknown slug', async () => {
    const result = await run(viewProductTool, { getProduct: vi.fn(async () => null) }, { slug: 'nope' });
    const { error } = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(error.code).toBe('not_found');
    expect(error.hint).toMatch(/search_products/);
  });

  it('wraps a found product in schema-valid output', async () => {
    const product = {
      locale: 'ja', slug: 'weekender-50', sku: 'MSN-VY-050', name: 'ウィークエンダー 50', category: 'travel', priceJpy: 385000,
      description: '…', craftStory: '…', dimensionsCm: { width: 50, height: 29, depth: 22 },
      personalization: { offered: true, kinds: ['initials-hot-stamp'], leadDays: 3 },
      images: [{ url: 'https://cms.example.test/uploads/a.png', alt: 'Weekender 50' }], occasions: ['travel'],
      collection: { slug: 'voyage', name: 'ヴォヤージュ' }, stock: [{ boutique: 'ginza', name: '銀座本店', quantity: 2 }],
    };
    const result = await run(viewProductTool, { getProduct: vi.fn(async () => product) }, { slug: 'weekender-50' });
    expect(result.structuredContent).toEqual({ product });
    expect(() => matchesOutput(viewProductTool, result)).not.toThrow();
  });
});

describe('find_boutiques', () => {
  it('returns schema-valid output with openOnDate', async () => {
    const boutique = {
      slug: 'osaka', name: '大阪心斎橋店', city: '大阪', address: '…', hours: [{ weekday: 'mon', opens: '11:00', closes: '20:00' }],
      openOnDate: false, hoursOnDate: null, stock: [{ product: 'weekender-50', quantity: 0 }],
    };
    const getBoutiques = vi.fn(async () => ({ ok: true, value: [boutique] }));
    const result = await run(findBoutiquesTool, { getBoutiques }, { date: '2026-10-06', productSlugs: ['weekender-50'] });
    expect(getBoutiques).toHaveBeenCalledWith('ja', { date: '2026-10-06', productSlugs: ['weekender-50'] });
    expect(result.structuredContent).toEqual({ date: '2026-10-06', boutiques: [boutique] });
    expect(() => matchesOutput(findBoutiquesTool, result)).not.toThrow();
  });

  it('answers an unknown product with not_found and a search_products hint, never zero stock', async () => {
    const message = 'No published product "no-such-piece".';
    const hint = 'Call search_products to find valid product slugs.';
    const getBoutiques = vi.fn(async () => ({ ok: false, code: 'not_found', message, hint }));
    const result = await run(findBoutiquesTool, { getBoutiques }, { productSlugs: ['weekender-50', 'no-such-piece'] });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual({ code: 'not_found', message, hint });
    expect(result.structuredContent).toBeUndefined();
  });

  it('rejects a date that is not on the calendar instead of answering for another day', () => {
    const input = findBoutiquesTool.resolveInputSchema!(context);
    expect(input.safeParse({ date: '2026-10-06' }).success).toBe(true);
    expect(input.safeParse({ date: '2026-02-31' }).success, '31 February would answer for 3 March').toBe(false);
  });
});

describe('search_knowledge', () => {
  const entry = { title: 'How do I care for the leather?', answer: 'Wipe it with a dry cloth.', category: 'care', productSlugs: [] };

  it('searches in the default locale and returns schema-valid output', async () => {
    const searchKnowledge = vi.fn(async () => ({ ok: true, value: { entries: [entry] } }));
    const result = await run(searchKnowledgeTool, { searchKnowledge }, { query: 'leather care' });
    expect(searchKnowledge).toHaveBeenCalledWith('ja', { query: 'leather care' });
    expect(result.structuredContent).toEqual({ locale: 'ja', entries: [entry] });
    expect(() => matchesOutput(searchKnowledgeTool, result)).not.toThrow();
  });

  it('passes the products and the locale through', async () => {
    const searchKnowledge = vi.fn(async () => ({ ok: true, value: { entries: [] } }));
    await run(searchKnowledgeTool, { searchKnowledge }, { query: 'Will it fit?', productSlugs: ['cabin-case-55'], locale: 'en' });
    expect(searchKnowledge).toHaveBeenCalledWith('en', { query: 'Will it fit?', productSlugs: ['cabin-case-55'] });
  });

  it('answers an unknown product with not_found and the search_products hint', async () => {
    const message = 'No published product "no-such-piece".';
    const hint = 'Call search_products to find valid product slugs.';
    const searchKnowledge = vi.fn(async () => ({ ok: false, code: 'not_found', message, hint }));
    const result = await run(searchKnowledgeTool, { searchKnowledge }, { query: 'Will it fit?', productSlugs: ['no-such-piece'] });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual({ code: 'not_found', message, hint });
  });

  it('refuses an empty question and one over 300 characters', () => {
    const input = searchKnowledgeTool.resolveInputSchema!(context);
    expect(input.safeParse({ query: 'How do I care for the leather?' }).success).toBe(true);
    expect(input.safeParse({ query: '' }).success).toBe(false);
    expect(input.safeParse({ query: 'x'.repeat(301) }).success).toBe(false);
  });
});
