// Checks the app's Strapi proxy end to end, the way LINE mode serves it: the production build (`vite preview`, which
// `npm run start:line` runs) in front of a stand-in for Strapi, both on free ports. Run `npm run build` first, in the
// mode to check: VITE_LIFF_MOCK is built into the app, so a build made with VITE_LIFF_MOCK=false in the environment checks
// LINE mode's side, and a plain `npm run build` checks the mock's. On LINE mode's build (X-Maison-Liff: line):
//   - an MCP answer streams: its first event arrives before Strapi writes the second, 1.5 s later
//   - a token exchange's answer, status and Retry-After come back as Strapi sent them
//   - a catalog image comes back byte for byte
//   - nothing else reaches Strapi: /admin, the OAuth authorize and register pages, Maison's REST API, /.well-known,
//     /_health, a climb out of /uploads, a body over 1 MB (413), /mcp with an Authorization that isn't a customer
//     session (401), and another grant at the token endpoint (400)
// On a build for the LIFF mock (X-Maison-Liff: mock) the proxy is closed: its three paths answer 404, and nothing
// reaches Strapi, so a tunnel left open can't mint a session there.
// Every answer says which LIFF the build signs in with (X-Maison-Liff), which `npm run tunnel` checks.
// From app/: node scripts/check-strapi-proxy.mjs. Runs every check, prints each, and exits 1 if any failed.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const TOKEN = '/api/strapi-oauth-mcp-manager/oauth/token';
/** A token exchange as the app sends it (src/lib/session.ts), with a made-up ID token. */
const exchange = {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: 'mcp_client_check',
    subject_token: `valid.U${'0'.repeat(32)}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
  }).toString(),
};
const freePort = () =>
  new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

// The stand-in for Strapi records every path it's asked for, except the Home page text: the app's own server reads it
// from Strapi each time Home renders (src/lib/home-page.ts). It isn't the proxy's, so it isn't counted. Answering 404
// means "no Home page text", and Home shows its built-in text.
const reached = [];
const strapi = createServer((req, res) => {
  if (req.url.startsWith('/api/home-page')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{"error":{"status":404}}');
  }
  reached.push(`${req.method} ${req.url}`);
  if (req.url === '/mcp') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n');
    setTimeout(() => res.end('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{}}\n\n'), 1500);
  } else if (req.url === '/api/strapi-oauth-mcp-manager/oauth/token') {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '5' });
    res.end('{"error":"temporarily_unavailable"}');
  } else if (req.url === '/uploads/weekender_50.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PNG);
  } else {
    res.writeHead(200);
    res.end('Strapi was reached');
  }
});
await new Promise((resolve) => strapi.listen(0, '127.0.0.1', resolve));
const appPort = await freePort();
const app = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], {
  env: { ...process.env, STRAPI_URL: `http://127.0.0.1:${strapi.address().port}` },
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.on('exit', () => app.kill('SIGTERM')); // also when a check throws
const base = `http://127.0.0.1:${appPort}`;

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok' : 'FAILED'}: ${label}`);
  if (!ok) failed = true;
};
try {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      await fetch(`${base}/`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const home = await fetch(`${base}/`);
  const liff = home.headers.get('x-maison-liff');
  check(home.status === 200 && (liff === 'mock' || liff === 'line'), `the app answers with X-Maison-Liff: ${liff}`);

  if (liff === 'mock') {
    for (const [path, init] of [
      ['/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }],
      [TOKEN, exchange],
      ['/uploads/weekender_50.png', {}],
    ]) {
      const response = await fetch(`${base}${path}`, init);
      check(response.status === 404, `${init.method ?? 'GET'} ${path} answers 404 from a build for the LIFF mock`);
    }
    check(reached.length === 0, `Strapi was never reached (${reached.join(', ')})`);
  } else {
    const started = performance.now();
    const mcp = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Accept-Encoding': 'gzip' },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    });
    const reader = mcp.body.getReader();
    const first = await reader.read();
    const firstAt = performance.now() - started;
    let rest = '';
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += new TextDecoder().decode(chunk.value);
    check(
      mcp.status === 200 && new TextDecoder().decode(first.value).includes('"id":1') && firstAt < 1000 && rest.includes('"id":2'),
      `/mcp streams: the first event after ${Math.round(firstAt)} ms, before Strapi wrote the second (1500 ms)`
    );

    const token = await fetch(`${base}${TOKEN}`, exchange);
    check(
      token.status === 503 && token.headers.get('retry-after') === '5' && (await token.json()).error === 'temporarily_unavailable',
      'the token endpoint passes back 503, Retry-After: 5 and temporarily_unavailable for a token exchange'
    );

    const image = await fetch(`${base}/uploads/weekender_50.png`);
    check(image.headers.get('content-type') === 'image/png' && Buffer.from(await image.arrayBuffer()).equals(PNG), '/uploads serves the image');

    const before = reached.length;
    for (const [method, path] of [
      ['GET', '/admin'],
      ['GET', '/admin/init'],
      ['GET', '/api/strapi-oauth-mcp-manager/oauth/authorize'],
      ['POST', '/api/strapi-oauth-mcp-manager/oauth/register'],
      ['GET', '/api/maison/collections'],
      ['GET', '/.well-known/oauth-authorization-server'],
      ['GET', '/_health'],
      ['GET', '/uploads/..%2fadmin%2finit'],
    ]) {
      const response = await fetch(`${base}${path}`, { method });
      check(response.status === 404, `${method} ${path} answers 404 from the app`);
    }
    // A body over 1 MB: one that says so (Content-Length), and one that doesn't (chunked) and is counted as it arrives.
    const twoMegabytes = () =>
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < 32; i += 1) controller.enqueue(new Uint8Array(64 * 1024));
          controller.close();
        },
      });
    for (const [path, label, init] of [
      ['/mcp', 'with a Content-Length of 2 MB', { body: 'x'.repeat(2 * 1024 * 1024) }],
      ['/api/strapi-oauth-mcp-manager/oauth/token', 'with 2 MB in chunks', { body: twoMegabytes(), duplex: 'half' }],
    ]) {
      const response = await fetch(`${base}${path}`, { method: 'POST', ...init }).catch((error) => ({ status: `nothing: ${error.cause?.code ?? error.message}` }));
      const answered = response.status === 413 ? '' : ` (it answered ${response.status})`;
      check(response.status === 413, `POST ${path} ${label} answers 413 from the app${answered}`);
    }
    // Only what the phone sends: a customer session on /mcp, and the token exchange.
    const adminToken = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer an-admin-token' }, body: '{}' });
    check(
      adminToken.status === 401 && adminToken.headers.get('www-authenticate') === 'Bearer error="invalid_token"',
      'POST /mcp with an Authorization that is not a customer session answers 401 invalid_token from the app'
    );
    const otherGrant = await fetch(`${base}${TOKEN}`, { ...exchange, body: 'grant_type=client_credentials' });
    check(
      otherGrant.status === 400 && (await otherGrant.json()).error === 'unsupported_grant_type',
      'POST to the token endpoint with another grant answers 400 unsupported_grant_type from the app'
    );
    check(reached.length === before, `Strapi was reached only for the three proxied paths (${reached.join(', ')})`);
  }
} finally {
  app.kill('SIGTERM');
  strapi.close();
}
process.exitCode = failed ? 1 : 0;
