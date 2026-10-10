/**
 * Fails if a built server bundle loads @tanstack/ai or one of its adapters statically.
 *
 * Maison's server is CommonJS, and these packages ship ESM only. A static require, or an import that the bundler keeps,
 * would make Strapi fail at boot with ERR_PACKAGE_PATH_NOT_EXPORTED, or load an ESM graph that nothing uses until the first
 * labelling sweep or staff chat. The only allowed way to load them is `await import()`, in server/src/ai/sdk.ts. That is a
 * property of the built bundle, not of the source, so this checks the bundle. It runs after `npm run build` (the `postbuild` script):
 *
 *   node scripts/check-esm-import.mjs            checks dist/server/index.js and dist/server/index.mjs
 *   node scripts/check-esm-import.mjs <folder>   checks <folder>/index.js and <folder>/index.mjs (the unit test uses this)
 *
 * It exits 1 when a bundle is missing or loads any of the AI packages statically, and 0 otherwise, saying how many dynamic import
 * sites it found.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const folder = process.argv[2] ?? path.join('dist', 'server');
const BUNDLES = ['index.js', 'index.mjs'].map((name) => path.join(folder, name));

let failed = false;

for (const file of BUNDLES) {
  if (!existsSync(file)) {
    console.error(`  x ${file} is missing: run npm run build first`);
    failed = true;
    continue;
  }

  const source = readFileSync(file, 'utf8');

  // A package specifier of ours, in any quote.
  const pkg = '["\'`](@tanstack\\/ai[^"\'`]*)["\'`]';
  // Not anchored to the start of a line: a minifier puts many statements on one line, and writes `import{a}from"pkg"` with no spaces.
  const statics = [
    // CommonJS.
    ...source.matchAll(new RegExp(`\\brequire\\s*\\(\\s*${pkg}\\s*\\)`, 'g')),
    // An import with bindings, over any number of lines. `import(` is a dynamic import and `import.meta` is not an import.
    ...source.matchAll(new RegExp(`\\bimport\\b(?!\\s*[(.])[^;"'\`()]*?\\bfrom\\s*${pkg}`, 'g')),
    // A bare import. When the bundler drops an unused binding it keeps `import "pkg";`, which still loads the module.
    ...source.matchAll(new RegExp(`\\bimport\\s*${pkg}`, 'g')),
    // A re-export, `export * from`, `export * as x from` or `export { a } from`: it loads the module as an import does.
    ...source.matchAll(new RegExp(`\\bexport\\b[^;"'\`()]*?\\bfrom\\s*${pkg}`, 'g')),
  ].map((match) => match[1]);

  if (statics.length > 0) {
    console.error(`  x ${file} loads the SDK statically: ${[...new Set(statics)].join(', ')}`);
    failed = true;
    continue;
  }

  const dynamic = [...source.matchAll(new RegExp(`\\bimport\\s*\\(\\s*${pkg}\\s*\\)`, 'g'))];
  console.log(`  ok ${file}: no static load of @tanstack/ai (${dynamic.length} dynamic import site${dynamic.length === 1 ? '' : 's'})`);
}

process.exit(failed ? 1 : 0);
