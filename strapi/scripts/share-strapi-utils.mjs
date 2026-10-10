// Makes the plugins share Strapi core's copy of @strapi/utils. Runs after the Maison plugin's own
// `npm install` and build (the postinstall in strapi/package.json). `--check` only checks.
//
// Why: Strapi's error middleware answers 400, 403 or 404 only for errors made with core's own
// @strapi/utils (an `instanceof` check), and anything else is a 500. The Maison plugin has its own
// node_modules, so its build would load a second copy first, and a Content Manager save that Maison
// rejects would show staff "Internal Server Error" instead of the reason. Removing that copy makes
// the plugin resolve the app's, which package.json's overrides keep at core's version.
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const maison = join(app, 'src', 'plugins', 'maison');
const ownCopy = join(maison, 'node_modules', '@strapi', 'utils');

if (!process.argv.includes('--check') && existsSync(ownCopy)) {
  rmSync(ownCopy, { recursive: true, force: true });
  console.log("Removed the Maison plugin's own @strapi/utils, so it shares the app's.");
}

const fromApp = createRequire(join(app, 'package.json'));
const utilsFrom = (packageJson) => createRequire(packageJson).resolve('@strapi/utils');
const core = utilsFrom(fromApp.resolve('@strapi/core/package.json'));
const plugins = { maison: utilsFrom(join(maison, 'package.json')) };
// The OAuth plugin is added to this app by a later task. Once it is installed, it is checked too.
try {
  plugins['strapi-oauth-mcp-manager'] = utilsFrom(fromApp.resolve('strapi-oauth-mcp-manager/package.json'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
const apart = Object.entries(plugins).filter(([, file]) => file !== core);
if (apart.length > 0) {
  for (const [name, file] of apart) console.error(`${name} loads ${relative(app, file)}, not core's ${relative(app, core)}.`);
  console.error('Their errors would reach clients as 500s. Run `npm install` in strapi/, and check the overrides in strapi/package.json.');
  process.exit(1);
}
console.log(`Strapi core's @strapi/utils is shared by: ${Object.keys(plugins).join(', ')}.`);
