import { describe, expect, it, vi } from 'vitest';
import customerController from '../../server/src/controllers/customer';
import customerSession, { answerCustomerSessionErrors, CustomerSessionError } from '../../server/src/policies/customer-session';
import { notSignedIn } from '../../server/src/mcp/common';
import identityService from '../../server/src/services/identity';
import { fakeStrapi } from './fake-strapi';

const SUBJECT = `line:U${'4af4980629c1a7b3f1e2d3c4b5a69788'}`;
const TOKEN = 'mcp_at_customer-session-token';
const ADMIN_KEY = 'admin-key-behind-the-session';
/** What oauth-mcp-manager's resolveAccessToken answers for a session /mcp accepts. */
const VALID_SESSION = { valid: true, adminAccessKey: ADMIN_KEY, grantId: 7 };
/** Every reason resolveAccessToken gives for a session /mcp refuses (strapi-oauth-mcp-manager 1.1.0). */
const REASONS = ['unknown_token', 'token_expired', 'grant_revoked', 'decrypt_failed', 'user_inactive'];

const booking = { boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: '2030-01-12T14:00:00+09:00' };
const view = {
  reference: 'APT-4821', status: 'requested', boutique: { slug: 'ginza', name: '銀座本店' }, requestedFor: booking.requestedFor,
  products: [{ slug: 'weekender-50', name: 'ウィークエンダー 50' }], note: '', confirmationSent: false,
};

/** Maison with its real identity service, oauth-mcp-manager's oauth service when one is given, and a spy for bookings. */
const strapiWith = (oauth?: Record<string, unknown>) => {
  const book = vi.fn(async () => ({ ok: true, value: view }));
  const services: Record<string, unknown> = { appointments: { request: book } };
  const strapi = fakeStrapi({ services, plugins: oauth ? { 'strapi-oauth-mcp-manager': { oauth } } : {} });
  services.identity = identityService({ strapi });
  return { strapi, book };
};
/** oauth-mcp-manager 1.1 with a session /mcp accepts, for customer A, unless told otherwise. */
const withResolvers = (resolvers: Record<string, unknown> = {}) =>
  strapiWith({ resolveAccessToken: async () => VALID_SESSION, resolveSubject: async () => SUBJECT, ...resolvers });

/** Enough of a Koa context for the route: the request, its state, and the response. */
const koaContext = (headers: Record<string, string>) => {
  const responseHeaders: Record<string, string> = {};
  return {
    request: { headers, body: booking }, state: {} as Record<string, unknown>, query: {}, params: {},
    status: 404, body: undefined as any, headers: responseHeaders,
    set: (field: string, value: string) => void (responseHeaders[field] = value),
  };
};

/**
 * POST /api/maison/appointments as Strapi runs it: inside the middleware Maison's bootstrap adds, the policy gets a
 * copy of ctx's own properties (so the same request and state), and the controller runs only if the policy passes.
 */
const postAppointment = async (strapi: any, headers: Record<string, string> = {}) => {
  const ctx = koaContext(headers);
  await answerCustomerSessionErrors(ctx as any, async () => {
    const passed = await customerSession({ request: ctx.request, state: ctx.state } as any, {}, { strapi });
    if (passed !== true && passed !== undefined) throw new Error('PolicyError');
    await customerController({ strapi }).requestAppointment(ctx);
  });
  return ctx;
};

/** Everything Maison logged, as one string. */
const logged = (strapi: any) => JSON.stringify(Object.values(strapi.log).flatMap((log: any) => log.mock.calls));

const NOT_SIGNED_IN = { error: JSON.parse(notSignedIn().content[0].text).error };

describe('customer-session policy', () => {
  it('lets a LINE customer whose session /mcp would accept book, as ctx.state.maisonCustomer', async () => {
    const resolveAccessToken = vi.fn(async () => VALID_SESSION);
    const resolveSubject = vi.fn(async () => SUBJECT);
    const { strapi, book } = withResolvers({ resolveAccessToken, resolveSubject });
    const response = await postAppointment(strapi, { authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(201);
    expect(response.state.maisonCustomer).toBe(SUBJECT);
    expect(resolveAccessToken).toHaveBeenCalledWith(TOKEN);
    expect(resolveSubject).toHaveBeenCalledWith(`Bearer ${TOKEN}`);
    expect(book).toHaveBeenCalledWith(expect.objectContaining({ subject: SUBJECT, createdVia: 'web' }));
    expect(JSON.stringify(response.body)).not.toContain(ADMIN_KEY);
  });

  it('refuses a request without an Authorization header with 401, asking neither resolver, and books nothing', async () => {
    const resolveAccessToken = vi.fn(async () => VALID_SESSION);
    const resolveSubject = vi.fn(async () => SUBJECT);
    const { strapi, book } = withResolvers({ resolveAccessToken, resolveSubject });
    const response = await postAppointment(strapi);
    expect(response.status).toBe(401);
    expect(response.headers['WWW-Authenticate']).toBe('Bearer');
    expect(response.body).toEqual(NOT_SIGNED_IN);
    expect(response.state.maisonCustomer).toBeUndefined();
    expect(resolveAccessToken).not.toHaveBeenCalled();
    expect(resolveSubject).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  it.each(REASONS)(
    'refuses a session /mcp would refuse (%s) with 401 before resolving a customer, and books nothing',
    async (reason) => {
      const resolveSubject = vi.fn(async () => SUBJECT); // the grant still names a customer
      const { strapi, book } = withResolvers({ resolveAccessToken: async () => ({ valid: false, reason }), resolveSubject });
      const response = await postAppointment(strapi, { authorization: `Bearer ${TOKEN}` });
      expect(response.status).toBe(401);
      expect(response.headers['WWW-Authenticate']).toBe('Bearer');
      expect(response.body).toEqual(NOT_SIGNED_IN);
      expect(response.state.maisonCustomer).toBeUndefined();
      expect(resolveSubject).not.toHaveBeenCalled();
      expect(book).not.toHaveBeenCalled();
    }
  );

  it('refuses a malformed header with 401, asking neither resolver', async () => {
    const resolveAccessToken = vi.fn(async () => VALID_SESSION);
    const { strapi, book } = withResolvers({ resolveAccessToken });
    const response = await postAppointment(strapi, { authorization: 'Basic dXNlcjpwYXNz' });
    expect(response.status).toBe(401);
    expect(resolveAccessToken).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  it.each([
    ['a staff session, which holds no customer', null],
    ['uppercase hex', `line:U${'4AF4980629C1A7B3F1E2D3C4B5A69788'}`],
    ['no line: prefix', 'U4af4980629c1a7b3f1e2d3c4b5a69788'],
    ['an admin subject', 'admin:1'],
  ])('refuses a valid session that resolves to %s, as the MCP tools do', async (_label, subject) => {
    const { strapi, book } = withResolvers({ resolveSubject: async () => subject });
    const response = await postAppointment(strapi, { authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(401);
    expect(response.state.maisonCustomer).toBeUndefined();
    expect(book).not.toHaveBeenCalled();
  });

  it.each(['resolveAccessToken', 'resolveSubject'])(
    'answers 503 temporarily_unavailable, not a sign-out, when %s throws, and logs neither the token, the error message, nor the admin key',
    async (name) => {
      const { strapi, book } = withResolvers({
        [name]: async (value: string) => {
          throw new Error(`database is locked while reading ${value}`);
        },
      });
      const response = await postAppointment(strapi, { authorization: `Bearer ${TOKEN}` });
      expect(response.status).toBe(503);
      expect(response.headers['WWW-Authenticate']).toBeUndefined();
      expect(response.body.error.code).toBe('temporarily_unavailable');
      expect(response.body.error.message).toMatch(/server error/);
      expect(response.state.maisonCustomer).toBeUndefined();
      expect(book).not.toHaveBeenCalled();
      expect(strapi.log.warn).toHaveBeenCalled();
      expect(logged(strapi)).not.toContain(TOKEN);
      expect(logged(strapi)).not.toContain('database is locked');
      expect(logged(strapi)).not.toContain(ADMIN_KEY);
    }
  );

  it.each([
    ['not installed', () => strapiWith()],
    ['without resolveSubject', () => strapiWith({ resolveAccessToken: async () => VALID_SESSION })],
    ['without resolveAccessToken', () => strapiWith({ resolveSubject: async () => SUBJECT })],
  ])("answers 503 when oauth-mcp-manager is %s: customer sign-in isn't configured", async (_label, make) => {
    const { strapi, book } = make();
    for (const headers of [{}, { authorization: `Bearer ${TOKEN}` }]) {
      const response = await postAppointment(strapi, headers);
      expect(response.status).toBe(503);
      expect(response.headers['WWW-Authenticate']).toBeUndefined();
      expect(response.body.error.code).toBe('not_configured');
      expect(response.body.error.message).toMatch(/customer sign-in isn't configured/i);
      expect(response.state.maisonCustomer).toBeUndefined();
    }
    expect(book).not.toHaveBeenCalled();
  });

  it('never logs the token, the LINE user ID or the admin key of a customer it lets through', async () => {
    const { strapi } = withResolvers();
    await postAppointment(strapi, { authorization: `Bearer ${TOKEN}` });
    expect(logged(strapi)).not.toContain(TOKEN);
    expect(logged(strapi)).not.toContain(SUBJECT.slice('line:'.length));
    expect(logged(strapi)).not.toContain(ADMIN_KEY);
  });
});

describe('answerCustomerSessionErrors', () => {
  it('passes every other error on to Strapi untouched', async () => {
    const boom = new Error('boom');
    await expect(answerCustomerSessionErrors(koaContext({}) as any, async () => { throw boom; })).rejects.toBe(boom);
  });

  it('answers a refusal with the failure it carries', async () => {
    const ctx = koaContext({});
    await answerCustomerSessionErrors(ctx as any, async () => {
      throw new CustomerSessionError({ ok: false, code: 'not_configured', message: 'Not set up.', hint: 'Install it.' });
    });
    expect(ctx.status).toBe(503);
    expect(ctx.body).toEqual({ error: { code: 'not_configured', message: 'Not set up.', hint: 'Install it.' } });
  });
});
