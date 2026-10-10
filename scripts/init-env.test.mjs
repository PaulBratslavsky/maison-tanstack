import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GENERATED, initEnv, mergeEnv, setEnvValues } from './init-env.mjs';

const EXAMPLE = [
  '# Strapi secrets.',
  'APP_KEYS=tobemodified',
  'ADMIN_JWT_SECRET=tobemodified',
  'PORT=1339',
  '# The model key.',
  'AI_API_KEY=',
  '',
].join('\n');

const fixedSecrets = { APP_KEYS: () => 'made-keys', ADMIN_JWT_SECRET: () => 'made-secret' };

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'init-env-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test('mergeEnv copies the example when there is no .env, and fills generated values', () => {
  const { text, added, filled } = mergeEnv(null, EXAMPLE, fixedSecrets);
  assert.match(text, /^APP_KEYS=made-keys$/m);
  assert.match(text, /^ADMIN_JWT_SECRET=made-secret$/m);
  assert.match(text, /^PORT=1339$/m);
  assert.match(text, /^# The model key\.$/m);
  assert.deepEqual(added, []);
  assert.deepEqual(filled, ['APP_KEYS', 'ADMIN_JWT_SECRET']);
});

test('mergeEnv never changes or drops a value that is already set', () => {
  const existing = 'AI_API_KEY=kept-value\nAPP_KEYS=old-keys\nMY_OWN=stays\n';
  const { text } = mergeEnv(existing, EXAMPLE, fixedSecrets);
  assert.match(text, /^AI_API_KEY=kept-value$/m);
  assert.match(text, /^APP_KEYS=old-keys$/m);
  assert.match(text, /^MY_OWN=stays$/m);
});

test('mergeEnv adds the keys the example has and the file lacks, with their example values', () => {
  const existing = 'AI_API_KEY=kept-value\n';
  const { text, added } = mergeEnv(existing, EXAMPLE, fixedSecrets);
  assert.deepEqual(added, ['APP_KEYS', 'ADMIN_JWT_SECRET', 'PORT']);
  assert.match(text, /^PORT=1339$/m);
  assert.match(text, /^APP_KEYS=made-keys$/m);
  assert.equal(text.match(/^AI_API_KEY=/gm).length, 1);
});

test('mergeEnv fills a placeholder in an existing file', () => {
  const existing = 'APP_KEYS=tobemodified\nADMIN_JWT_SECRET=\nAI_API_KEY=kept-value\n';
  const { text, filled } = mergeEnv(existing, EXAMPLE, fixedSecrets);
  assert.match(text, /^APP_KEYS=made-keys$/m);
  assert.match(text, /^ADMIN_JWT_SECRET=made-secret$/m);
  assert.deepEqual(filled, ['APP_KEYS', 'ADMIN_JWT_SECRET']);
});

test('mergeEnv keeps CRLF line endings', () => {
  const existing = 'AI_API_KEY=kept-value\r\n';
  const { text } = mergeEnv(existing, EXAMPLE, fixedSecrets);
  assert.ok(text.startsWith('AI_API_KEY=kept-value\r\n'));
  assert.match(text, /\r\nPORT=1339\r\n/);
  assert.doesNotMatch(text, /[^\r]\n/);
});

test('mergeEnv reads keys written as `export KEY=`', () => {
  const existing = 'export AI_API_KEY=kept-value\n';
  const { text, added } = mergeEnv(existing, EXAMPLE, fixedSecrets);
  assert.ok(!added.includes('AI_API_KEY'));
  assert.match(text, /^export AI_API_KEY=kept-value$/m);
});

test('mergeEnv fills only the last line of a duplicated key, the one dotenv reads', () => {
  const existing = 'APP_KEYS=real\nAI_API_KEY=x\nAPP_KEYS=\n';
  const { text } = mergeEnv(existing, EXAMPLE, fixedSecrets);
  assert.match(text, /^APP_KEYS=real\nAI_API_KEY=x\nAPP_KEYS=made-keys\n/);
});

test('mergeEnv never fills a set value that only starts with tobemodified', () => {
  const existing = 'APP_KEYS=tobemodifiedreal\nADMIN_JWT_SECRET="tobemodified"\n';
  const { text, filled } = mergeEnv(existing, EXAMPLE, fixedSecrets);
  assert.match(text, /^APP_KEYS=tobemodifiedreal$/m);
  assert.deepEqual(filled, ['ADMIN_JWT_SECRET']);
});

test('mergeEnv fills an empty `export KEY=` and keeps the export', () => {
  const { text } = mergeEnv('export APP_KEYS=\n', EXAMPLE, fixedSecrets);
  assert.match(text, /^export APP_KEYS=made-keys$/m);
});

test('mergeEnv returns the file unchanged when nothing is missing, even without a trailing newline', () => {
  const existing = 'APP_KEYS=a\r\nADMIN_JWT_SECRET=b\nPORT=1\r\nAI_API_KEY=c';
  assert.equal(mergeEnv(existing, EXAMPLE, fixedSecrets).text, existing);
});

test('mergeEnv keeps each line ending as it was and adds a line break before added keys', () => {
  const existing = 'APP_KEYS=a\r\nADMIN_JWT_SECRET=b\nAI_API_KEY=c';
  const { text } = mergeEnv(existing, EXAMPLE, fixedSecrets);
  assert.equal(text, 'APP_KEYS=a\r\nADMIN_JWT_SECRET=b\nAI_API_KEY=c\r\nPORT=1339\r\n');
});

test('mergeEnv reads `KEY: value` the way dotenv does, and `KEY:value` as no key', () => {
  const { added } = mergeEnv('PORT: 1\nAPP_KEYS:x\n', EXAMPLE, fixedSecrets);
  assert.ok(!added.includes('PORT'));
  assert.ok(added.includes('APP_KEYS'));
});

test('mergeEnv treats a lone carriage return as a line ending, and drops no text', () => {
  const { text, added } = mergeEnv('VITE_X=old\rA=1\r', 'VITE_X=old\rA=1\rB=2\r', fixedSecrets);
  assert.equal(text, 'VITE_X=old\rA=1\rB=2\r');
  assert.deepEqual(added, ['B']);
});

test('mergeEnv never reads a line inside a multi-line quoted value as a key', () => {
  const existing = 'APP_KEYS=a\nNOTE="first line\nPORT=1\nlast line"\n';
  const { text, added } = mergeEnv(existing, EXAMPLE, fixedSecrets);
  assert.ok(added.includes('PORT'));
  assert.ok(text.startsWith(existing));
  assert.match(text, /\nPORT=1339\n/);
});

test('mergeEnv reads a quoted value that closes on its own line as one value, with single quotes too', () => {
  const existing = "NOTE='first\nPORT=1\n'\nPORT=2\n";
  const { added } = mergeEnv(existing, EXAMPLE, fixedSecrets);
  assert.ok(!added.includes('PORT'));
});

test('mergeEnv reads a quote that never closes as a plain value, the way dotenv does', () => {
  const { added } = mergeEnv('NOTE="open\nPORT=1\n', EXAMPLE, fixedSecrets);
  assert.ok(!added.includes('PORT'));
});

test('mergeEnv does not close a quoted value at an escaped quote', () => {
  const { added } = mergeEnv('NOTE="say \\"hi\\"\nPORT=1\n"\n', EXAMPLE, fixedSecrets);
  assert.ok(added.includes('PORT'));
});

test('setEnvValues replaces only the named keys and keeps every other line and line ending', () => {
  const existing = '# note\r\nA=1\nB=2\r\n\nC=3';
  assert.equal(setEnvValues(existing, { B: 'new' }), '# note\r\nA=1\nB=new\r\n\nC=3');
});

test('setEnvValues adds a missing key at the end, with the file line ending', () => {
  assert.equal(setEnvValues('A=1\n', { B: '2' }), 'A=1\nB=2\n');
  assert.equal(setEnvValues('A=1\r\nB=2', { C: '3' }), 'A=1\r\nB=2\r\nC=3\r\n');
  assert.equal(setEnvValues('A=1\r', { C: '3' }), 'A=1\rC=3\r');
  assert.equal(setEnvValues('', { C: '3' }), 'C=3\n');
});

test('setEnvValues keeps `export `', () => {
  assert.equal(setEnvValues('export A=1\nB=2\n', { A: 'x' }), 'export A=x\nB=2\n');
});

test('setEnvValues fills the last line of a duplicated key, and the first one too', () => {
  const text = setEnvValues('A=first\nB=2\nA=last\n', { A: 'x' });
  assert.equal(text, 'A=x\nB=2\nA=x\n');
});

test('setEnvValues keeps a lone carriage return line ending, and drops no text', () => {
  assert.equal(setEnvValues('VITE_X=old\rA=1\r', { VITE_X: 'new' }), 'VITE_X=new\rA=1\r');
});

test('setEnvValues never reads a line inside a multi-line quoted value as a key', () => {
  const existing = 'VITE_X="multi\nVITE_Y=keep"\n';
  assert.equal(setEnvValues(existing, { VITE_Y: 'n' }), 'VITE_X="multi\nVITE_Y=keep"\nVITE_Y=n\n');
});

test('setEnvValues replaces a whole multi-line quoted value, and leaves no part of it behind', () => {
  assert.equal(setEnvValues('A=1\nVITE_X="multi\nVITE_Y=keep"\nB=2\n', { VITE_X: 'n' }), 'A=1\nVITE_X=n\nB=2\n');
});

test('GENERATED makes four app keys and a password Strapi accepts', () => {
  assert.equal(GENERATED.APP_KEYS().split(',').length, 4);
  const password = GENERATED.DEMO_ADMIN_PASSWORD();
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /\d/);
  assert.ok(password.length >= 8 && password.length <= 72);
});

test('initEnv run twice changes nothing the second time', () => {
  const root = project({ 'strapi/.env.example': EXAMPLE });
  initEnv({ root, apps: ['strapi'], log: () => {} });
  const first = readFileSync(join(root, 'strapi/.env'), 'utf8');
  const lines = [];
  initEnv({ root, apps: ['strapi'], log: (line) => lines.push(line) });
  assert.equal(readFileSync(join(root, 'strapi/.env'), 'utf8'), first);
  assert.deepEqual(lines, []);
});

test('initEnv writes each .env with mode 600, prints names only, and never a value', () => {
  const root = project({
    'strapi/.env.example': EXAMPLE,
    'app/.env.example': 'ANTHROPIC_API_KEY=\nSTRAPI_URL=http://127.0.0.1:1339\n',
    'app/.env': 'ANTHROPIC_API_KEY=secret-in-file\n',
  });
  const lines = [];
  initEnv({ root, apps: ['strapi', 'app'], secrets: fixedSecrets, log: (line) => lines.push(line) });

  for (const app of ['strapi', 'app']) {
    assert.equal(statSync(join(root, app, '.env')).mode & 0o777, 0o600);
  }
  assert.match(readFileSync(join(root, 'app/.env'), 'utf8'), /^ANTHROPIC_API_KEY=secret-in-file$/m);
  assert.match(readFileSync(join(root, 'app/.env'), 'utf8'), /^STRAPI_URL=http:\/\/127\.0\.0\.1:1339$/m);
  const printed = lines.join('\n');
  assert.doesNotMatch(printed, /secret-in-file|made-keys|made-secret|127\.0\.0\.1/);
  assert.match(printed, /strapi\/\.env/);
});

test('initEnv skips an app with no .env.example', () => {
  const root = project({ 'strapi/.env.example': EXAMPLE });
  initEnv({ root, apps: ['strapi', 'app'], secrets: fixedSecrets, log: () => {} });
  assert.throws(() => statSync(join(root, 'app/.env')));
});
