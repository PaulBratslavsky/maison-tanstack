// Sets up the Maison demo on a running Strapi. Safe to run again: it replaces what it made before.
//   1. on a fresh database, registers the demo admin (DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD) as its first admin
//   2. loads the demo catalog, and lets websites read it over REST: the Public role gets Maison's five catalog actions,
//      and the Home page's find, for the text on the app's Home screen
//   3. (re)creates the admin tokens "Maison customer" and "Maison ops"
//   4. (re)creates the OAuth client "Maison app" (customer sign-in with LINE, mapped to "Maison customer").
//      oauth-mcp-manager allows one active LINE client, so any other active one is deactivated first.
//   5. writes the app's Strapi URL and client ID to app/.env (VITE_STRAPI_URL and VITE_MAISON_CLIENT_ID), and the ops
//      token to strapi/.tmp/maison-ops-token (MAISON_SETUP_APP_ENV and MAISON_SETUP_OPS_TOKEN_FILE write them elsewhere,
//      for a Strapi such as Strapi Cloud)
// Usage from the repo root: npm run setup (Strapi at STRAPI_URL, or on PORT from strapi/.env).
// Never prints a secret. Importing this file runs nothing (scripts/maison-setup.test.mjs imports it).
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { setEnvValues } from '../../scripts/init-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Where setup writes the app's settings and the ops token, from the repo root: the laptop's own files, unless
 * MAISON_SETUP_APP_ENV and MAISON_SETUP_OPS_TOKEN_FILE say otherwise, so a run against another Strapi (Strapi Cloud)
 * never overwrites them. Empty counts as unset.
 */
export const outputPaths = (env = process.env) => ({
  appEnv: resolve(root, env.MAISON_SETUP_APP_ENV || join('app', '.env')),
  opsTokenFile: resolve(root, env.MAISON_SETUP_OPS_TOKEN_FILE || join('strapi', '.tmp', 'maison-ops-token')),
});
// `||`, not `??`: a key left empty in .env counts as unset.
const STRAPI_URL = (process.env.STRAPI_URL || `http://localhost:${process.env.PORT || 1339}`).replace(/\/+$/, '');
const email = process.env.DEMO_ADMIN_EMAIL;
const password = process.env.DEMO_ADMIN_PASSWORD;

const HINTS = {
  '/maison/demo/seed': 'The Maison plugin is not loaded. Check config/plugins.ts, then run npm install in strapi/.',
  '/strapi-oauth-mcp-manager/overview': 'oauth-mcp-manager is not loaded. Check config/plugins.ts and strapi/package.json.',
};
// For a sign-in that fails with anything but 429, which has its own message.
const SIGN_IN_HINT =
  "The demo admin (DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD in strapi/.env) may not be this database's first admin: setup registers it only on a fresh database. To start over, stop Strapi, delete strapi/.tmp/data.db and start it again.";

export const call = async (method, path, body, jwt) => {
  let response;
  try {
    response = await fetch(`${STRAPI_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(`Strapi isn't answering at ${STRAPI_URL}. Start it first (npm run dev), or set STRAPI_URL.`);
  }
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text.slice(0, 200) };
  }
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(`${method} ${path} answered 429: Strapi allows 5 admin sign-ins per 5 minutes. Wait, or restart Strapi.`);
    }
    const hint = path === '/admin/login' ? ` ${SIGN_IN_HINT}` : response.status === 404 && HINTS[path] ? ` ${HINTS[path]}` : '';
    throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(json.error ?? json)}${hint}`);
  }
  return json.data ?? json;
};

/**
 * Sets KEY=value in an env file with init-env's merge rules (scripts/init-env.mjs): every line that sets the key, in any
 * form dotenv reads, takes the value as it is, a missing key is added at the end, and no other value changes. The file
 * keeps its line endings. A missing file starts as a copy of its .env.example. Leaves the file readable by you only.
 */
export const writeEnv = (file, values) => {
  mkdirSync(dirname(file), { recursive: true });
  const example = file.replace(/\.env$/, '.env.example');
  if (!existsSync(file) && existsSync(example)) copyFileSync(example, file);
  const existed = existsSync(file);
  // `mode` applies only when the file is created, so tighten an existing one before writing into it.
  if (existed) chmodSync(file, 0o600);
  writeFileSync(file, setEnvValues(existed ? readFileSync(file, 'utf8') : '', values), { mode: 0o600 });
};

/**
 * What anyone may read over REST without credentials:
 * - Maison's catalog, for websites (GET /api/maison/collections, /products, /products/:slug, /boutiques and /knowledge). Booking and
 *   "my visits" there take the customer's LINE session, whatever a role holds.
 * - the Home page's published text (GET /api/home-page), which the app's server reads.
 */
const PUBLIC_ACTIONS = [
  'plugin::maison.collections.find',
  'plugin::maison.products.find',
  'plugin::maison.products.findOne',
  'plugin::maison.boutiques.find',
  'plugin::maison.knowledge.find',
  'api::home-page.home-page.find',
];

/** Every action a role's permission tree enables, as "plugin::maison.products.find": its type, controller and action joined by dots. */
const enabledActions = (permissions) =>
  Object.entries(permissions ?? {}).flatMap(([type, { controllers = {} }]) =>
    Object.entries(controllers).flatMap(([controller, actions]) =>
      Object.entries(actions)
        .filter(([, permission]) => permission.enabled)
        .map(([name]) => `${type}.${controller}.${name}`)
    )
  );

/**
 * Lets the Public role call PUBLIC_ACTIONS and changes nothing else about it. users-permissions takes the tree
 * sent to PUT /users-permissions/roles/:id as the role's whole set, and deletes every action not enabled in it, so this
 * reads the role's full tree, enables the five actions in it and sends all of it back. It then reads the role again and
 * fails if an action the role had is gone or one of the five is still off, so "changes nothing else" holds by check, not
 * only by how users-permissions treats the tree. With the five actions already enabled it sends nothing.
 * Answers whether anything changed.
 */
export const grantPublicReads = async (api) => {
  const { roles } = await api('GET', '/users-permissions/roles');
  const publicRole = roles.find((role) => role.type === 'public');
  if (!publicRole) throw new Error('users-permissions has no Public role. Check config/plugins.ts.');
  const { role } = await api('GET', `/users-permissions/roles/${publicRole.id}`);
  // Taken before the loop below enables anything in the same tree.
  const enabledBefore = enabledActions(role.permissions);
  let changed = false;
  for (const action of PUBLIC_ACTIONS) {
    // plugin::maison.collections.find is permissions['plugin::maison'].controllers.collections.find in the tree.
    const [type, controller, name] = action.split('.');
    const permission = role.permissions?.[type]?.controllers?.[controller]?.[name];
    if (!permission) {
      throw new Error(
        action.startsWith('api::home-page.')
          ? `Strapi has no ${action}: it runs without the Home page (strapi/src/api/home-page). Restart Strapi.`
          : `Strapi has no ${action}: the Maison copy it runs predates the REST door. Copy Maison again, run npm install in strapi/ with Strapi stopped, then restart Strapi.`
      );
    }
    if (!permission.enabled) {
      permission.enabled = true;
      changed = true;
    }
  }
  if (changed) {
    await api('PUT', `/users-permissions/roles/${role.id}`, { name: role.name, description: role.description, permissions: role.permissions });
    const { role: updated } = await api('GET', `/users-permissions/roles/${role.id}`);
    const enabledAfter = new Set(enabledActions(updated.permissions));
    const lost = enabledBefore.filter((action) => !enabledAfter.has(action));
    // One of the five that the role had and lost is already named in `lost`.
    const missing = PUBLIC_ACTIONS.filter((action) => !enabledAfter.has(action) && !lost.includes(action));
    if (lost.length || missing.length) {
      const problems = [...(lost.length ? [`it no longer allows ${lost.join(', ')}`] : []), ...(missing.length ? [`it still doesn't allow ${missing.join(', ')}`] : [])];
      throw new Error(`The Public role isn't as expected after the update: ${problems.join(' and ')}. Check it under Settings > Roles > Public.`);
    }
  }
  return changed;
};

/**
 * What setup says about the seed (POST /maison/demo/seed): whether it loaded the catalog or found it there, and, when
 * it added any, how many product knowledge entries in English (`knowledge`) and in Japanese (`knowledgeJa`). A catalog
 * loaded before gets the knowledge on the next run, so "already loaded" alone would hide that it did something.
 */
export const seedLines = (seeded) => {
  const entries = (count) => `${count} product knowledge ${count === 1 ? 'entry' : 'entries'}`;
  const added = seeded.knowledge > 0 ? [`${entries(seeded.knowledge)} in English`] : [];
  if (seeded.knowledgeJa > 0) added.push(`${added.length > 0 ? seeded.knowledgeJa : entries(seeded.knowledgeJa)} in Japanese`);
  return [
    seeded.created ? 'Loaded the demo catalog.' : 'Demo catalog already loaded.',
    ...(added.length > 0 ? [`Added ${added.join(' and ')}.`] : []),
  ];
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Load demo catalog (POST /maison/demo/seed), waiting for it. When it has anything to add it answers 202, with
 * `started: true` and what it will add, and adds it in the background, so setup presses again every second until the
 * answer says everything is there (a 409 `already_loading` means it is still running). Answers what was added, as
 * seedLines reads it: from the first press when that one started the load, or the answer that found it all there.
 * `pause`, `now` and `timeoutMs` are only for tests.
 */
export const seedCatalog = async (api, { pause = () => sleep(1000), now = Date.now, timeoutMs = 120_000, onStarted = (line) => console.log(line) } = {}) => {
  const deadline = now() + timeoutMs;
  let started = null;
  for (;;) {
    let answer = null;
    try {
      answer = await api('POST', '/maison/demo/seed', {});
    } catch (error) {
      if (!String(error?.message).includes('already_loading')) throw error;
    }
    if (answer && answer.started !== true) {
      if (!started) return answer;
      const { started: _started, ...added } = started;
      return { created: added.collections > 0, ...added };
    }
    if (answer && !started) {
      started = answer;
      onStarted('Loading the demo catalog in the background: setup waits until it is all there.');
    }
    if (now() >= deadline) {
      throw new Error(`Load demo catalog is still running after ${Math.round(timeoutMs / 1000)} seconds. Check Strapi's log, then run setup again.`);
    }
    await pause();
  }
};

const main = async () => {
  if (!email || !password) {
    throw new Error('Set DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD in strapi/.env. `npm install` at the repo root creates them.');
  }
  console.log(`Setting up the Maison demo on ${STRAPI_URL}.`);

  // 1. A fresh database has no admin yet: register the demo admin as its first one.
  const { hasAdmin } = await call('GET', '/admin/init');
  const { token: jwt } = hasAdmin
    ? await call('POST', '/admin/login', { email, password })
    : await call('POST', '/admin/register-admin', { email, password, firstname: 'Maison', lastname: 'Demo' });
  if (!hasAdmin) console.log('Registered the first admin of this database (DEMO_ADMIN_EMAIL in strapi/.env).');
  const api = (method, path, body) => call(method, path, body, jwt);

  // Fail early, with the fix, if this Strapi can't sign customers in.
  const overview = await api('GET', '/strapi-oauth-mcp-manager/overview');
  if (!overview.mcpEnabled) throw new Error('Strapi MCP is off. Set mcp.enabled in config/server.ts (MCP_ENABLED).');
  if (!overview.encryptionKeyConfigured) throw new Error('Set ENCRYPTION_KEY in strapi/.env, then restart Strapi.');
  if (!overview.lineSignIn?.configured) throw new Error('Set LINE_LOGIN_CHANNEL_ID in strapi/.env, then restart Strapi.');
  // Strapi reads LINE_LOGIN_CHANNEL_ID when it starts, so a change in strapi/.env needs a restart.
  if (overview.lineSignIn.channelId !== process.env.LINE_LOGIN_CHANNEL_ID) {
    throw new Error('Strapi signs customers in with another LINE channel than strapi/.env names. Restart Strapi.');
  }
  const lineMode = process.env.LINE_LOGIN_CHANNEL_ID !== '1234567890';
  console.log(lineMode ? 'LINE sign-in: your LINE Login channel (LINE mode).' : 'LINE sign-in: the LIFF mock (local mode).');

  // 2. The catalog, and reading it and the Home page over REST without credentials.
  const seeded = await seedCatalog(api);
  for (const line of seedLines(seeded)) console.log(line);
  const actions = PUBLIC_ACTIONS.join(', ');
  console.log(
    (await grantPublicReads(api))
      ? `Let the Public role read the catalog and the Home page over REST: ${actions}.`
      : `The Public role already reads the catalog and the Home page over REST: ${actions}.`
  );

  // 3. The old client first, then the tokens: a client mapped to a deleted token would refuse to connect.
  const clients = await api('GET', '/strapi-oauth-mcp-manager/clients');
  for (const client of clients.filter((c) => c.name === 'Maison app')) {
    await api('DELETE', `/strapi-oauth-mcp-manager/clients/${client.id}`);
  }
  const TOKEN_NAMES = ['Maison customer', 'Maison ops'];
  for (const token of await api('GET', '/admin/admin-tokens')) {
    if (TOKEN_NAMES.includes(token.name)) await api('DELETE', `/admin/admin-tokens/${token.id}`);
  }
  const mint = (name, actions, description) =>
    api('POST', '/admin/admin-tokens', {
      name,
      description,
      lifespan: null,
      adminPermissions: actions.map((action) => ({ action, subject: null, properties: {}, conditions: [] })),
    });
  const customer = await mint(
    'Maison customer',
    ['plugin::maison.catalog.read', 'plugin::maison.appointments.request', 'plugin::maison.questions.ask', 'plugin::maison.inquiries.log'],
    'Every customer session of the Maison app runs with this token.'
  );
  const ops = await mint('Maison ops', ['plugin::maison.confirmations.send'], 'An ops agent in the Maison demo, which can retry LINE confirmations.');

  // 4. One active LINE client at a time: any other one is deactivated (not deleted; reactivate it on the MCP OAuth page).
  for (const client of clients.filter((c) => c.name !== 'Maison app' && c.endUserProvider === 'line' && c.active)) {
    await api('PUT', `/strapi-oauth-mcp-manager/clients/${client.id}`, { active: false });
    console.log(`Deactivated the LINE client "${client.name}": oauth-mcp-manager allows one active LINE client.`);
  }
  const app = await api('POST', '/strapi-oauth-mcp-manager/clients', {
    name: 'Maison app',
    endUserProvider: 'line',
    redirectUris: [],
    adminTokenId: customer.id,
  });

  // 5. Where the app and an ops agent find them.
  // The browser reaches Strapi at PUBLIC_URL when strapi/.env sets one, and at STRAPI_URL otherwise.
  const { appEnv, opsTokenFile } = outputPaths();
  writeEnv(appEnv, {
    VITE_STRAPI_URL: process.env.PUBLIC_URL || STRAPI_URL,
    VITE_MAISON_CLIENT_ID: app.clientId,
  });
  mkdirSync(dirname(opsTokenFile), { recursive: true });
  // `mode` applies only when the file is created, so tighten one left by an earlier run before writing into it.
  if (existsSync(opsTokenFile)) chmodSync(opsTokenFile, 0o600);
  writeFileSync(opsTokenFile, `${ops.accessKey}\n`, { mode: 0o600 });

  console.log(`Created the "Maison app" client ${app.clientId} and wrote it to ${relative(root, appEnv)} (restart the app to pick it up).`);
  console.log(`Wrote the "Maison ops" token to ${relative(root, opsTokenFile)} (see docs/spec.md for the ops tools).`);
};

// Only when run as a script (npm run setup), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    // One line, with the fix, rather than a stack trace.
    console.error(`Setup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
