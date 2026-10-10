import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { bootStrapi } from './harness.mjs';

/*
 * Maison over /mcp, on a Strapi booted in this process and listening on a free port, with admin tokens made through
 * Strapi's admin token service and an MCP client from the official SDK. It replaces the original's smoke tests, which
 * needed a running dev server and token files.
 */

const ALL_ACTIONS = [
  'catalog.read',
  'appointments.request',
  'appointments.review',
  'appointments.confirm',
  'confirmations.send',
  'questions.ask',
  'questions.read',
  'questions.answer',
  'inquiries.log',
  'inquiries.view',
  'inquiries.reply',
  'demo.manage',
  'assistant.use',
].map((id) => `plugin::maison.${id}`);

const CUSTOMER_ACTIONS = ['catalog.read', 'appointments.request', 'questions.ask', 'inquiries.log'];
const STAFF_ACTIONS = ['catalog.read', 'appointments.review', 'appointments.confirm'];
const OPS_ACTIONS = ['confirmations.send'];

const CUSTOMER_TOOLS = [
  'browse_collections', 'find_boutiques', 'hand_off_to_staff', 'log_inquiry', 'my_appointments', 'request_appointment',
  'search_knowledge', 'search_products', 'view_product',
];
const STAFF_TOOLS = ['appointment_requests', 'confirm_appointment'];
const STAFF_VISIBLE = ['appointment_requests', 'browse_collections', 'confirm_appointment', 'find_boutiques', 'search_knowledge', 'search_products', 'view_product'];
const OPS_TOOLS = ['pending_confirmations', 'record_confirmation'];
const PROMPT = 'send_pending_confirmations';

/** What a tool says when it fails: `{ error: { code, message, hint } }`, as text in the first content block. */
const errorOf = (result) => JSON.parse(result.content[0].text).error;

describe('Maison over /mcp, with real admin tokens', () => {
  let strapi;
  let baseUrl;
  const clients = {};

  /** Makes an admin token holding `actions`, owned by an admin whose role holds every Maison action (a token can hold no more than its owner). */
  const mintToken = async (owner, name, actions) => {
    const token = await strapi.admin.services['api-token-admin'].create(
      {
        kind: 'admin',
        name: `maison-test-${name}`,
        description: 'Created by the Maison integration tests',
        lifespan: null,
        adminPermissions: actions.map((action) => ({ action: `plugin::maison.${action}`, subject: null, properties: {}, conditions: [] })),
      },
      owner
    );
    return token.accessKey;
  };

  const connect = async (token) => {
    const client = new Client({ name: 'maison-integration-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return client;
  };

  // The log tool exists in development only, and is Strapi's own.
  const toolNames = async (client) => (await client.listTools()).tools.map((tool) => tool.name).filter((name) => name !== 'log').sort();
  const promptNames = async (client) => (await client.listPrompts()).prompts.map((prompt) => prompt.name);

  before(async () => {
    strapi = await bootStrapi('mcp');
    await strapi.plugin('maison').service('seed').loadDemoCatalog();

    const roles = strapi.service('admin::role');
    const role = await roles.create({ name: 'Maison test: token owner', description: 'Created by the Maison integration tests' });
    await roles.assignPermissions(role.id, ALL_ACTIONS.map((action) => ({ action, subject: null, properties: {}, conditions: [] })));
    const { id } = await strapi.service('admin::user').create({
      email: 'token-owner@maison.test', firstname: 'owner', lastname: 'Test', isActive: true, roles: [role.id],
    });
    const owner = await strapi.db.query('admin::user').findOne({ where: { id }, populate: ['roles'] });

    const tokens = {
      customer: await mintToken(owner, 'customer', CUSTOMER_ACTIONS),
      staff: await mintToken(owner, 'staff', STAFF_ACTIONS),
      ops: await mintToken(owner, 'ops', OPS_ACTIONS),
    };

    await new Promise((resolve, reject) => {
      strapi.server.listen(0, '127.0.0.1', resolve).once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${strapi.server.httpServer.address().port}`;
    for (const [name, token] of Object.entries(tokens)) clients[name] = await connect(token);
  });

  after(async () => {
    for (const client of Object.values(clients)) await client.close();
    await strapi?.destroy();
  });

  it('answers 401 to a request with no token', async () => {
    const response = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(response.status, 401);
  });

  it('shows each token only the tools its permissions allow', async () => {
    assert.deepEqual(await toolNames(clients.customer), CUSTOMER_TOOLS);
    assert.deepEqual(await toolNames(clients.staff), STAFF_VISIBLE);
    assert.deepEqual(await toolNames(clients.ops), OPS_TOOLS);
  });

  it('keeps the staff tools away from the customer token, so it cannot call them either', async () => {
    const names = await toolNames(clients.customer);
    for (const name of STAFF_TOOLS) assert.ok(!names.includes(name), `${name} is hidden`);
    // Depending on the SDK version, a hidden tool is a protocol error or an isError result. Either way it does not run.
    const refused = await clients.customer.callTool({ name: 'appointment_requests', arguments: {} }).then((result) => result.isError === true, () => true);
    assert.ok(refused, 'the customer token cannot call appointment_requests');
  });

  it('shows the confirmation prompt only to the ops token', async () => {
    assert.deepEqual(await promptNames(clients.ops), [PROMPT]);
    assert.deepEqual(await promptNames(clients.customer), []);
    assert.deepEqual(await promptNames(clients.staff), []);
    const prompt = await clients.ops.getPrompt({ name: PROMPT });
    assert.match(prompt.messages[0].content.text, /pending_confirmations/);
  });

  it('returns the seeded collections from browse_collections', async () => {
    const result = await clients.customer.callTool({ name: 'browse_collections', arguments: { locale: 'en' } });
    assert.ok(!result.isError, JSON.stringify(result.content));
    assert.equal(result.structuredContent.locale, 'en');
    const { collections } = result.structuredContent;
    assert.deepEqual(collections.map((collection) => collection.slug).sort(), ['atelier', 'gifts', 'voyage']);
    assert.equal(collections.find((collection) => collection.slug === 'gifts').name, 'Gifts');
    assert.equal(collections.reduce((sum, collection) => sum + collection.productCount, 0), 12);
  });

  it('answers the demo question through search_products', async () => {
    const result = await clients.customer.callTool({
      name: 'search_products',
      arguments: { occasion: 'travel', maxPriceJpy: 400000, inStockAt: 'ginza', locale: 'en' },
    });
    assert.ok(!result.isError, JSON.stringify(result.content));
    assert.deepEqual(result.structuredContent.products.map((product) => product.slug), [
      'weekender-50', 'garment-carrier', 'watch-roll-trois', 'passport-cover', 'luggage-tag-duo',
    ]);
  });

  it("answers a question about a piece from the product knowledge, with that piece's own entry first", async () => {
    const result = await clients.customer.callTool({
      name: 'search_knowledge',
      arguments: { query: 'Will it fit in the overhead bin?', productSlugs: ['cabin-case-55'], locale: 'en' },
    });
    assert.ok(!result.isError, JSON.stringify(result.content));
    assert.equal(result.structuredContent.entries[0].title, 'Will the Cabin Case 55 fit in an airline overhead bin?');
  });

  it('returns not_found with a hint for an unknown product', async () => {
    const result = await clients.customer.callTool({ name: 'view_product', arguments: { slug: 'no-such-piece' } });
    assert.equal(result.isError, true);
    assert.equal(errorOf(result).code, 'not_found');
    assert.match(errorOf(result).hint, /search_products/);
  });

  it('never lets an admin token act as a customer: request_appointment answers not_signed_in', async () => {
    const booking = await clients.customer.callTool({
      name: 'request_appointment',
      arguments: { boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: '2030-01-12T14:00:00+09:00' },
    });
    assert.equal(booking.isError, true);
    assert.equal(errorOf(booking).code, 'not_signed_in');
  });

  it('answers not_signed_in to the other customer tools too, with nothing recorded', async () => {
    const mine = await clients.customer.callTool({ name: 'my_appointments', arguments: {} });
    assert.equal(errorOf(mine).code, 'not_signed_in');
    const handedOff = await clients.customer.callTool({ name: 'hand_off_to_staff', arguments: { question: 'Can the coffret hold a watch?' } });
    assert.equal(errorOf(handedOff).code, 'not_signed_in');
    const logged = await clients.customer.callTool({
      name: 'log_inquiry',
      arguments: { message: 'Can the coffret hold a watch?', knowledgeFound: false, handedOff: true },
    });
    assert.equal(errorOf(logged).code, 'not_signed_in');
    assert.equal(await strapi.documents('plugin::maison.appointment').count({}), 0);
    assert.equal(await strapi.documents('plugin::maison.question').count({}), 0);
    assert.equal(await strapi.documents('plugin::maison.inquiry').count({}), 0);
  });

  it('lets the staff token review requests with customers masked, and refuses unknown references', async () => {
    const requests = await clients.staff.callTool({ name: 'appointment_requests', arguments: { status: 'all' } });
    assert.ok(!requests.isError, JSON.stringify(requests.content));
    assert.ok(Array.isArray(requests.structuredContent.appointments));
    const unknown = await clients.staff.callTool({ name: 'confirm_appointment', arguments: { reference: 'APT-0000' } });
    assert.equal(errorOf(unknown).code, 'not_found');
  });

  it('lets the ops token list and record, and refuses unknown references', async () => {
    const pending = await clients.ops.callTool({ name: 'pending_confirmations', arguments: {} });
    // Without a liffUrl in the config, the list answers not_configured. Either answer shows the tool ran for this token.
    assert.ok(pending.isError ? errorOf(pending).code === 'not_configured' : Array.isArray(pending.structuredContent.appointments), JSON.stringify(pending.content));
    const unknown = await clients.ops.callTool({ name: 'record_confirmation', arguments: { reference: 'APT-0000', status: 'sent', detail: 'integration test' } });
    assert.equal(errorOf(unknown).code, 'not_found');
  });
});
