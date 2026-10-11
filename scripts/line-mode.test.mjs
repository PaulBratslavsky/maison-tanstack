import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { main, readEnv } from './line-mode.mjs';

const SECRET = 'jwt-secret-that-must-never-print';
const INPUTS = { LINE_MODE_LIFF_ID: '1234567891-AbcdEfgh', LINE_MODE_CHANNEL_ID: '1234567891', LINE_MODE_DOMAIN: 'maison-test.ngrok-free.dev' };

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/**
 * A checkout in local mode, as `npm install` and `npm run setup` leave it, plus `liffExtra` in app/.env. app/.env
 * is readable by others (644), as an editor may leave a file it saved: the switch makes it 600.
 */
const demo = (liffExtra = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'maison-mode-'));
  roots.push(root);
  mkdirSync(join(root, 'strapi'));
  mkdirSync(join(root, 'app'));
  const lines = (values) => Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('');
  writeFileSync(
    join(root, 'strapi', '.env'),
    lines({ PORT: '1339', JWT_SECRET: SECRET, LINE_LOGIN_CHANNEL_ID: '1234567890', LINE_VERIFY_URL: 'http://127.0.0.1:4546/verify', MAISON_LIFF_URL: 'http://localhost:3004', MAISON_APP_ORIGIN: '', PUBLIC_URL: '' }),
    { mode: 0o600 }
  );
  writeFileSync(join(root, 'app', '.env'), lines({ VITE_STRAPI_URL: 'http://localhost:1339', VITE_MAISON_CLIENT_ID: 'mcp_client_test', ...liffExtra }));
  chmodSync(join(root, 'app', '.env'), 0o644); // whatever the umask
  return root;
};
const fileMode = (root, app) => statSync(join(root, app, '.env')).mode & 0o777;
const run = (args, root) => {
  const lines = [];
  const code = main(args, { root, log: (line) => lines.push(line) });
  return { code, out: lines.join('\n') };
};
const env = (root, app) => readEnv(join(root, app, '.env'));
const pick = (values, keys) => Object.fromEntries(keys.map((key) => [key, values[key]]));
const STRAPI_KEYS = ['LINE_LOGIN_CHANNEL_ID', 'LINE_VERIFY_URL', 'MAISON_LIFF_URL', 'PUBLIC_URL'];
const LIFF_KEYS = ['VITE_LIFF_MOCK', 'VITE_LIFF_ID', 'VITE_STRAPI_URL', 'STRAPI_URL'];

test('switches to LINE mode and back, and a second run of either changes nothing', () => {
  const root = demo(INPUTS);
  assert.match(run(['status'], root).out, /^Mode: local /);
  assert.equal(fileMode(root, 'app'), 0o644);

  assert.equal(run(['line'], root).code, 0);
  for (const app of ['strapi', 'app']) assert.equal(fileMode(root, app), 0o600, `${app}/.env is readable by you only`);
  assert.deepEqual(pick(env(root, 'strapi'), STRAPI_KEYS), {
    LINE_LOGIN_CHANNEL_ID: '1234567891',
    LINE_VERIFY_URL: '',
    MAISON_LIFF_URL: 'https://liff.line.me/1234567891-AbcdEfgh',
    PUBLIC_URL: 'https://maison-test.ngrok-free.dev',
  });
  assert.deepEqual(pick(env(root, 'app'), LIFF_KEYS), {
    VITE_LIFF_MOCK: 'false',
    VITE_LIFF_ID: '1234567891-AbcdEfgh',
    VITE_STRAPI_URL: 'https://maison-test.ngrok-free.dev',
    // The app's server reaches Strapi on this machine, never through the tunnel (the proxy and the concierge).
    STRAPI_URL: 'http://127.0.0.1:1339',
  });
  const files = () => ['strapi', 'app'].map((app) => readFileSync(join(root, app, '.env'), 'utf8')).join('\n');
  const once = files();
  run(['line'], root);
  assert.equal(files(), once);
  assert.match(run(['status'], root).out, /^Mode: LINE /);
  assert.equal(run(['require-line'], root).code, 0);

  assert.equal(run(['local'], root).code, 0);
  assert.deepEqual(pick(env(root, 'strapi'), STRAPI_KEYS), {
    LINE_LOGIN_CHANNEL_ID: '1234567890',
    LINE_VERIFY_URL: 'http://127.0.0.1:4546/verify',
    MAISON_LIFF_URL: 'http://localhost:3004',
    PUBLIC_URL: '',
  });
  assert.deepEqual(pick(env(root, 'app'), LIFF_KEYS), {
    VITE_LIFF_MOCK: 'true',
    VITE_LIFF_ID: '',
    VITE_STRAPI_URL: 'http://localhost:1339',
    STRAPI_URL: 'http://127.0.0.1:1339',
  });
  const local = files();
  run(['local'], root);
  assert.equal(files(), local);
  assert.equal(env(root, 'strapi').JWT_SECRET, SECRET);
  assert.equal(env(root, 'app').VITE_MAISON_CLIENT_ID, 'mcp_client_test');
  for (const app of ['strapi', 'app']) assert.equal(fileMode(root, app), 0o600);
  assert.match(run(['status'], root).out, /^Mode: local /);
  assert.equal(run(['require-line'], root).code, 1);
});

test('back in local mode, says to stop ngrok first: a tunnel left open would reach the app on the LIFF mock', () => {
  const root = demo(INPUTS);
  run(['line'], root);
  const { code, out } = run(['local'], root);
  assert.equal(code, 0);
  assert.match(out, /^Stop ngrok first \(Ctrl-C in its terminal\)\./m);
});

const REFUSE_DEV = 'The app is in LINE mode. For the stage, run npm run mode:local, then restart Strapi.';

test('require-local, which npm run dev runs first, refuses LINE mode and lets local mode through', () => {
  const root = demo(INPUTS);
  assert.equal(run(['require-local'], root).code, 0);
  run(['line'], root);
  const { code, out } = run(['require-local'], root);
  assert.equal(code, 1);
  assert.ok(out.split('\n').includes(REFUSE_DEV), out);
  run(['local'], root);
  assert.equal(run(['require-local'], root).code, 0);
});

test('require-local refuses whenever the app is set for LINE, though the rest is mixed, and lets the LIFF mock through', () => {
  // The app's own setting decides what npm run dev would start: vite dev on the LIFF mock, or on LINE.
  const lineApp = demo({ ...INPUTS, VITE_LIFF_MOCK: 'false' });
  assert.match(run(['status'], lineApp).out, /^Mode: mixed\./);
  assert.equal(run(['require-local'], lineApp).code, 1);
  const mockApp = demo({ VITE_LIFF_MOCK: 'true' });
  assert.equal(run(['require-local'], mockApp).code, 0);
});

test('npm run dev and npm run dev:app run require-local before they start anything', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['dev', 'dev:app']) assert.match(scripts[name], /^node scripts\/line-mode\.mjs require-local && /, name);
});

// Strapi reads strapi/.env with dotenv, which also takes CRLF and CR-only lines, `export KEY=…` with a space or a tab,
// whitespace around `=` (NBSP too: JavaScript's \s), `KEY: value`, and lets a later line override an earlier one. The
// switch reads and rewrites the files the same way. Strapi's own dotenv is the reference.
const dotenv = createRequire(new URL('../strapi/package.json', import.meta.url))('dotenv');
const DOTENV_FORMS = {
  export: 'export LINE_VERIFY_URL=http://127.0.0.1:4546/verify\n',
  spaced: 'LINE_VERIFY_URL = http://127.0.0.1:4546/verify\n',
  colon: 'LINE_VERIFY_URL: http://127.0.0.1:4546/verify\n',
  crlf: 'LINE_VERIFY_URL=http://127.0.0.1:4546/verify\r\n',
  'export and a tab': 'export\tLINE_VERIFY_URL=http://127.0.0.1:4546/verify\n',
  'export and an NBSP': 'export LINE_VERIFY_URL=http://127.0.0.1:4546/verify\n',
  'an NBSP before the key': ' LINE_VERIFY_URL=http://127.0.0.1:4546/verify\n',
  'NBSPs around = and after the value': 'LINE_VERIFY_URL = http://127.0.0.1:4546/verify \n',
  'colon and an NBSP': 'LINE_VERIFY_URL: http://127.0.0.1:4546/verify\n',
  // After a line that ends with CR alone (an old Mac's): Node's parser reads the two as one line.
  'CR-only line ends': 'MAISON_APP_ORIGIN=\rLINE_VERIFY_URL=http://127.0.0.1:4546/verify\r',
};

test("reads every form Strapi's dotenv reads: a LINE_VERIFY_URL added later in any of them leaves LINE mode", () => {
  for (const [form, line] of Object.entries(DOTENV_FORMS)) {
    const root = demo(INPUTS);
    run(['line'], root);
    const file = join(root, 'strapi', '.env');
    appendFileSync(file, line);
    const asStrapiReadsIt = () => dotenv.parse(readFileSync(file));
    assert.equal(asStrapiReadsIt().LINE_VERIFY_URL, 'http://127.0.0.1:4546/verify', `Strapi's dotenv reads ${form}`);
    assert.deepEqual(env(root, 'strapi'), asStrapiReadsIt(), form);
    assert.doesNotMatch(run(['status'], root).out, /^Mode: LINE /, form);
    assert.equal(run(['require-line'], root).code, 1, form);
    // Switching again rewrites that line too, so it can't override LINE mode's.
    assert.equal(run(['line'], root).code, 0, form);
    assert.equal(env(root, 'strapi').LINE_VERIFY_URL, '', form);
    assert.deepEqual(env(root, 'strapi'), asStrapiReadsIt(), form);
    assert.match(run(['status'], root).out, /^Mode: LINE /, form);
  }
});

test("reads a BOM, CR-only line ends, export and a tab, and NBSP as Strapi's dotenv does, and keeps an NBSP inside a value", () => {
  const root = demo();
  const file = join(root, 'strapi', '.env');
  const text = [
    '﻿HOST=127.0.0.1',
    'export\tPORT=1339',
    ' LINE_VERIFY_URL = http://127.0.0.1:4546/verify # the mock',
    'MAISON_LIFF_URL: http://localhost:3004',
    'PUBLIC_URL="a b"',
    'MAISON_APP_ORIGIN=x y',
  ]
    .map((line) => `${line}\r`)
    .join('');
  writeFileSync(file, text, { mode: 0o600 });
  assert.deepEqual(readEnv(file), {
    HOST: '127.0.0.1',
    PORT: '1339',
    LINE_VERIFY_URL: 'http://127.0.0.1:4546/verify',
    MAISON_LIFF_URL: 'http://localhost:3004',
    PUBLIC_URL: 'a b',
    MAISON_APP_ORIGIN: 'x y',
  });
  assert.deepEqual(readEnv(file), dotenv.parse(text));
});

test('rewrites a key behind an NBSP or a tab as plain KEY=value (keeping an export), and keeps CR-only line ends, also for a key it adds', () => {
  const root = demo(INPUTS);
  const file = join(root, 'strapi', '.env');
  const cr = (lines) => lines.map((line) => `${line}\r`).join('');
  // No PUBLIC_URL: the switch adds it.
  writeFileSync(file, cr(['PORT=1339', 'export\tLINE_LOGIN_CHANNEL_ID=1234567890', ' LINE_VERIFY_URL = http://127.0.0.1:4546/verify', 'MAISON_LIFF_URL: http://localhost:3004']), { mode: 0o600 });
  assert.match(run(['status'], root).out, /^Mode: local /);
  assert.equal(run(['line'], root).code, 0);
  const { LINE_MODE_CHANNEL_ID, LINE_MODE_LIFF_ID, LINE_MODE_DOMAIN } = INPUTS;
  const line = cr([
    'PORT=1339',
    `export LINE_LOGIN_CHANNEL_ID=${LINE_MODE_CHANNEL_ID}`,
    'LINE_VERIFY_URL=',
    `MAISON_LIFF_URL=https://liff.line.me/${LINE_MODE_LIFF_ID}`,
    `PUBLIC_URL=https://${LINE_MODE_DOMAIN}`,
  ]);
  assert.equal(readFileSync(file, 'utf8'), line);
  assert.match(run(['status'], root).out, /^Mode: LINE /);
  run(['line'], root);
  assert.equal(readFileSync(file, 'utf8'), line);
});

test('rewrites each key where it stands, in its form, keeping CRLF line endings and the file readable by you only', () => {
  const root = demo(INPUTS);
  const file = join(root, 'strapi', '.env');
  const crlf = (lines) => lines.map((line) => `${line}\r\n`).join('');
  writeFileSync(
    file,
    crlf(['PORT=1339', `JWT_SECRET=${SECRET}`, 'export LINE_LOGIN_CHANNEL_ID=1234567890', 'LINE_VERIFY_URL = http://127.0.0.1:4546/verify', 'MAISON_LIFF_URL: http://localhost:3004', 'PUBLIC_URL=']),
    { mode: 0o600 }
  );
  assert.deepEqual(pick(env(root, 'strapi'), STRAPI_KEYS), {
    LINE_LOGIN_CHANNEL_ID: '1234567890',
    LINE_VERIFY_URL: 'http://127.0.0.1:4546/verify',
    MAISON_LIFF_URL: 'http://localhost:3004',
    PUBLIC_URL: '',
  });
  assert.match(run(['status'], root).out, /^Mode: local /);

  assert.equal(run(['line'], root).code, 0);
  const line = crlf([
    'PORT=1339',
    `JWT_SECRET=${SECRET}`,
    'export LINE_LOGIN_CHANNEL_ID=1234567891',
    'LINE_VERIFY_URL=',
    'MAISON_LIFF_URL=https://liff.line.me/1234567891-AbcdEfgh',
    'PUBLIC_URL=https://maison-test.ngrok-free.dev',
  ]);
  assert.equal(readFileSync(file, 'utf8'), line);
  assert.match(run(['status'], root).out, /^Mode: LINE /);
  run(['line'], root);
  assert.equal(readFileSync(file, 'utf8'), line);

  assert.equal(run(['local'], root).code, 0);
  const local = crlf(['PORT=1339', `JWT_SECRET=${SECRET}`, 'export LINE_LOGIN_CHANNEL_ID=1234567890', 'LINE_VERIFY_URL=http://127.0.0.1:4546/verify', 'MAISON_LIFF_URL=http://localhost:3004', 'PUBLIC_URL=']);
  assert.equal(readFileSync(file, 'utf8'), local);
  run(['local'], root);
  assert.equal(readFileSync(file, 'utf8'), local);
  assert.equal(fileMode(root, 'strapi'), 0o600);
});

test("refuses LINE mode without your LINE values, or with the mock's channel, and changes nothing", () => {
  for (const liffExtra of [{}, { ...INPUTS, LINE_MODE_CHANNEL_ID: '1234567890' }, { ...INPUTS, LINE_MODE_DOMAIN: 'https://maison-test.ngrok-free.dev' }]) {
    const root = demo(liffExtra);
    const before = readFileSync(join(root, 'strapi', '.env'), 'utf8');
    const { code, out } = run(['line'], root);
    assert.equal(code, 1);
    assert.match(out, /LINE_MODE_/);
    assert.equal(readFileSync(join(root, 'strapi', '.env'), 'utf8'), before);
  }
});

test('never prints a value from either file', () => {
  const root = demo(INPUTS);
  const out = ['status', 'line', 'status', 'require-line', 'require-local', 'local', 'require-line', 'require-local'].map((command) => run([command], root).out).join('\n');
  for (const value of [SECRET, ...Object.values(INPUTS), 'mcp_client_test']) assert.ok(!out.includes(value), `printed ${value}`);
});
