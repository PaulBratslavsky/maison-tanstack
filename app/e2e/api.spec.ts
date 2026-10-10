import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';

import { createSession } from '../src/lib/session';
import type { Appointment } from '../src/lib/types';
import { requireLocalMode, strapiOrigin } from './env';
import { nextWeekday } from './support';

// Local mode only, and Strapi on this machine: in LINE mode (phase 7) VITE_STRAPI_URL is the tunnel.
requireLocalMode();
const strapiUrl = strapiOrigin();
const clientId = process.env.VITE_MAISON_CLIENT_ID ?? '';
/**
 * A made-up demo customer's LINE user ID: U and 32 hex digits. These tests use the Udec0de... customers, and the browser
 * tests (maison.spec.ts) use others, so no two files book for the same customer, whatever order they run in.
 */
const customer = (suffix: string) => `U${'dec0de'.repeat(5)}${suffix}`;
const asAdmin = () => ({ Authorization: `Bearer ${process.env.MAISON_E2E_ADMIN_JWT}` });

/** The next given weekday (0 = Sunday … 6 = Saturday) at least two days away, at `time` in Tokyo. */
const visitOn = (weekday: number, time: string) => `${nextWeekday(weekday)}T${time}:00+09:00`;

/**
 * An HTTP request with Node's fetch, never Playwright's `request` fixture: when a call of the fixture fails, Playwright
 * prints its request headers, the Authorization header among them, in the error's call log (and a trace stores them too).
 * The answer has its body read once, as text and as JSON.
 */
const send = async (method: 'GET' | 'POST', url: string, { headers, data }: { headers?: Record<string, string>; data?: unknown } = {}) => {
  const response = await fetch(url, {
    method,
    headers: data === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, json: <T = any>() => JSON.parse(text) as T };
};
type Answer = Awaited<ReturnType<typeof send>>;

/**
 * The status a call should answer with. A failure carries Strapi's own reason, the start of the answer's body, so a 403
 * for a missing grant explains itself. Nothing of the request, such as a header, goes into the message. The message is
 * built only for a failure: Playwright names a step by it, so a passing call's body, customers' data, stays out of the
 * report.
 */
const expectStatus = (answer: Answer, status: number, label?: string) => {
  if (answer.status === status) expect(answer.status, label).toBe(status);
  else expect(answer.status, [label, answer.text.slice(0, 400)].filter(Boolean).join(': ')).toBe(status);
};

/** A demo customer's session, signed in the way the app signs in: a LIFF mock ID token, exchanged. */
const sessionOf = (lineUserId: string) => createSession({ strapiUrl, clientId, getIdToken: () => `valid.${lineUserId}` }).getToken();

/** A demo customer's own MCP connection. */
const signIn = async (lineUserId: string) => {
  const token = await sessionOf(lineUserId);
  const client = new Client({ name: 'maison-e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${strapiUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
};

/** The text of a tool result's content: for a refused call, the `{ error: { code, message, hint } }` the tool answered with. */
const textOf = (content: unknown): string =>
  (Array.isArray(content) ? content : [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join(' ')
    .trim();

/** A tool's structured answer. A tool error (isError) throws with the tool's own words, so a refused booking shows its code and hint. */
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} answered with an error: ${textOf(result.content)}`);
  return result.structuredContent as Record<string, any>;
};
const references = async (client: Client) =>
  ((await call(client, 'my_appointments', {})).appointments as Array<{ reference: string }>).map((visit) => visit.reference);

test('my_appointments shows each customer only their own visits', async () => {
  // Customers of their own, apart from the browser tests' customers.
  const alice = await signIn(customer('01'));
  const bob = await signIn(customer('02'));
  const hers = await call(alice, 'request_appointment', { boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: visitOn(6, '14:00') });
  const his = await call(bob, 'request_appointment', { boutique: 'omotesando', productSlugs: ['tote-soleil'], requestedFor: visitOn(0, '15:00') });
  expect(await references(alice)).toEqual([hers.appointment.reference]);
  expect(await references(bob)).toEqual([his.appointment.reference]);
  await alice.close();
  await bob.close();
});

test("the Content Manager's appointment list never returns a customer, and its search never matches one", async () => {
  const carol = await signIn(customer('03'));
  const booked = await call(carol, 'request_appointment', { boutique: 'ginza', productSlugs: ['passport-cover'], requestedFor: visitOn(6, '16:00') });
  await carol.close();
  const contentManager = `${strapiUrl}/content-manager`;
  // Only the Content Manager's list route runs here. The admin API's other routes use the same sanitizer, but aren't called.
  const list = async (query = '') => {
    const answer = await send('GET', `${contentManager}/collection-types/plugin::maison.appointment?page=1&pageSize=20${query}`, { headers: asAdmin() });
    expectStatus(answer, 200, 'the appointment list');
    return answer.json<{ results: Array<{ reference: string }> }>().results;
  };
  const rows = await list();
  expect(rows.length).toBeGreaterThan(0);
  // Keys only: a failure here must not print the customer's LINE user ID.
  for (const row of rows) expect(Object.keys(row), `the keys of ${row.reference}`).not.toContain('customer');
  // The list search (_q) finds an appointment by its reference, and never by part of its customer's LINE user ID.
  expect((await list(`&_q=${booked.appointment.reference}`)).map((row) => row.reference)).toContain(booked.appointment.reference);
  expect((await list('&_q=ffffffff')).map((row) => row.reference)).toEqual([]);
  // A relation picker searches, and shows, the main field of the records it lists. For appointments that must be the
  // reference, never the customer: on the appointment itself (picked from a list of appointments), and on the
  // `appointments` relation of a boutique and of a product (picked from their edit views).
  type Configuration = { data: { contentType: { settings: { mainField: string }; metadatas: Record<string, { edit?: { mainField?: string } }> } } };
  const configuration = async (type: string) => {
    const answer = await send('GET', `${contentManager}/content-types/plugin::maison.${type}/configuration`, { headers: asAdmin() });
    expectStatus(answer, 200, `the ${type} configuration`);
    return answer.json<Configuration>().data.contentType;
  };
  expect((await configuration('appointment')).settings.mainField).toBe('reference');
  for (const type of ['boutique', 'product']) {
    expect((await configuration(type)).metadatas.appointments?.edit?.mainField, `the main field of a ${type}'s appointments`).toBe('reference');
  }
});

test.describe('the REST API at /api/maison', () => {
  const rest = `${strapiUrl}/api/maison`;
  // Customers of their own, apart from every other test's: A books one visit (a customer may hold three open), B none.
  const CUSTOMER_A = customer('04');
  const CUSTOMER_B = customer('05');
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  test('serves the catalog with no credentials: the Public role reads it', async () => {
    const collections = await send('GET', `${rest}/collections?locale=en`);
    expectStatus(collections, 200, 'collections');
    expect(
      collections
        .json<{ collections: Array<{ name: string }> }>()
        .collections.map((collection) => collection.name)
        .sort()
    ).toEqual(['Atelier', 'Gifts', 'Voyage']);

    // The query narrows the search: the Weekender is found, and the Tote isn't.
    const products = await send('GET', `${rest}/products?query=weekender&locale=en`);
    expectStatus(products, 200, 'a product search');
    const found = products.json<{ locale: string; products: Array<{ slug: string }> }>();
    expect(found.locale).toBe('en');
    expect(found.products.map((product) => product.slug)).toContain('weekender-50');
    expect(found.products.map((product) => product.slug)).not.toContain('tote-soleil');

    const boutiques = await send('GET', `${rest}/boutiques?locale=en`);
    expectStatus(boutiques, 200, 'boutiques');
    expect(
      boutiques
        .json<{ boutiques: Array<{ slug: string }> }>()
        .boutiques.map((boutique) => boutique.slug)
        .sort()
    ).toEqual(['ginza', 'omotesando', 'osaka']);
  });

  test("answers a product by its slug, and an unknown slug with view_product's hint", async () => {
    const found = await send('GET', `${rest}/products/weekender-50?locale=en`);
    expectStatus(found, 200, 'a product by its slug');
    expect(found.json<{ product: { slug: string; name: string } }>().product).toMatchObject({ slug: 'weekender-50', name: 'Weekender 50' });
    const unknown = await send('GET', `${rest}/products/no-such-piece?locale=en`);
    expectStatus(unknown, 404, 'an unknown product');
    expect(unknown.json()).toEqual({
      error: { code: 'not_found', message: 'No published product "no-such-piece".', hint: 'Call search_products to find valid product slugs.' },
    });
  });

  test("books only with a LINE customer's session, as a web request, and lists the visit for that customer alone", async () => {
    const booking = { boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: visitOn(6, '14:00'), locale: 'en' };
    // Every request as the staff board lists it. How a request came in (createdVia) is for staff, so only the board shows it.
    const board = async () => {
      const answer = await send('GET', `${strapiUrl}/maison/appointments?status=all&limit=50`, { headers: asAdmin() });
      expectStatus(answer, 200, 'the staff board');
      return answer.json<{ appointments: Array<{ reference: string; createdVia: string }> }>().appointments;
    };
    const requestsBefore = (await board()).length;

    // Both customer routes refuse a caller with no session, and an admin session is no customer's: 401, and the
    // WWW-Authenticate header that tells a client to sign in.
    for (const [caller, headers] of [['no session', {}], ['the admin session', asAdmin()]] as const) {
      for (const [method, path, data] of [['POST', '/appointments', booking], ['GET', '/my-appointments?locale=en', undefined]] as const) {
        const label = `${caller}, ${method} ${path}`;
        const refused = await send(method, `${rest}${path}`, { data, headers });
        expectStatus(refused, 401, label);
        expect(refused.headers.get('www-authenticate'), label).toBe('Bearer');
        expect(refused.json<{ error: { code: string } }>().error.code, label).toBe('not_signed_in');
      }
    }
    expect(await board(), 'a refused request books nothing').toHaveLength(requestsBefore);

    const asA = bearer(await sessionOf(CUSTOMER_A));
    const created = await send('POST', `${rest}/appointments`, { data: booking, headers: asA });
    expectStatus(created, 201, "customer A's booking");
    const { appointment } = created.json<{ appointment: Appointment }>();
    expect(appointment).toMatchObject({
      status: 'requested',
      boutique: { slug: 'ginza', name: 'Ginza Flagship' },
      requestedFor: booking.requestedFor,
      products: [{ slug: 'weekender-50', name: 'Weekender 50' }],
    });
    expect((await board()).find((row) => row.reference === appointment.reference)?.createdVia).toBe('web');

    const visitsOf = async (headers: Record<string, string>) => {
      const answer = await send('GET', `${rest}/my-appointments?locale=en`, { headers });
      expectStatus(answer, 200, 'my-appointments');
      return answer.json<{ appointments: Appointment[] }>().appointments.map((visit) => visit.reference);
    };
    expect(await visitsOf(asA)).toEqual([appointment.reference]);
    expect(await visitsOf(bearer(await sessionOf(CUSTOMER_B))), "B never sees A's visit").toEqual([]);
  });
});
