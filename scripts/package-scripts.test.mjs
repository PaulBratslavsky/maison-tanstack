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
