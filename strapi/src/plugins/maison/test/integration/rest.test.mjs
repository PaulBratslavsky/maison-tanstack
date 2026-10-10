import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, SUBJECT_B, bootStrapi, tokyoDate, tokyoTime } from './harness.mjs';

// The REST routes book against the real clock, so the visits are 10 and 20 days ahead of it.
const IN_10_DAYS = tokyoDate(10);
const IN_20_DAYS = tokyoDate(20);
const TUESDAY = tokyoDate(10, { weekday: 2 }); // Osaka is closed all day on Tuesdays
const VISIT = tokyoTime(IN_10_DAYS, '14:00'); // Ginza is open every day
const APPOINTMENT = 'plugin::maison.appointment';
/** The catalog's actions, as a role holds them: plugin::maison.<controller>.<action>. */
const CATALOG_ACTIONS = { collections: ['find'], products: ['find', 'findOne'], boutiques: ['find'], knowledge: ['find'] };
const CATALOG_PATHS = [
  '/collections?locale=en', '/products?occasion=travel', '/products/weekender-50', '/boutiques?productSlugs=weekender-50',
  '/knowledge?query=leather%20care&locale=en',
];
const booking = { boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: VISIT };
/** Stands in for the decrypted admin key resolveAccessToken returns with a valid session. It must never come back. */
const STUB_ADMIN_KEY = 'stub-admin-key-behind-the-session';

describe('the REST door: /api/maison over HTTP', () => {
  let strapi;
  let baseUrl;
  let fullAccessToken;
  let websiteJwt;
  let reference;

  /** One request to /api/maison<path>. Tokens are sent, never logged. */
  const call = async (method, path, { token, body } = {}) => {
    const response = await fetch(new URL(`/api/maison${path}`, baseUrl), {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
  };

  /** What an admin does under Settings → Roles → Public, through users-permissions' role service: { controller: [actions] }. */
  const grantPublic = async (grants) => {
    const roles = strapi.plugin('users-permissions').service('role');
    const { id } = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'public' } });
    const { permissions } = await roles.findOne(id);
    for (const [controller, actions] of Object.entries(grants)) {
      for (const action of actions) permissions['plugin::maison'].controllers[controller][action].enabled = true;
    }
    await roles.updateRole(id, { permissions });
  };

  /** A content-API token, created the way Settings → API Tokens does it. */
  const apiToken = async (name, type, permissions) => {
    const { accessKey } = await strapi.service('admin::api-token').create({
      name, description: 'Maison REST integration test', type, kind: 'content-api', lifespan: null, ...(permissions ? { permissions } : {}),
    });
    return accessKey;
  };

  before(async () => {
    strapi = await bootStrapi('rest');
    await strapi.plugin('maison').service('seed').loadDemoCatalog();

    // Sessions, as oauth-mcp-manager sees them. test-a and test-b are sessions /mcp accepts, for customers A and B.
    // test-a-rotated still names customer A, but /mcp refuses it: its admin token was rotated. test-staff is a staff
    // session: /mcp accepts it, but it holds no LINE customer. Checking test-broken fails on the server. Every other
    // token goes to oauth-mcp-manager's own resolvers, which have no session in this database.
    const oauth = strapi.plugin('strapi-oauth-mcp-manager').service('oauth');
    const resolveAccessToken = oauth.resolveAccessToken.bind(oauth);
    const resolveSubject = oauth.resolveSubject.bind(oauth);
    const accessTokens = {
      'test-a': { valid: true, adminAccessKey: STUB_ADMIN_KEY, grantId: 1 },
      'test-b': { valid: true, adminAccessKey: STUB_ADMIN_KEY, grantId: 2 },
      'test-a-rotated': { valid: false, reason: 'grant_revoked' },
      'test-staff': { valid: true, adminAccessKey: STUB_ADMIN_KEY, grantId: 3 },
    };
    const subjects = { 'Bearer test-a': SUBJECT_A, 'Bearer test-b': SUBJECT_B, 'Bearer test-a-rotated': SUBJECT_A, 'Bearer test-staff': null };
    oauth.resolveAccessToken = async (token) => {
      if (token === 'test-broken') throw new Error('SQLITE_BUSY: database is locked');
      return accessTokens[token] ?? resolveAccessToken(token);
    };
    oauth.resolveSubject = async (authorization) => (authorization in subjects ? subjects[authorization] : resolveSubject(authorization));

    // A staff-issued API token with full access to the content API.
    fullAccessToken = await apiToken('maison-rest-test', 'full-access');

    // A website user signed in with users-permissions: a real JWT, but not a LINE customer.
    const authenticated = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });
    const user = await strapi.db.query('plugin::users-permissions.user').create({
      data: { username: 'website-user', email: 'website-user@maison.test', provider: 'local', confirmed: true, blocked: false, role: authenticated.id },
    });
    const jwt = strapi.plugin('users-permissions').service('jwt');
    websiteJwt = await jwt.issue({ id: user.id });
    assert.equal((await jwt.verify(websiteJwt)).id, user.id, 'users-permissions accepts the JWT');

    await new Promise((resolve, reject) => {
      strapi.server.listen(0, '127.0.0.1', resolve).once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${strapi.server.httpServer.address().port}`;
  });

  after(async () => {
    await strapi?.destroy();
  });

  it('serves the catalog only to a role or an API token that holds the action', async () => {
    const denied = await call('GET', '/collections?locale=en');
    assert.equal(denied.status, 403, 'the Public role has no Maison action yet');
    assert.equal((await call('GET', '/collections?locale=en', { token: fullAccessToken })).status, 200, 'a full-access API token holds every action');

    await grantPublic(CATALOG_ACTIONS);
    const { status, body } = await call('GET', '/collections?locale=en');
    assert.equal(status, 200);
    assert.equal(body.locale, 'en');
    assert.deepEqual(body.collections.map((c) => c.name).sort(), ['Atelier', 'Gifts', 'Voyage']);
    for (const path of CATALOG_PATHS) assert.equal((await call('GET', path)).status, 200, path);
  });

  it('serves the catalog to a read-only API token, and to a custom one only what it holds', async () => {
    // Strapi lets a read-only token call an action only if its name ends in find or findOne.
    const readOnly = await apiToken('maison-rest-test-read-only', 'read-only');
    const collections = await call('GET', '/collections?locale=en', { token: readOnly });
    assert.equal(collections.status, 200, JSON.stringify(collections.body));
    assert.deepEqual(collections.body.collections.map((c) => c.name).sort(), ['Atelier', 'Gifts', 'Voyage']);
    for (const path of CATALOG_PATHS) assert.equal((await call('GET', path, { token: readOnly })).status, 200, path);

    const collectionsOnly = await apiToken('maison-rest-test-custom', 'custom', ['plugin::maison.collections.find']);
    assert.equal((await call('GET', '/collections', { token: collectionsOnly })).status, 200);
    assert.equal((await call('GET', '/boutiques', { token: collectionsOnly })).status, 403, 'an action it does not hold');
  });

  it('answers the demo question from the query string', async () => {
    const { status, body } = await call('GET', '/products?occasion=travel&maxPriceJpy=400000&inStockAt=ginza&locale=en');
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.products.map((p) => p.slug), ['weekender-50', 'garment-carrier', 'watch-roll-trois', 'passport-cover', 'luggage-tag-duo']);
    assert.equal(body.locale, 'en');
  });

  it('answers an unknown product with 404 and the hint view_product gives', async () => {
    const { status, body } = await call('GET', '/products/no-such-piece');
    assert.equal(status, 404);
    assert.deepEqual(body, {
      error: { code: 'not_found', message: 'No published product "no-such-piece".', hint: 'Call search_products to find valid product slugs.' },
    });
  });

  it('takes a list of products as a repeated parameter', async () => {
    const { status, body } = await call('GET', `/boutiques?productSlugs=weekender-50&productSlugs=passport-cover&date=${TUESDAY}`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.date, TUESDAY);
    const osaka = body.boutiques.find((b) => b.slug === 'osaka');
    assert.equal(osaka.openOnDate, false, 'Osaka is closed on Tuesdays');
    assert.deepEqual(osaka.stock.map((s) => s.product), ['weekender-50', 'passport-cover']);
  });

  it("answers a question from product knowledge, with a piece's own entry first", async () => {
    const { status, body } = await call('GET', '/knowledge?query=Will%20it%20fit%20in%20the%20overhead%20bin%3F&productSlugs=cabin-case-55&locale=en');
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.locale, 'en');
    assert.equal(body.entries[0].title, 'Will the Cabin Case 55 fit in an airline overhead bin?');
  });

  it('refuses a booking without a LINE customer session, with 401 and WWW-Authenticate: Bearer', async () => {
    const callers = [
      ['no Authorization header', undefined],
      ['a full-access API token', fullAccessToken],
      ["a website user's users-permissions JWT", websiteJwt],
      ['an unknown session token', 'mcp_at_unknown'],
    ];
    for (const [label, token] of callers) {
      const { status, headers, body } = await call('POST', '/appointments', { token, body: booking });
      assert.equal(status, 401, label);
      assert.equal(headers.get('www-authenticate'), 'Bearer', label);
      assert.equal(body.error.code, 'not_signed_in', label);
    }
    const booked = await strapi.documents(APPOINTMENT).count({});
    assert.equal(booked, 0, 'nothing was booked');
  });

  it('opens nothing when a role is granted the customer actions, which roles never apply to', async () => {
    // Strapi lists every content-API action under Settings → Roles, these two included.
    await grantPublic({ customer: ['requestAppointment', 'myAppointments'] });
    assert.equal((await call('POST', '/appointments', { body: booking })).status, 401);
    assert.equal((await call('GET', '/my-appointments')).status, 401);
  });

  it('books for customer A with 201, marked as made on the web', async () => {
    const { status, body } = await call('POST', '/appointments', { token: 'test-a', body: { ...booking, note: 'From the website' } });
    assert.equal(status, 201, JSON.stringify(body));
    assert.match(body.appointment.reference, /^APT-\d{4}$/);
    assert.equal(body.appointment.status, 'requested');
    assert.equal(body.appointment.requestedFor, VISIT);
    assert.deepEqual(body.appointment.boutique, { slug: 'ginza', name: '銀座本店' }, 'without a locale, in the default locale');
    assert.ok(!JSON.stringify(body).includes(STUB_ADMIN_KEY), 'the admin key behind the session never comes back');
    reference = body.appointment.reference;

    const stored = await strapi.documents(APPOINTMENT).findFirst({ status: 'draft', filters: { reference } });
    assert.equal(stored.customer, SUBJECT_A, 'the customer comes from the session');
    const staffView = (await strapi.plugin('maison').service('appointments').listRequests({ status: 'all' })).value.find(
      (appointment) => appointment.reference === reference
    );
    assert.equal(staffView.createdVia, 'web', 'the requests board shows where it came from');
  });

  it('refuses a staff session, which /mcp accepts but no LINE customer holds: 401, with nothing booked or listed', async () => {
    const before = await strapi.documents(APPOINTMENT).count({});
    const booked = await call('POST', '/appointments', { token: 'test-staff', body: { ...booking, requestedFor: tokyoTime(IN_20_DAYS, '17:00') } });
    assert.equal(booked.status, 401, JSON.stringify(booked.body));
    assert.equal(booked.headers.get('www-authenticate'), 'Bearer');
    assert.equal(booked.body.error.code, 'not_signed_in');
    assert.equal(await strapi.documents(APPOINTMENT).count({}), before, 'nothing was booked');

    const listed = await call('GET', '/my-appointments', { token: 'test-staff' });
    assert.equal(listed.status, 401, JSON.stringify(listed.body));
    assert.equal(listed.headers.get('www-authenticate'), 'Bearer');
    assert.equal(listed.body.error.code, 'not_signed_in');
    assert.ok(!('appointments' in listed.body), 'nothing was listed');
  });

  it('answers 503 temporarily_unavailable, not a sign-out, when checking the session fails on the server', async () => {
    const before = await strapi.documents(APPOINTMENT).count({});
    const booked = await call('POST', '/appointments', { token: 'test-broken', body: { ...booking, requestedFor: tokyoTime(IN_20_DAYS, '17:00') } });
    assert.equal(booked.status, 503, JSON.stringify(booked.body));
    assert.equal(booked.headers.get('www-authenticate'), null, 'no request to sign in again');
    assert.equal(booked.body.error.code, 'temporarily_unavailable');
    assert.equal(await strapi.documents(APPOINTMENT).count({}), before, 'nothing was booked');
    assert.equal((await call('GET', '/my-appointments', { token: 'test-broken' })).status, 503);
  });

  it('refuses a session /mcp would refuse, such as one whose admin token was rotated, though it names a customer', async () => {
    const appointments = () => strapi.documents(APPOINTMENT).count({});
    const before = await appointments();
    const booked = await call('POST', '/appointments', { token: 'test-a-rotated', body: { ...booking, requestedFor: tokyoTime(IN_20_DAYS, '16:00') } });
    assert.equal(booked.status, 401, JSON.stringify(booked.body));
    assert.equal(booked.headers.get('www-authenticate'), 'Bearer');
    assert.equal(booked.body.error.code, 'not_signed_in');
    assert.equal(await appointments(), before, 'nothing was booked');
    assert.equal((await call('GET', '/my-appointments', { token: 'test-a-rotated' })).status, 401);
  });

  it('never takes the customer from the body', async () => {
    const { status, body } = await call('POST', '/appointments', {
      token: 'test-b',
      body: { ...booking, requestedFor: tokyoTime(IN_20_DAYS, '15:00'), customer: SUBJECT_A },
    });
    assert.equal(status, 201, JSON.stringify(body));
    const stored = await strapi.documents(APPOINTMENT).findFirst({ status: 'draft', filters: { reference: body.appointment.reference } });
    assert.equal(stored.customer, SUBJECT_B);
    await strapi.documents(APPOINTMENT).delete({ documentId: stored.documentId });
  });

  it("books in the customer's language when the body names a locale, as request_appointment does", async () => {
    const { status, body } = await call('POST', '/appointments', { token: 'test-b', body: { ...booking, requestedFor: tokyoTime(IN_20_DAYS, '11:00'), locale: 'en' } });
    assert.equal(status, 201, JSON.stringify(body));
    assert.deepEqual(body.appointment.boutique, { slug: 'ginza', name: 'Ginza Flagship' });
    assert.deepEqual(body.appointment.products, [{ slug: 'weekender-50', name: 'Weekender 50' }]);
    const stored = await strapi.documents(APPOINTMENT).findFirst({ status: 'draft', filters: { reference: body.appointment.reference } });
    await strapi.documents(APPOINTMENT).delete({ documentId: stored.documentId });
  });

  it('rejects 30 February with 400 and the message the shared schema gives request_appointment', async () => {
    const { status, body } = await call('POST', '/appointments', { token: 'test-a', body: { ...booking, requestedFor: '2026-02-30T14:00:00+09:00' } });
    assert.equal(status, 400);
    assert.deepEqual(body, { error: { code: 'invalid_input', message: 'requestedFor: Not a real calendar date.' } });
  });

  it("answers a closed day with 409 boutique_closed and the service's message and hint", async () => {
    const { status, body } = await call('POST', '/appointments', { token: 'test-a', body: { ...booking, boutique: 'osaka', requestedFor: tokyoTime(TUESDAY, '14:00') } });
    assert.equal(status, 409, JSON.stringify(body));
    assert.equal(body.error.code, 'boutique_closed');
    assert.equal(body.error.message, `大阪心斎橋店 is not open at ${TUESDAY}T14:00:00+09:00.`);
    assert.ok(body.error.hint.includes(`closed all day on Tuesday ${TUESDAY}`), body.error.hint);
  });

  it("lists A's visit for A and not for B, and nothing without a session", async () => {
    const mine = await call('GET', '/my-appointments?locale=en', { token: 'test-a' });
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.appointments.map((a) => a.reference), [reference]);
    assert.equal(mine.body.appointments[0].boutique.name, 'Ginza Flagship');

    const theirs = await call('GET', '/my-appointments', { token: 'test-b' });
    assert.equal(theirs.status, 200);
    assert.ok(!theirs.body.appointments.some((a) => a.reference === reference), "B never sees A's visit");

    for (const token of [undefined, fullAccessToken, websiteJwt]) {
      const refused = await call('GET', '/my-appointments', { token });
      assert.equal(refused.status, 401);
      assert.equal(refused.headers.get('www-authenticate'), 'Bearer');
    }
  });

  it("refuses the customer's session on the catalog routes, which take a role or an API token", async () => {
    // Strapi's content-API auth reads any bearer token as a users-permissions JWT or an API token.
    assert.equal((await call('GET', '/collections', { token: 'test-a' })).status, 401);
  });
});
