import { expect, test } from '@playwright/test';

import { requireLocalMode } from './env';

// Local mode only: these tests hold that a build for the LIFF mock closes the three LINE mode proxy routes (phase 7), so a
// tunnel left open after `npm run mode:local` reaches nothing on Strapi. Nothing here carries a real value: the session
// and the ID token are made up. The LINE build's side is checked by `node scripts/check-strapi-proxy.mjs`.
requireLocalMode();

const app = 'http://localhost:3004';
const TOKEN_PATH = '/api/strapi-oauth-mcp-manager/oauth/token';
const form = new URLSearchParams({
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  client_id: 'mcp_client_made_up',
  subject_token: `valid.U${'0'.repeat(32)}`,
  subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
});

/** An HTTP request with Node's fetch, as api.spec.ts does: Playwright's request fixture prints headers when a call fails. */
const send = async (method: string, path: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
  const response = await fetch(`${app}${path}`, { method, ...init });
  return { status: response.status, liff: response.headers.get('x-maison-liff'), text: await response.text() };
};

test('every answer says the app is a build for the LIFF mock: X-Maison-Liff mock', async () => {
  for (const path of ['/', '/collections/none', '/api/concierge']) {
    expect((await send('GET', path)).liff, path).toBe('mock');
  }
});

test('the proxy routes answer 404 not_found in local mode, with or without a session, and the header on each', async () => {
  const session = { Authorization: 'Bearer mcp_at_made_up' };
  for (const [method, path, init] of [
    ['POST', '/mcp', { headers: { ...session, 'Content-Type': 'application/json' }, body: '{}' }],
    ['POST', '/mcp', { body: '{}' }],
    ['GET', '/mcp', {}],
    ['DELETE', '/mcp', {}],
    ['POST', TOKEN_PATH, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }],
    ['GET', TOKEN_PATH, {}],
    ['GET', '/uploads/weekender_50.png', {}],
    ['HEAD', '/uploads/weekender_50.png', {}],
  ] as Array<[string, string, { headers?: Record<string, string>; body?: string }]>) {
    const answer = await send(method, path, init);
    expect(answer.status, `${method} ${path}`).toBe(404);
    expect(answer.liff, `${method} ${path}`).toBe('mock');
    if (method !== 'HEAD') expect(JSON.parse(answer.text), `${method} ${path}`).toEqual({ error: 'not_found' });
  }
});
