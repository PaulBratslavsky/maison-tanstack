import { describe, expect, it, vi } from 'vitest';
import boutiquesController from '../../server/src/controllers/boutiques';
import collectionsController from '../../server/src/controllers/collections';
import customerController from '../../server/src/controllers/customer';
import knowledgeController from '../../server/src/controllers/knowledge';
import productsController from '../../server/src/controllers/products';
import { browseCollectionsTool } from '../../server/src/mcp/tools/browse-collections';
import { findBoutiquesTool } from '../../server/src/mcp/tools/find-boutiques';
import { myAppointmentsTool } from '../../server/src/mcp/tools/my-appointments';
import { requestAppointmentTool } from '../../server/src/mcp/tools/request-appointment';
import { searchKnowledgeTool } from '../../server/src/mcp/tools/search-knowledge';
import { searchProductsTool } from '../../server/src/mcp/tools/search-products';
import { viewProductTool } from '../../server/src/mcp/tools/view-product';
import { fakeStrapi } from './fake-strapi';

const context = { userAbility: {} as any, user: { id: 1 } };
const SUBJECT = `line:U${'a'.repeat(32)}`;
const OTHER = `line:U${'b'.repeat(32)}`;

/** Enough of a Koa context: what Strapi's query and body parsers leave, the route's state, and the response. */
const fakeCtx = ({ query = {}, params = {}, body = undefined as unknown, state = {} as Record<string, unknown> } = {}) => {
  const headers: Record<string, string> = {};
  return {
    query, params, request: { body }, state, headers,
    status: 404, body: undefined as any,
    set: (field: string, value: string) => void (headers[field] = value),
  };
};
/** A catalog controller (collections, products or boutiques), with the catalog service as given. */
const withCatalog = <T>(controller: (deps: { strapi: any }) => T, catalog: Record<string, unknown>) =>
  controller({ strapi: fakeStrapi({ services: { catalog } }) });
const customerWith = (appointments: Record<string, unknown>) => customerController({ strapi: fakeStrapi({ services: { appointments } }) });

/** The error a tool returns for `args`, run against the same fake services. */
const toolErrorFor = async (tool: any, services: Record<string, unknown>, args: Record<string, unknown>) => {
  const result = await tool.createHandler(fakeStrapi({ services }), context)({ args, extra: {} });
  return JSON.parse(result.content[0].text).error;
};
/** The message the tool's own input schema gives for `args`. */
const schemaMessage = (tool: any, args: Record<string, unknown>) => tool.resolveInputSchema(context).safeParse(args).error.issues[0].message;

const card = { slug: 'weekender-50', name: 'Weekender 50', category: 'travel', priceJpy: 385000, imageUrl: null, occasions: ['travel'], personalizable: true, inStockAt: ['ginza'] };
const boutique = {
  slug: 'osaka', name: 'Osaka Shinsaibashi', city: 'Osaka', address: '…', hours: [{ weekday: 'mon', opens: '11:00', closes: '20:00' }],
  openOnDate: false, hoursOnDate: null, stock: [{ product: 'weekender-50', quantity: 1 }],
};
const view = {
  reference: 'APT-4821', status: 'requested', boutique: { slug: 'ginza', name: '銀座本店' },
  requestedFor: '2030-01-12T14:00:00+09:00', products: [{ slug: 'weekender-50', name: 'ウィークエンダー 50' }],
  note: '', confirmationSent: false,
};
const booking = { boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: '2030-01-12T14:00:00+09:00' };

describe('GET /collections (collections.find)', () => {
  it('answers what browse_collections returns, in the default locale', async () => {
    const browseCollections = vi.fn(async () => [{ slug: 'voyage', name: 'ヴォヤージュ', teaser: '旅', heroImageUrl: null, productCount: 4 }]);
    const ctx = fakeCtx();
    await withCatalog(collectionsController, { browseCollections }).find(ctx);
    expect(browseCollections).toHaveBeenCalledWith('ja');
    expect(ctx.status).toBe(200);
    expect(browseCollectionsTool.resolveOutputSchema(context).parse(ctx.body)).toEqual(ctx.body);
    expect(ctx.body.locale).toBe('ja');
  });

  it('rejects a locale the tools reject, with 400 invalid_input, before calling the service', async () => {
    const browseCollections = vi.fn();
    const ctx = fakeCtx({ query: { locale: 'fr' } });
    await withCatalog(collectionsController, { browseCollections }).find(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.code).toBe('invalid_input');
    expect(ctx.body.error.message).toMatch(/^locale: /);
    expect(browseCollections).not.toHaveBeenCalled();
  });
});

describe('GET /products (products.find)', () => {
  it('decodes the query string into the types search_products takes, and answers what the tool returns', async () => {
    const searchProducts = vi.fn(async () => ({ ok: true, value: { total: 1, products: [card] } }));
    const ctx = fakeCtx({ query: { occasion: 'travel', maxPriceJpy: '400000', minPriceJpy: '0', personalizable: 'true', inStockAt: 'ginza', limit: '5', locale: 'en' } });
    await withCatalog(productsController, { searchProducts }).find(ctx);
    const args = { occasion: 'travel', maxPriceJpy: 400000, minPriceJpy: 0, personalizable: true, inStockAt: 'ginza', limit: 5, locale: 'en' };
    expect(searchProducts).toHaveBeenCalledWith('en', args);
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ locale: 'en', total: 1, products: [card] });
    expect(searchProductsTool.resolveOutputSchema(context).parse(ctx.body)).toEqual(ctx.body);
  });

  it.each([
    [{ limit: '0' }],
    [{ limit: '21' }],
    [{ limit: 'ten' }],
    [{ limit: '' }],
    [{ limit: ['5', '6'] }],
    [{ maxPriceJpy: '-1' }],
    [{ maxPriceJpy: '1.5' }],
    [{ personalizable: 'yes' }],
    [{ personalizable: null }],
    [{ category: 'shoes' }],
    [{ inStockAt: 'Ginza Flagship' }],
    [{ query: 'x'.repeat(101) }],
  ])('answers %j with 400 invalid_input and never calls the service', async (query) => {
    const searchProducts = vi.fn();
    const ctx = fakeCtx({ query });
    await withCatalog(productsController, { searchProducts }).find(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.code).toBe('invalid_input');
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it('answers a minimum above the maximum the way search_products does', async () => {
    const searchProducts = vi.fn();
    const ctx = fakeCtx({ query: { minPriceJpy: '500000', maxPriceJpy: '100000' } });
    await withCatalog(productsController, { searchProducts }).find(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toEqual(await toolErrorFor(searchProductsTool, { catalog: { searchProducts } }, { minPriceJpy: 500000, maxPriceJpy: 100000 }));
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it('answers an unknown boutique with 404 and the hint the tool gives', async () => {
    const failure = { ok: false, code: 'not_found', message: 'No boutique "kyoto".', hint: 'Call find_boutiques to find valid boutique slugs.' };
    const searchProducts = vi.fn(async () => failure);
    const ctx = fakeCtx({ query: { inStockAt: 'kyoto' } });
    await withCatalog(productsController, { searchProducts }).find(ctx);
    expect(ctx.status).toBe(404);
    expect(ctx.body).toEqual({ error: { code: 'not_found', message: failure.message, hint: failure.hint } });
  });
});

describe('GET /products/:slug (products.findOne)', () => {
  it('answers what view_product returns, with the slug from the path', async () => {
    const product = { slug: 'weekender-50', name: 'Weekender 50' };
    const getProduct = vi.fn(async () => product);
    const ctx = fakeCtx({ params: { slug: 'weekender-50' }, query: { locale: 'en', slug: 'passport-cover' } });
    await withCatalog(productsController, { getProduct }).findOne(ctx);
    expect(getProduct).toHaveBeenCalledWith('en', 'weekender-50');
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ product });
  });

  it('answers an unknown slug with 404 and exactly the error view_product returns', async () => {
    const getProduct = vi.fn(async () => null);
    const ctx = fakeCtx({ params: { slug: 'no-such-piece' } });
    await withCatalog(productsController, { getProduct }).findOne(ctx);
    expect(ctx.status).toBe(404);
    expect(ctx.body.error).toEqual(await toolErrorFor(viewProductTool, { catalog: { getProduct } }, { slug: 'no-such-piece' }));
    expect(ctx.body.error.hint).toBe('Call search_products to find valid product slugs.');
  });

  it('rejects a slug the tool rejects, with 400', async () => {
    const getProduct = vi.fn();
    const ctx = fakeCtx({ params: { slug: 'Weekender 50' } });
    await withCatalog(productsController, { getProduct }).findOne(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.message).toBe(`slug: ${schemaMessage(viewProductTool, { slug: 'Weekender 50' })}`);
    expect(getProduct).not.toHaveBeenCalled();
  });
});

describe('GET /boutiques (boutiques.find)', () => {
  it('takes a list as a repeated parameter and answers what find_boutiques returns', async () => {
    const getBoutiques = vi.fn(async () => ({ ok: true, value: [boutique] }));
    const ctx = fakeCtx({ query: { productSlugs: ['weekender-50', 'passport-cover'], date: '2030-01-15' } });
    await withCatalog(boutiquesController, { getBoutiques }).find(ctx);
    expect(getBoutiques).toHaveBeenCalledWith('ja', { date: '2030-01-15', productSlugs: ['weekender-50', 'passport-cover'] });
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ date: '2030-01-15', boutiques: [boutique] });
    expect(findBoutiquesTool.resolveOutputSchema(context).parse(ctx.body)).toEqual(ctx.body);
  });

  it('takes a single parameter as a list of one, and answers date null without a date', async () => {
    const getBoutiques = vi.fn(async () => ({ ok: true, value: [boutique] }));
    const ctx = fakeCtx({ query: { productSlugs: 'weekender-50' } });
    await withCatalog(boutiquesController, { getBoutiques }).find(ctx);
    expect(getBoutiques).toHaveBeenCalledWith('ja', { date: undefined, productSlugs: ['weekender-50'] });
    expect(ctx.body.date).toBeNull();
  });

  it('rejects a date that is not on the calendar with the same message as the tool', async () => {
    const getBoutiques = vi.fn();
    const ctx = fakeCtx({ query: { date: '2026-02-30' } });
    await withCatalog(boutiquesController, { getBoutiques }).find(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toEqual({ code: 'invalid_input', message: `date: ${schemaMessage(findBoutiquesTool, { date: '2026-02-30' })}` });
    expect(ctx.body.error.message).toBe('date: Not a real calendar date.');
    expect(getBoutiques).not.toHaveBeenCalled();
  });

  it.each([
    ['six products', { productSlugs: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    ['a comma list, which is not the documented form', { productSlugs: 'weekender-50,passport-cover' }],
  ])('rejects %s with 400', async (_label, query) => {
    const getBoutiques = vi.fn();
    const ctx = fakeCtx({ query });
    await withCatalog(boutiquesController, { getBoutiques }).find(ctx);
    expect(ctx.status).toBe(400);
    expect(getBoutiques).not.toHaveBeenCalled();
  });

  it('answers an unknown product with 404 and the hint the tool gives', async () => {
    const failure = { ok: false, code: 'not_found', message: 'No published product "no-such-piece".', hint: 'Call search_products to find valid product slugs.' };
    const getBoutiques = vi.fn(async () => failure);
    const ctx = fakeCtx({ query: { productSlugs: 'no-such-piece' } });
    await withCatalog(boutiquesController, { getBoutiques }).find(ctx);
    expect(ctx.status).toBe(404);
    expect(ctx.body.error).toEqual(await toolErrorFor(findBoutiquesTool, { catalog: { getBoutiques } }, { productSlugs: ['no-such-piece'] }));
  });
});

describe('POST /appointments (customer.requestAppointment)', () => {
  it("books for the session's customer, marked as made on the web, and answers 201 with what the tool returns", async () => {
    const request = vi.fn(async () => ({ ok: true, value: view }));
    const ctx = fakeCtx({ state: { maisonCustomer: SUBJECT }, body: { ...booking, note: 'A gift' } });
    await customerWith({ request }).requestAppointment(ctx);
    expect(request).toHaveBeenCalledWith({ subject: SUBJECT, ...booking, note: 'A gift', createdVia: 'web' });
    expect(ctx.status).toBe(201);
    expect(requestAppointmentTool.resolveOutputSchema(context).parse(ctx.body)).toEqual({ appointment: view });
  });

  it("asks for the names in the customer's language when the body has a locale", async () => {
    const request = vi.fn(async () => ({ ok: true, value: view }));
    const ctx = fakeCtx({ state: { maisonCustomer: SUBJECT }, body: { ...booking, locale: 'en' } });
    await customerWith({ request }).requestAppointment(ctx);
    expect(request).toHaveBeenCalledWith({ subject: SUBJECT, ...booking, note: undefined, locale: 'en', createdVia: 'web' });
    expect(ctx.status).toBe(201);
  });

  it('never takes the customer, or where the request came from, from the body', async () => {
    const request = vi.fn(async () => ({ ok: true, value: view }));
    const ctx = fakeCtx({ state: { maisonCustomer: SUBJECT }, body: { ...booking, customer: OTHER, subject: OTHER, createdVia: 'concierge' } });
    await customerWith({ request }).requestAppointment(ctx);
    expect(request).toHaveBeenCalledWith({ subject: SUBJECT, ...booking, note: undefined, createdVia: 'web' });
  });

  it('rejects a day that is not on the calendar with the same message as request_appointment', async () => {
    const request = vi.fn();
    const requestedFor = '2026-02-30T14:00:00+09:00';
    const ctx = fakeCtx({ state: { maisonCustomer: SUBJECT }, body: { ...booking, requestedFor } });
    await customerWith({ request }).requestAppointment(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toEqual({
      code: 'invalid_input',
      message: `requestedFor: ${schemaMessage(requestAppointmentTool, { ...booking, requestedFor })}`,
    });
    expect(ctx.body.error.message).toBe('requestedFor: Not a real calendar date.');
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['no body', undefined],
    ['an empty product list', { ...booking, productSlugs: [] }],
    ['a time without an offset', { ...booking, requestedFor: '2030-01-12T14:00:00' }],
    ['a note over 500 characters', { ...booking, note: 'x'.repeat(501) }],
    ['a locale the tools reject', { ...booking, locale: 'fr' }],
  ])('rejects %s with 400 invalid_input', async (_label, body) => {
    const request = vi.fn();
    const ctx = fakeCtx({ state: { maisonCustomer: SUBJECT }, body });
    await customerWith({ request }).requestAppointment(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.code).toBe('invalid_input');
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404],
    ['in_the_past', 422],
    ['boutique_closed', 409],
    ['too_many_open_requests', 409],
  ])('answers %s with %i and the code, message and hint the tool would return', async (code, status) => {
    const request = vi.fn(async () => ({ ok: false, code, message: 'Not possible.', hint: 'Try another day.' }));
    const ctx = fakeCtx({ state: { maisonCustomer: SUBJECT }, body: booking });
    await customerWith({ request }).requestAppointment(ctx);
    expect(ctx.status).toBe(status);
    expect(ctx.body).toEqual({ error: { code, message: 'Not possible.', hint: 'Try another day.' } });
  });

  it('answers 401 and books nothing when the route has no verified customer', async () => {
    const request = vi.fn();
    for (const state of [{}, { maisonCustomer: 'line:Unot-a-subject' }]) {
      const ctx = fakeCtx({ state, body: booking });
      await customerWith({ request }).requestAppointment(ctx);
      expect(ctx.status).toBe(401);
      expect(ctx.headers['WWW-Authenticate']).toBe('Bearer');
      expect(ctx.body.error.code).toBe('not_signed_in');
    }
    expect(request).not.toHaveBeenCalled();
  });
});

describe('GET /my-appointments (customer.myAppointments)', () => {
  it("lists the session's customer's own visits in the requested locale, as my_appointments does", async () => {
    const listForCustomer = vi.fn(async () => [view]);
    const ctx = fakeCtx({ state: { maisonCustomer: SUBJECT }, query: { locale: 'en' } });
    await customerWith({ listForCustomer }).myAppointments(ctx);
    expect(listForCustomer).toHaveBeenCalledWith(SUBJECT, 'en');
    expect(ctx.status).toBe(200);
    expect(myAppointmentsTool.resolveOutputSchema(context).parse(ctx.body)).toEqual({ appointments: [view] });
  });

  it('uses the default locale, and rejects one the tool rejects', async () => {
    const listForCustomer = vi.fn(async () => []);
    const ctx = fakeCtx({ state: { maisonCustomer: SUBJECT } });
    await customerWith({ listForCustomer }).myAppointments(ctx);
    expect(listForCustomer).toHaveBeenCalledWith(SUBJECT, 'ja');

    const bad = fakeCtx({ state: { maisonCustomer: SUBJECT }, query: { locale: 'fr' } });
    await customerWith({ listForCustomer }).myAppointments(bad);
    expect(bad.status).toBe(400);
    expect(listForCustomer).toHaveBeenCalledTimes(1);
  });

  it('answers 401 and lists nothing when the route has no verified customer', async () => {
    const listForCustomer = vi.fn();
    const ctx = fakeCtx();
    await customerWith({ listForCustomer }).myAppointments(ctx);
    expect(ctx.status).toBe(401);
    expect(listForCustomer).not.toHaveBeenCalled();
  });
});

describe('GET /knowledge (knowledge.find)', () => {
  const entry = { title: 'How do I care for the leather?', answer: 'Wipe it with a dry cloth.', category: 'care', productSlugs: [] };

  it('reads productSlugs as a list, even one, and answers what search_knowledge returns', async () => {
    const searchKnowledge = vi.fn(async () => ({ ok: true, value: { entries: [entry] } }));
    const ctx = fakeCtx({ query: { query: 'leather care', productSlugs: 'weekender-50', locale: 'en' } });
    await withCatalog(knowledgeController, { searchKnowledge }).find(ctx);
    // Exactly what the service reads, as the tool passes it: the locale is its own argument, not part of the input.
    expect(searchKnowledge).toHaveBeenCalledWith('en', { query: 'leather care', productSlugs: ['weekender-50'] });
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ locale: 'en', entries: [entry] });
    expect(searchKnowledgeTool.resolveOutputSchema(context).parse(ctx.body)).toEqual(ctx.body);
  });

  it('passes the question on trimmed', async () => {
    const searchKnowledge = vi.fn(async () => ({ ok: true, value: { entries: [] } }));
    const ctx = fakeCtx({ query: { query: '  leather care \n' } });
    await withCatalog(knowledgeController, { searchKnowledge }).find(ctx);
    expect(searchKnowledge).toHaveBeenCalledWith('ja', { query: 'leather care', productSlugs: undefined });
    expect(ctx.status).toBe(200);
  });

  it('answers a missing question with 400 invalid_input, before calling the service', async () => {
    const searchKnowledge = vi.fn();
    const ctx = fakeCtx({ query: { locale: 'en' } });
    await withCatalog(knowledgeController, { searchKnowledge }).find(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.code).toBe('invalid_input');
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it.each([
    ['six products', { query: 'Will it fit?', productSlugs: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'productSlugs'],
    ['a comma list, which is not the documented form', { query: 'Will it fit?', productSlugs: 'weekender-50,passport-cover' }, 'productSlugs'],
    ['a question of 301 characters', { query: 'x'.repeat(301) }, 'query'],
    ['a question of only spaces', { query: '   ' }, 'query'],
  ])('rejects %s with 400 invalid_input, before calling the service', async (_label, query, field) => {
    const searchKnowledge = vi.fn();
    const ctx = fakeCtx({ query });
    await withCatalog(knowledgeController, { searchKnowledge }).find(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.code).toBe('invalid_input');
    expect(ctx.body.error.message).toMatch(new RegExp(`^${field}`)); // it names the field that was wrong, not another
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it('answers an unknown product with 404 and the error the tool gives', async () => {
    const failure = { ok: false, code: 'not_found', message: 'No published product "no-such-piece".', hint: 'Call search_products to find valid product slugs.' };
    const ctx = fakeCtx({ query: { query: 'Will it fit?', productSlugs: 'no-such-piece' } });
    await withCatalog(knowledgeController, { searchKnowledge: vi.fn(async () => failure) }).find(ctx);
    expect(ctx.status).toBe(404);
    expect(ctx.body).toEqual({ error: { code: 'not_found', message: failure.message, hint: failure.hint } });
  });
});
