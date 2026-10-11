import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { main as switchMode, writeEnv } from './line-mode.mjs';
import { checkTunnel, main } from './line-tunnel.mjs';

const SECRET = 'jwt-secret-that-must-never-print';
const INPUTS = 'LINE_MODE_LIFF_ID=1234567891-AbcdEfgh\nLINE_MODE_CHANNEL_ID=1234567891\nLINE_MODE_DOMAIN=maison-test.ngrok-free.dev\n';

const roots = [];
const servers = [];
after(() => {
  servers.forEach((server) => server.close());
  roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
});

/** A checkout switched to `mode` with the real mode script. */
const demo = (mode) => {
  const root = mkdtempSync(join(tmpdir(), 'maison-tunnel-'));
  roots.push(root);
  mkdirSync(join(root, 'strapi'));
  mkdirSync(join(root, 'app'));
  writeFileSync(join(root, 'strapi', '.env'), `PORT=1339\nJWT_SECRET=${SECRET}\nLINE_LOGIN_CHANNEL_ID=1234567890\nLINE_VERIFY_URL=http://127.0.0.1:4546/verify\n`, { mode: 0o600 });
  writeFileSync(join(root, 'app', '.env'), `VITE_STRAPI_URL=http://localhost:1339\nVITE_MAISON_CLIENT_ID=mcp_client_test\n${INPUTS}`, { mode: 0o600 });
  assert.equal(switchMode([mode], { root, log: () => {} }), 0);
  return root;
};

const listen = async (handler) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server.address().port;
};
/** A port nothing listens on. */
const freePort = async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
};
/**
 * The app on :3004, as the guard sees it: its X-Maison-Liff header (none when `liff` is null), and the token endpoint
 * it proxies to Strapi.
 */
const fakeApp = async ({ liff = 'line', token = [400, { error: 'invalid_grant' }] } = {}) => {
  const seen = [];
  const liffHeader = liff === null ? {} : { 'X-Maison-Liff': liff };
  const port = await listen((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === '/api/strapi-oauth-mcp-manager/oauth/token') {
      res.writeHead(token[0], { 'Content-Type': 'application/json', ...liffHeader });
      return res.end(JSON.stringify(token[1]));
    }
    res.writeHead(200, { 'Content-Type': 'text/html', ...liffHeader });
    res.end('<p>MAISON</p>');
  });
  return { appUrl: `http://127.0.0.1:${port}`, seen };
};

test('passes when LINE verifies ID tokens, the app is built for LINE, and the verify mock is off', async () => {
  const { appUrl, seen } = await fakeApp();
  assert.deepEqual(await checkTunnel({ root: demo('line'), appUrl, mockVerifyPort: await freePort() }), []);
  assert.ok(seen.includes('POST /api/strapi-oauth-mcp-manager/oauth/token'), 'probed the running Strapi through the app');
});

test('refuses while strapi/.env sets LINE_VERIFY_URL', async () => {
  const root = demo('line');
  writeEnv(join(root, 'strapi', '.env'), { LINE_VERIFY_URL: 'http://127.0.0.1:4546/verify' });
  const { appUrl } = await fakeApp();
  const problems = await checkTunnel({ root, appUrl, mockVerifyPort: await freePort() });
  assert.ok(problems.some((problem) => problem.startsWith('strapi/.env sets LINE_VERIFY_URL')), problems.join('\n'));
});

test("refuses a LINE_VERIFY_URL added later in any form Strapi's dotenv reads, and sends no forged token", async () => {
  const { appUrl, seen } = await fakeApp();
  for (const line of [
    'export LINE_VERIFY_URL=http://127.0.0.1:4546/verify\n',
    'LINE_VERIFY_URL = http://127.0.0.1:4546/verify\n',
    'LINE_VERIFY_URL: http://127.0.0.1:4546/verify\n',
    'LINE_VERIFY_URL=http://127.0.0.1:4546/verify\r\n',
  ]) {
    const root = demo('line');
    appendFileSync(join(root, 'strapi', '.env'), line);
    const problems = await checkTunnel({ root, appUrl, mockVerifyPort: await freePort() });
    assert.ok(problems.some((problem) => problem.startsWith('strapi/.env sets LINE_VERIFY_URL')), `${JSON.stringify(line)}: ${problems.join('\n')}`);
  }
  assert.ok(!seen.some((request) => request.includes('/oauth/token')), 'no forged token was sent');
});

test('refuses in local mode, and while the app on :3004 is built for the LIFF mock', async () => {
  const { appUrl } = await fakeApp({ liff: 'mock' });
  const mockVerifyPort = await freePort();
  const local = await checkTunnel({ root: demo('local'), appUrl, mockVerifyPort });
  assert.ok(local.some((problem) => problem.includes('VITE_LIFF_MOCK (app/.env)')), local.join('\n'));
  const built = await checkTunnel({ root: demo('line'), appUrl, mockVerifyPort });
  assert.ok(built.some((problem) => problem.includes('built for the LIFF mock')), built.join('\n'));
});

test('refuses a development server in LINE mode, or an app that says nothing: only the start:line build answers line', async () => {
  const mockVerifyPort = await freePort();
  const dev = await fakeApp({ liff: 'line-dev' });
  const devProblems = await checkTunnel({ root: demo('line'), appUrl: dev.appUrl, mockVerifyPort });
  assert.ok(devProblems.some((problem) => problem.includes('a development server')), devProblems.join('\n'));
  const silent = await fakeApp({ liff: null });
  const silentProblems = await checkTunnel({ root: demo('line'), appUrl: silent.appUrl, mockVerifyPort });
  assert.ok(silentProblems.some((problem) => problem.includes("isn't the LINE build (X-Maison-Liff: none)")), silentProblems.join('\n'));
  for (const { seen } of [dev, silent]) assert.ok(!seen.some((request) => request.includes('/oauth/token')), 'no forged token was sent');
});

test("refuses while the app isn't answering", async () => {
  const appUrl = `http://127.0.0.1:${await freePort()}`;
  const problems = await checkTunnel({ root: demo('line'), appUrl, mockVerifyPort: await freePort() });
  assert.ok(problems.some((problem) => problem.includes("isn't answering")), problems.join('\n'));
});

test("refuses while something answers on the verify mock's port, and doesn't probe Strapi then", async () => {
  const { appUrl, seen } = await fakeApp();
  const mockVerifyPort = await listen((_req, res) => res.end('{}'));
  const problems = await checkTunnel({ root: demo('line'), appUrl, mockVerifyPort });
  assert.ok(problems.some((problem) => problem.includes(`127.0.0.1:${mockVerifyPort}`)), problems.join('\n'));
  assert.ok(!seen.some((request) => request.includes('/oauth/token')), 'no forged token was sent');
});

test('refuses when the running Strapi accepts a forged ID token, or cannot check one', async () => {
  for (const [token, words] of [
    [[200, { access_token: 'mcp_at_forged', token_type: 'Bearer' }], 'accepted a forged'],
    [[503, { error: 'temporarily_unavailable' }], "couldn't check"],
    [[502, { error: 'temporarily_unavailable' }], "couldn't reach Strapi"], // the app's proxy, with Strapi stopped
    [[401, { error: 'invalid_client' }], 'npm run setup'],
  ]) {
    const { appUrl } = await fakeApp({ token });
    const problems = await checkTunnel({ root: demo('line'), appUrl, mockVerifyPort: await freePort() });
    assert.ok(problems.some((problem) => problem.includes(words)), `${words}: ${problems.join('\n')}`);
  }
});

test('a dry run starts no tunnel and never prints a value from either file', async () => {
  const lines = [];
  const started = [];
  const { appUrl } = await fakeApp();
  const code = await main(['--dry-run'], {
    root: demo('line'),
    appUrl,
    mockVerifyPort: await freePort(),
    log: (line) => lines.push(line),
    startNgrok: (args) => started.push(args),
  });
  assert.equal(code, 0);
  assert.deepEqual(started, []);
  const out = lines.join('\n');
  for (const value of [SECRET, '1234567891-AbcdEfgh', '1234567891', 'maison-test.ngrok-free.dev', 'mcp_client_test']) {
    assert.ok(!out.includes(value), `printed ${value}`);
  }
});

test('starts ngrok on your domain, with its traffic inspector off, once every check passes', async () => {
  const started = [];
  const { appUrl } = await fakeApp();
  const code = await main([], {
    root: demo('line'),
    appUrl,
    mockVerifyPort: await freePort(),
    log: () => {},
    startNgrok: async (args) => {
      started.push(args);
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(started, [['http', '127.0.0.1:3004', '--url=https://maison-test.ngrok-free.dev', '--inspect=false']]);
});
