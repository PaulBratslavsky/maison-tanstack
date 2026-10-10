import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GENERATED, initEnv, mergeEnv } from './init-env.mjs';

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
