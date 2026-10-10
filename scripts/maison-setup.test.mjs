import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SETUP = new URL('../strapi/scripts/maison-setup.mjs', import.meta.url);
const DEMO_ADMIN = { DEMO_ADMIN_EMAIL: 'admin@maison.example', DEMO_ADMIN_PASSWORD: 'Maison1-not-a-real-password' };

const servers = [];
const folders = [];
after(() => {
  servers.forEach((server) => server.close());
  folders.forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});

/**
 * Strapi on a free port. It answers every request with answer(request), [status, body] (404 until a test sets one),
 * and lists each request it gets as "METHOD /path" in `seen`.
 */
const fakeStrapi = async () => {
  const fake = { seen: [], answer: () => [404, { data: null, error: { status: 404, name: 'NotFoundError', message: 'Not Found' } }] };
  const server = createServer((request, response) => {
    fake.seen.push(`${request.method} ${request.url}`);
    const [status, body] = fake.answer(request);
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  fake.url = `http://127.0.0.1:${server.address().port}`;
  return fake;
};

// The script reads STRAPI_URL when it loads, so the fake Strapi comes first.
const strapi = await fakeStrapi();
process.env.STRAPI_URL = strapi.url;
const { call, grantPublicReads, outputPaths, seedCatalog, seedLines, writeEnv } = await import(SETUP);

const node = promisify(execFile);

test('importing the script runs nothing: no request to Strapi, no output and no exit code', async () => {
  const quiet = await fakeStrapi();
  // With the demo admin's variables set, as npm run setup sets them, so main() would get as far as Strapi if it ran.
  const env = { ...process.env, STRAPI_URL: quiet.url, ...DEMO_ADMIN };
  const { stdout, stderr } = await node(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(SETUP.href)}); console.log('imported');`], { env });
  assert.equal(stdout, 'imported\n');
  assert.equal(stderr, '');
  assert.deepEqual(quiet.seen, []);
});

test('run as npm run setup runs it, from the repo root, it sets up: it asks Strapi first', async () => {
  const fresh = await fakeStrapi();
  const env = { ...process.env, STRAPI_URL: fresh.url, ...DEMO_ADMIN };
  await assert.rejects(node(process.execPath, ['strapi/scripts/maison-setup.mjs'], { cwd: ROOT, env }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, `Setting up the Maison demo on ${fresh.url}.\n`);
    assert.match(error.stderr, /^Setup failed: GET \/admin\/init failed with 404: /);
    return true;
  });
  assert.deepEqual(fresh.seen, ['GET /admin/init']);
});

const signIn = () => call('POST', '/admin/login', { email: DEMO_ADMIN.DEMO_ADMIN_EMAIL, password: DEMO_ADMIN.DEMO_ADMIN_PASSWORD });
const failure = (status, name, message) => [status, { data: null, error: { status, name, message, details: {} } }];
const START_OVER = 'To start over, stop Strapi, delete strapi/.tmp/data.db and start it again';

test("a sign-in that fails, but for 429, says the demo admin may not be this database's first admin, and where to start over", async () => {
  // 400 is what Strapi answers for a wrong email or password.
  for (const answer of [failure(400, 'ApplicationError', 'Invalid credentials'), failure(401, 'UnauthorizedError', 'Unauthorized'), failure(500, 'InternalServerError', 'Internal Server Error')]) {
    strapi.answer = () => answer;
    await assert.rejects(signIn(), (error) => {
      assert.ok(error.message.startsWith(`POST /admin/login failed with ${answer[0]}: ${JSON.stringify(answer[1].error)} `), error.message);
      assert.match(error.message, /DEMO_ADMIN_EMAIL/);
      assert.match(error.message, /first admin/);
      assert.ok(error.message.endsWith(`${START_OVER}.`), error.message);
      return true;
    });
  }
});

test('a sign-in answered 429 keeps its own message, and other calls get no sign-in hint', async () => {
  strapi.answer = () => failure(429, 'RateLimitError', 'Too many requests, please try again later.');
  await assert.rejects(signIn(), { message: 'POST /admin/login answered 429: Strapi allows 5 admin sign-ins per 5 minutes. Wait, or restart Strapi.' });
  strapi.answer = () => failure(401, 'UnauthorizedError', 'Missing or invalid credentials');
  await assert.rejects(call('GET', '/strapi-oauth-mcp-manager/clients', undefined, 'expired-jwt'), (error) => {
    assert.equal(error.message, 'GET /strapi-oauth-mcp-manager/clients failed with 401: {"status":401,"name":"UnauthorizedError","message":"Missing or invalid credentials","details":{}}');
    return true;
  });
});

/** A folder of its own, with `files` written in it ({ name: text }), and the path of its .env. */
const folderWith = (files) => {
  const folder = mkdtempSync(join(tmpdir(), 'maison-setup-'));
  folders.push(folder);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text, { mode: 0o600 });
  return join(folder, '.env');
};
const fileMode = (file) => statSync(file).mode & 0o777;

test('writes a value with $&, $1 and $$ in it as it is', () => {
  const file = folderWith({ '.env': 'VITE_STRAPI_URL=http://localhost:1339\nVITE_MAISON_CLIENT_ID=mcp_client_old\n' });
  writeEnv(file, { VITE_MAISON_CLIENT_ID: 'mcp_$&_$1_$$_x', VITE_STRAPI_URL: 'http://localhost:1339/$1' });
  assert.equal(readFileSync(file, 'utf8'), 'VITE_STRAPI_URL=http://localhost:1339/$1\nVITE_MAISON_CLIENT_ID=mcp_$&_$1_$$_x\n');
});

test('updates a key written as export KEY=… where it stands, adding no second one', () => {
  const file = folderWith({ '.env': 'export VITE_STRAPI_URL=http://localhost:1339\nOLLAMA_MODEL=qwen3-14b-32k\n' });
  writeEnv(file, { VITE_STRAPI_URL: 'http://localhost:1339' });
  assert.equal(readFileSync(file, 'utf8'), 'export VITE_STRAPI_URL=http://localhost:1339\nOLLAMA_MODEL=qwen3-14b-32k\n');
});

test('updates every line that sets the key, a later one too, so the new value is the one read, adding none', () => {
  // dotenv and Node's --env-file both take the last line that sets a key.
  const file = folderWith({ '.env': 'OLLAMA_MODEL=qwen3-14b-32k\nVITE_MAISON_CLIENT_ID=mcp_client_old\nSTRAPI_URL=http://127.0.0.1:1339\nVITE_MAISON_CLIENT_ID=mcp_client_older\n' });
  writeEnv(file, { VITE_MAISON_CLIENT_ID: 'mcp_client_new' });
  assert.equal(
    readFileSync(file, 'utf8'),
    'OLLAMA_MODEL=qwen3-14b-32k\nVITE_MAISON_CLIENT_ID=mcp_client_new\nSTRAPI_URL=http://127.0.0.1:1339\nVITE_MAISON_CLIENT_ID=mcp_client_new\n'
  );
  // Node's --env-file and dotenv both take the last line that sets a key: both lines hold the new value.
  assert.deepEqual(readFileSync(file, 'utf8').match(/^VITE_MAISON_CLIENT_ID=.*$/gm), ['VITE_MAISON_CLIENT_ID=mcp_client_new', 'VITE_MAISON_CLIENT_ID=mcp_client_new']);
});

test('adds a missing key and changes no other value, keeping comments and a CRLF file as CRLF', () => {
  const file = folderWith({ '.env': '# The app.\r\nVITE_STRAPI_URL=http://old\r\nANTHROPIC_API_KEY=kept-as-it-is\r\nVITE_LIFF_MOCK=true' });
  writeEnv(file, { VITE_STRAPI_URL: 'http://localhost:1339', VITE_MAISON_CLIENT_ID: 'mcp_client_new' });
  assert.equal(
    readFileSync(file, 'utf8'),
    '# The app.\r\nVITE_STRAPI_URL=http://localhost:1339\r\nANTHROPIC_API_KEY=kept-as-it-is\r\nVITE_LIFF_MOCK=true\r\nVITE_MAISON_CLIENT_ID=mcp_client_new\r\n'
  );
});

test('a key written as KEY: value is replaced, and a commented key is left alone', () => {
  const file = folderWith({ '.env': '# VITE_MAISON_CLIENT_ID=commented\nVITE_MAISON_CLIENT_ID: mcp_client_old\n' });
  writeEnv(file, { VITE_MAISON_CLIENT_ID: 'mcp_client_new' });
  assert.equal(readFileSync(file, 'utf8'), '# VITE_MAISON_CLIENT_ID=commented\nVITE_MAISON_CLIENT_ID=mcp_client_new\n');
});

test('tightens an existing .env to mode 600', () => {
  const file = folderWith({ '.env': 'VITE_STRAPI_URL=\n' });
  chmodSync(file, 0o644);
  writeEnv(file, { VITE_STRAPI_URL: 'http://localhost:1339' });
  assert.equal(fileMode(file), 0o600);
});

test('without a .env, copies .env.example, then writes the values into it, readable by you only', () => {
  const example = 'VITE_STRAPI_URL=\nVITE_MAISON_CLIENT_ID=\n# Ollama, when there is no API key\nOLLAMA_MODEL=qwen3-14b-32k\n';
  const file = folderWith({ '.env.example': example });
  chmodSync(join(file, '..', '.env.example'), 0o644);
  assert.equal(existsSync(file), false);
  writeEnv(file, { VITE_STRAPI_URL: 'http://localhost:1339', VITE_MAISON_CLIENT_ID: 'mcp_client_new' });
  assert.equal(
    readFileSync(file, 'utf8'),
    'VITE_STRAPI_URL=http://localhost:1339\nVITE_MAISON_CLIENT_ID=mcp_client_new\n# Ollama, when there is no API key\nOLLAMA_MODEL=qwen3-14b-32k\n'
  );
  assert.equal(fileMode(file), 0o600);
  assert.equal(readFileSync(join(file, '..', '.env.example'), 'utf8'), example, '.env.example is left as it was');
});

const CATALOG = ['plugin::maison.collections.find', 'plugin::maison.products.find', 'plugin::maison.products.findOne', 'plugin::maison.boutiques.find', 'plugin::maison.knowledge.find'];
const HOME_PAGE_FIND = 'api::home-page.home-page.find';
// What a fresh database's Public role allows: users-permissions' own sign-in and sign-up routes.
const AUTH = ['plugin::users-permissions.auth.callback', 'plugin::users-permissions.auth.connect', 'plugin::users-permissions.auth.register'];
// Actions Strapi has that the Public role never gets from setup.
const OTHERS = [
  'api::home-page.home-page.update',
  'api::home-page.home-page.delete',
  'plugin::maison.customer.requestAppointment',
  'plugin::maison.customer.myAppointments',
  'plugin::users-permissions.user.me',
];

/**
 * users-permissions' admin routes for roles, as setup calls them, with the Public role allowing `enabled`. A role's tree
 * lists every action Strapi has (`actions`), each enabled or not. PUT takes the tree as the role's whole set, as
 * users-permissions' updateRole does: an action that isn't enabled in it is gone. With `keeps`, the role keeps only the
 * enabled actions it accepts, for an update that doesn't go as sent.
 */
const usersPermissions = ({ actions, enabled, keeps = () => true }) => {
  const fake = { enabled: new Set(enabled), puts: [] };
  const tree = () => {
    const permissions = {};
    for (const action of actions) {
      const [type, controller, name] = action.split('.');
      ((permissions[type] ??= { controllers: {} }).controllers[controller] ??= {})[name] = { enabled: fake.enabled.has(action), policy: '' };
    }
    return permissions;
  };
  fake.api = async (method, path, body) => {
    if (method === 'GET' && path === '/users-permissions/roles') return { roles: [{ id: 1, type: 'authenticated' }, { id: 2, type: 'public' }] };
    if (method === 'GET' && path === '/users-permissions/roles/2') return { role: { id: 2, name: 'Public', description: 'Default role given to unauthenticated user.', permissions: tree() } };
    if (method === 'PUT' && path === '/users-permissions/roles/2') {
      fake.puts.push(body);
      fake.enabled = new Set(
        Object.entries(body.permissions)
          .flatMap(([type, { controllers }]) =>
            Object.entries(controllers).flatMap(([controller, names]) => Object.entries(names).filter(([, { enabled }]) => enabled).map(([name]) => `${type}.${controller}.${name}`))
          )
          .filter(keeps)
      );
      return { ok: true };
    }
    throw new Error(`Unexpected call: ${method} ${path}`);
  };
  return fake;
};

test("lets the Public role read the catalog and the Home page, keeps what it allowed, and sends nothing when it's done", async () => {
  const actions = [...CATALOG, HOME_PAGE_FIND, ...AUTH, ...OTHERS];
  const strapi = usersPermissions({ actions, enabled: [...AUTH, CATALOG[0]] });
  assert.equal(await grantPublicReads(strapi.api), true);
  assert.equal(strapi.puts.length, 1);
  assert.equal(strapi.puts[0].name, 'Public', 'the role keeps its name');
  assert.deepEqual([...strapi.enabled].sort(), [...AUTH, ...CATALOG, HOME_PAGE_FIND].sort());

  assert.equal(await grantPublicReads(strapi.api), false);
  assert.equal(strapi.puts.length, 1, 'a second run sends nothing');
});

test("says what to do when Strapi has no Home page, and changes nothing", async () => {
  const strapi = usersPermissions({ actions: [...CATALOG, ...AUTH], enabled: AUTH });
  await assert.rejects(grantPublicReads(strapi.api), { message: `Strapi has no ${HOME_PAGE_FIND}: it runs without the Home page (strapi/src/api/home-page). Restart Strapi.` });
  assert.deepEqual(strapi.puts, []);
});

test("checks the role after the update: it fails, naming the action, if the Home page's find is still off or an action it had is gone", async () => {
  const actions = [...CATALOG, HOME_PAGE_FIND, ...AUTH, ...OTHERS];
  const homeStaysOff = usersPermissions({ actions, enabled: AUTH, keeps: (action) => action !== HOME_PAGE_FIND });
  await assert.rejects(grantPublicReads(homeStaysOff.api), {
    message: `The Public role isn't as expected after the update: it still doesn't allow ${HOME_PAGE_FIND}. Check it under Settings > Roles > Public.`,
  });
  const authGone = usersPermissions({ actions, enabled: AUTH, keeps: (action) => action !== AUTH[0] });
  await assert.rejects(grantPublicReads(authGone.api), {
    message: `The Public role isn't as expected after the update: it no longer allows ${AUTH[0]}. Check it under Settings > Roles > Public.`,
  });
});

test("writes the app's settings to app/.env and the ops token to strapi/.tmp, unless told where, as for Strapi Cloud", () => {
  assert.deepEqual(outputPaths({}), {
    appEnv: join(ROOT, 'app', '.env'),
    opsTokenFile: join(ROOT, 'strapi', '.tmp', 'maison-ops-token'),
  });
  // Empty counts as unset, as everywhere in .env files.
  assert.deepEqual(outputPaths({ MAISON_SETUP_APP_ENV: '', MAISON_SETUP_OPS_TOKEN_FILE: '' }), outputPaths({}));
  // From the repo root, so a run against Strapi Cloud never overwrites the laptop's own files.
  assert.deepEqual(outputPaths({ MAISON_SETUP_APP_ENV: 'app/.env.cloud', MAISON_SETUP_OPS_TOKEN_FILE: '.tmp/maison-ops-token.cloud' }), {
    appEnv: join(ROOT, 'app', '.env.cloud'),
    opsTokenFile: join(ROOT, '.tmp', 'maison-ops-token.cloud'),
  });
  assert.equal(outputPaths({ MAISON_SETUP_APP_ENV: '/elsewhere/.env.cloud' }).appEnv, '/elsewhere/.env.cloud');
});

test('waits for Load demo catalog, which answers 202 and loads in the background: it presses again until it is all there', async () => {
  const nothing = { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 0, knowledgeJa: 0 };
  const started = { started: true, collections: 3, products: 12, boutiques: 3, stockLevels: 36, knowledge: 16, knowledgeJa: 16 };
  const busy = new Error('POST /maison/demo/seed failed with 409: {"status":409,"name":"ConflictError","message":"The demo catalog is still loading from the last press.","details":{"code":"already_loading"}}');
  const answers = [started, busy, busy, nothing];
  const presses = [];
  const api = async (method, path, body) => {
    presses.push(`${method} ${path} ${JSON.stringify(body)}`);
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  let pauses = 0;
  const waiting = [];
  const result = await seedCatalog(api, { pause: async () => void (pauses += 1), onStarted: (line) => waiting.push(line) });
  assert.deepEqual(result, { created: true, collections: 3, products: 12, boutiques: 3, stockLevels: 36, knowledge: 16, knowledgeJa: 16 });
  assert.deepEqual(presses, Array(4).fill('POST /maison/demo/seed {}'));
  assert.equal(pauses, 3);
  assert.deepEqual(waiting, ['Loading the demo catalog in the background: setup waits until it is all there.']);
  assert.deepEqual(seedLines(result), ['Loaded the demo catalog.', 'Added 16 product knowledge entries in English and 16 in Japanese.']);
});

test('answers a 200 from Load demo catalog at once, as before', async () => {
  const found = { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 0, knowledgeJa: 16 };
  let presses = 0;
  const result = await seedCatalog(async () => ((presses += 1), found), { pause: async () => assert.fail('no pause') });
  assert.deepEqual(result, found);
  assert.equal(presses, 1);
});

test('waits when a load from the admin is already running, and fails on any other error', async () => {
  const busy = new Error('POST /maison/demo/seed failed with 409: {"details":{"code":"already_loading"}}');
  const nothing = { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 0, knowledgeJa: 0 };
  const answers = [busy, nothing];
  const result = await seedCatalog(async () => { const answer = answers.shift(); if (answer instanceof Error) throw answer; return answer; }, { pause: async () => {} });
  assert.deepEqual(result, nothing);
  await assert.rejects(
    seedCatalog(async () => { throw new Error('POST /maison/demo/seed failed with 404: Not Found'); }, { pause: async () => {} }),
    /404/
  );
});

test('gives up, saying so, when Load demo catalog is still running after the time it allows', async () => {
  let clock = 0;
  const started = { started: true, collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 0, knowledgeJa: 16 };
  const busy = new Error('POST /maison/demo/seed failed with 409: {"details":{"code":"already_loading"}}');
  let first = true;
  const api = async () => { if (first) { first = false; return started; } throw busy; };
  await assert.rejects(
    seedCatalog(api, { pause: async () => void (clock += 1000), now: () => clock, timeoutMs: 5000 }),
    /Load demo catalog is still running after 5 seconds/
  );
});

test('says what the seed did: the catalog it loaded or found, and the product knowledge it added in each language', () => {
  const catalog = { collections: 4, products: 12, boutiques: 3, stockLevels: 20 };
  assert.deepEqual(seedLines({ ...catalog, created: true, knowledge: 16, knowledgeJa: 16 }), [
    'Loaded the demo catalog.',
    'Added 16 product knowledge entries in English and 16 in Japanese.',
  ]);
  // A catalog loaded before gets the knowledge on the next run, and setup says so, not only that the catalog was there.
  assert.deepEqual(seedLines({ ...catalog, created: false, knowledge: 16, knowledgeJa: 16 }), [
    'Demo catalog already loaded.',
    'Added 16 product knowledge entries in English and 16 in Japanese.',
  ]);
  // A Strapi with the English product knowledge, as Strapi Cloud had it, gets the Japanese versions.
  assert.deepEqual(seedLines({ ...catalog, created: false, knowledge: 0, knowledgeJa: 16 }), [
    'Demo catalog already loaded.',
    'Added 16 product knowledge entries in Japanese.',
  ]);
  assert.deepEqual(seedLines({ ...catalog, created: false, knowledge: 0, knowledgeJa: 1 }), ['Demo catalog already loaded.', 'Added 1 product knowledge entry in Japanese.']);
  // Nothing added: nothing to say about it.
  assert.deepEqual(seedLines({ collections: 0, products: 0, boutiques: 0, stockLevels: 0, created: false, knowledge: 0, knowledgeJa: 0 }), ['Demo catalog already loaded.']);
  assert.deepEqual(seedLines({ ...catalog, created: true, knowledge: 0, knowledgeJa: 0 }), ['Loaded the demo catalog.']);
  // A Strapi whose Maison copy predates the Japanese product knowledge answers no `knowledgeJa`.
  assert.deepEqual(seedLines({ ...catalog, created: false, knowledge: 16 }), ['Demo catalog already loaded.', 'Added 16 product knowledge entries in English.']);
  // And one that predates product knowledge answers no `knowledge` at all.
  assert.deepEqual(seedLines({ created: false }), ['Demo catalog already loaded.']);
  assert.deepEqual(seedLines({ created: true }), ['Loaded the demo catalog.']);
});
