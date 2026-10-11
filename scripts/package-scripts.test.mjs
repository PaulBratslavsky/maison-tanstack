import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const scripts = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')).scripts;
const CHECK = 'node scripts/share-strapi-utils.mjs --check';

test('every way to start Strapi first checks that the plugins share its @strapi/utils', () => {
  const strapi = scripts('strapi/package.json');
  for (const name of ['predevelop', 'predev', 'prestart']) assert.equal(strapi[name], CHECK, name);
});

test('the integration suites build the plugin, then check the shared @strapi/utils', () => {
  const { 'pretest:integration': pre } = scripts('strapi/src/plugins/maison/package.json');
  const steps = pre.split('&&').map((step) => step.trim());
  assert.equal(steps[0], 'npm run build');
  assert.equal(steps[1], 'node ../../../scripts/share-strapi-utils.mjs --check');
  assert.equal(steps.length, 2);
});

test('the root runs the LINE stand-in with line:stand-in, and the plugin has a test:live script for the labelling live test', () => {
  assert.equal(scripts('package.json')['line:stand-in'], 'node scripts/line-stand-in.mjs');
  assert.equal(scripts('strapi/src/plugins/maison/package.json')['test:live'], 'vitest run --config vitest.live.config.ts');
});

test('the plugin checks its built bundles for a static load of the TanStack AI packages after every build', () => {
  const { postbuild } = scripts('strapi/src/plugins/maison/package.json');
  assert.equal(postbuild, 'node scripts/check-esm-import.mjs');
});

test('the root has the LINE mode scripts: mode, mode:line, mode:local, start:line, tunnel and qr', () => {
  const root = scripts('package.json');
  assert.equal(root.mode, 'node scripts/line-mode.mjs status');
  assert.equal(root['mode:line'], 'node scripts/line-mode.mjs line');
  assert.equal(root['mode:local'], 'node scripts/line-mode.mjs local');
  assert.equal(root['start:line'], 'npm run start:line --prefix app');
  assert.equal(root.tunnel, 'node scripts/line-tunnel.mjs');
  assert.equal(root.qr, 'node app/scripts/line-qr.mjs');
});

test('npm run dev and npm run dev:app refuse to start in LINE mode, and npm run dev:strapi does not check', () => {
  const root = scripts('package.json');
  for (const name of ['dev', 'dev:app']) assert.match(root[name], /^node scripts\/line-mode\.mjs require-local && /, name);
  assert.equal(root['dev:strapi'], 'npm run develop --prefix strapi');
});

test('npm run dev inside app/ also refuses to start in LINE mode', () => {
  assert.equal(scripts('app/package.json').predev, 'node ../scripts/line-mode.mjs require-local');
});

test('npm run start:line needs LINE mode, builds the app in it, and serves the build on 127.0.0.1:3004 without the verify mock', () => {
  const steps = scripts('app/package.json')['start:line'].split('&&').map((step) => step.trim());
  assert.deepEqual(steps, ['node ../scripts/line-mode.mjs require-line', 'vite build', 'vite preview --host 127.0.0.1 --port 3004 --strictPort']);
  assert.ok(!scripts('app/package.json')['start:line'].includes('mock-line-verify'));
});

test('the root test script runs every node test, in scripts/ and app/scripts/', () => {
  assert.match(scripts('package.json').test, /node --test scripts\/\*\.test\.mjs app\/scripts\/\*\.test\.mjs$/);
});
