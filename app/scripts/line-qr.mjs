// Prints the link that opens Maison inside LINE, https://liff.line.me/<your LIFF ID>, with a QR code for LINE's QR
// reader, and saves the code as app/line/qr/maison-line-qr.png (1024 px) and maison-line-qr.svg. Give a page's path to
// open that page instead of the start: npm run qr -- /visits. The LIFF ID is LINE_MODE_LIFF_ID in app/.env.
// The link and both files hold your LIFF ID: app/line/qr/ is gitignored, so keep them out of commits.
// From the repo root: npm run qr. It sits in app/ so that `qrcode` comes from app/node_modules.
import { mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import QRCode from 'qrcode';

import { lineInputs, readEnv } from '../../scripts/line-mode.mjs';
import { lineAppUrl } from '../src/lib/line-app-url.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAME = 'maison-line-qr';
const BLACK_ON_WHITE = { dark: '#000000', light: '#ffffff' };

/** A page's path, as the app's own links give it: nothing a link to a page doesn't need, such as a query or a scheme. */
const isPagePath = (path) => !/[?#\s]|:\/\//.test(path);

/**
 * Whether a path has a `..` segment, also as a URL reads one (`%2e%2e`). It would climb out of the app's LIFF link:
 * https://liff.line.me/<LIFF ID>/.. is liff.line.me itself, and /../<another ID> another app.
 */
const climbs = (path) => path.split('/').some((segment) => /^(?:\.|%2e){2}$/i.test(segment));

export const main = async (args, { root = ROOT, outDir = join(root, 'app', 'line', 'qr'), log = console.log } = {}) => {
  const [path = '/'] = args;
  if (args.length > 1) {
    log('No QR code: give one page path at most, like /visits, or none for the start page.');
    return 1;
  }
  if (path.startsWith('-')) {
    log('No QR code: npm run qr takes no options. Give a page path, like /visits, or none for the start page.');
    return 1;
  }
  if (!isPagePath(path)) {
    log('No QR code: give a page path, like /visits or /products/weekender-50, without ?, #, :// or spaces.');
    return 1;
  }
  // A URL parser reads \ as / for https, so /visits\..\.. is /visits/../.. to it: liff.line.me itself, which climbs() can't see.
  if (path.includes('\\')) {
    log('No QR code: give a page path without backslashes, like /visits.');
    return 1;
  }
  if (climbs(path)) {
    log('No QR code: give a page path without .. segments, like /visits.');
    return 1;
  }
  // The same rule as npm run mode:line. The code needs the LIFF ID only, not the channel ID or the domain.
  const { liffId, problems } = lineInputs(readEnv(join(root, 'app', '.env')));
  const problem = problems.find((text) => text.startsWith('LINE_MODE_LIFF_ID'));
  if (problem) {
    log('No QR code. Set this in app/.env first:');
    log(`- ${problem}`);
    return 1;
  }
  const url = lineAppUrl(liffId, path);
  log(url);
  log(await QRCode.toString(url, { type: 'terminal', small: true }));
  mkdirSync(outDir, { recursive: true });
  await QRCode.toFile(join(outDir, `${NAME}.png`), url, { type: 'png', width: 1024, margin: 4, color: BLACK_ON_WHITE });
  await QRCode.toFile(join(outDir, `${NAME}.svg`), url, { type: 'svg', margin: 4, color: BLACK_ON_WHITE });
  const where = relative(root, outDir);
  log(`Saved ${NAME}.png (1024 px) and ${NAME}.svg in ${where.startsWith('..') ? outDir : where}. They hold your LIFF ID: keep them out of git.`);
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
