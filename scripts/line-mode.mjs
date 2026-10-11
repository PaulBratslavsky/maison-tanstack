// Switches how the demo signs customers in, by rewriting a few keys in strapi/.env and app/.env:
//   local  the LIFF mock in the app, and the local stand-in for LINE's verify endpoint (the default, and the stage)
//   line   your own LIFF app inside LINE, with LINE verifying ID tokens, on one public https origin (your ngrok domain)
// LINE mode takes your values from app/.env: LINE_MODE_LIFF_ID, LINE_MODE_CHANNEL_ID and LINE_MODE_DOMAIN.
// From the repo root: npm run mode (shows the mode), npm run mode:line, npm run mode:local.
// Restart Strapi and the app after a switch. Never prints a value from either file.
// `require-line` and `require-local` check before a start: npm run start:line needs LINE mode, and npm run dev refuses it.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

import { setEnvValues } from './init-env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MOCK_CHANNEL_ID = '1234567890';

// Whitespace on one line, as dotenv's \s reads it: spaces and tabs, and NBSP, a BOM and the other spaces JavaScript knows.
const BLANK = String.raw`[^\S\r\n]`;
// The start of an assignment in every form dotenv reads, whitespace and all: `KEY=`, `export KEY=` (with a space, a tab
// or an NBSP), `KEY: value`. Node's parser reads only some of them: `export\tKEY=`, ` KEY=` and even `export KEY=`
// with an empty value come out as other keys, and `KEY: value` not at all. Each becomes KEY=.
const ASSIGNMENT = new RegExp(String.raw`^${BLANK}*(?:export${BLANK}+)?([\w.-]+)(?:${BLANK}*=${BLANK}*|:${BLANK}+)`, 'gm');
// An unquoted value's whitespace before its comment or the end of its line, which dotenv trims and Node's parser keeps
// when it isn't ASCII (an NBSP). Inside a value, and inside quotes, an NBSP stays, as dotenv keeps it.
const UNQUOTED_END = new RegExp(String.raw`^([\w.-]+=(?!["'\x60])[^#\n]*?)${BLANK}+(?=#|$)`, 'gm');

/**
 * An env file's values ({} when it's missing), read the way Strapi's dotenv (16) reads strapi/.env, and Vite's app/.env:
 * Node's own parser (quotes and comments, and a later assignment wins), after the text is made the same for both. Lines
 * end at CRLF, LF or CR alone; every assignment's start is KEY= (see ASSIGNMENT); an unquoted value loses its trailing
 * whitespace. Read any other way, a line Strapi honours could slip past the tunnel's check of LINE_VERIFY_URL.
 */
export const readEnv = (file) =>
  existsSync(file)
    ? parseEnv(readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').replace(ASSIGNMENT, '$1=').replace(UNQUOTED_END, '$1'))
    : {};

/**
 * Sets each key, and leaves the file readable by you only. init-env's setEnvValues does the editing: every line that
 * assigns the key, in any form readEnv reads, becomes KEY=value where it stands (keeping an `export`, with a space), so no
 * other line can override it, and every parser reads it; a missing key is added at the end. The file keeps its line
 * endings: LF, CRLF or CR alone.
 */
export const writeEnv = (file, values) => {
  const exists = existsSync(file);
  const text = setEnvValues(exists ? readFileSync(file, 'utf8') : '', values);
  // `mode` applies only when the file is created, so tighten an existing one before writing into it.
  if (exists) chmodSync(file, 0o600);
  writeFileSync(file, text, { mode: 0o600 });
};

/** LINE mode's values from app/.env, and what's wrong with them (key names only). */
export const lineInputs = (appEnv) => {
  const liffId = appEnv.LINE_MODE_LIFF_ID ?? '';
  const channelId = appEnv.LINE_MODE_CHANNEL_ID ?? '';
  const domain = appEnv.LINE_MODE_DOMAIN ?? '';
  const problems = [];
  if (!/^\d+-[A-Za-z0-9]+$/.test(liffId)) {
    problems.push("LINE_MODE_LIFF_ID: your LIFF app's LIFF ID, like 1234567890-AbcdEfgh (the LIFF tab of your LINE Login channel)");
  }
  if (!/^\d+$/.test(channelId) || channelId === MOCK_CHANNEL_ID) {
    problems.push("LINE_MODE_CHANNEL_ID: your LINE Login channel's ID, digits only (its Basic settings tab)");
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
    problems.push('LINE_MODE_DOMAIN: your ngrok domain, without https:// or a slash, like your-name.ngrok-free.dev');
  }
  const warnings =
    problems.length === 0 && !liffId.startsWith(`${channelId}-`)
      ? ["LINE_MODE_LIFF_ID doesn't start with LINE_MODE_CHANNEL_ID and a dash. A LIFF ID starts with its channel's ID: check that both come from the same channel."]
      : [];
  return { liffId, channelId, domain, problems, warnings };
};

/** What each mode sets in strapi/.env and app/.env. */
const modeValues = (mode, strapiEnv, appEnv) => {
  const port = strapiEnv.PORT || 1339;
  // The app's server reaches Strapi on this machine in both modes (the proxy and the concierge), where Strapi listens on
  // 127.0.0.1 only: never through the tunnel.
  const serverStrapiUrl = `http://127.0.0.1:${port}`;
  if (mode === 'local') {
    return {
      strapi: {
        LINE_LOGIN_CHANNEL_ID: MOCK_CHANNEL_ID,
        LINE_VERIFY_URL: `http://127.0.0.1:${appEnv.MOCK_LINE_VERIFY_PORT || 4546}/verify`,
        MAISON_LIFF_URL: 'http://localhost:3004',
        PUBLIC_URL: '',
      },
      app: { VITE_LIFF_MOCK: 'true', VITE_LIFF_ID: '', VITE_STRAPI_URL: `http://localhost:${port}`, STRAPI_URL: serverStrapiUrl },
    };
  }
  const { liffId, channelId, domain } = lineInputs(appEnv);
  return {
    // Strapi verifies ID tokens with LINE for your channel, and builds its public URLs (media, OAuth metadata) on the
    // app's origin, which proxies /mcp, the token endpoint and /uploads to it.
    strapi: { LINE_LOGIN_CHANNEL_ID: channelId, LINE_VERIFY_URL: '', MAISON_LIFF_URL: `https://liff.line.me/${liffId}`, PUBLIC_URL: `https://${domain}` },
    // The browser calls Strapi's paths on the app's own origin; the app's server reaches Strapi directly.
    app: { VITE_LIFF_MOCK: 'false', VITE_LIFF_ID: liffId, VITE_STRAPI_URL: `https://${domain}`, STRAPI_URL: serverStrapiUrl },
  };
};

/** The keys, as "KEY (file)", that aren't what `mode` sets. */
export const modeDifferences = (root, mode) => {
  const strapiEnv = readEnv(join(root, 'strapi', '.env'));
  const appEnv = readEnv(join(root, 'app', '.env'));
  const values = modeValues(mode, strapiEnv, appEnv);
  return [
    ...Object.entries(values.strapi).filter(([key, value]) => (strapiEnv[key] ?? '') !== value).map(([key]) => `${key} (strapi/.env)`),
    ...Object.entries(values.app).filter(([key, value]) => (appEnv[key] ?? '') !== value).map(([key]) => `${key} (app/.env)`),
  ];
};

/** 'line' when every key is LINE mode's; 'local' while Strapi trusts the verify mock and the app uses the LIFF mock. */
export const currentMode = (root) => {
  const strapiEnv = readEnv(join(root, 'strapi', '.env'));
  const appEnv = readEnv(join(root, 'app', '.env'));
  if (lineInputs(appEnv).problems.length === 0 && modeDifferences(root, 'line').length === 0) return 'line';
  if (strapiEnv.LINE_VERIFY_URL && appEnv.VITE_LIFF_MOCK !== 'false') return 'local';
  return 'mixed';
};

export const main = (args, { root = ROOT, log = console.log } = {}) => {
  const [command = 'status'] = args;
  const appEnv = readEnv(join(root, 'app', '.env'));
  const strapiEnv = readEnv(join(root, 'strapi', '.env'));
  const mode = currentMode(root);

  if (command === 'status' || command === 'require-line' || command === 'require-local') {
    const label = { line: 'LINE (your LIFF app; LINE verifies ID tokens)', local: 'local (the LIFF mock and the verify mock)', mixed: 'mixed' }[mode];
    log(`Mode: ${label}.`);
    if (mode === 'mixed') log(`Not in LINE mode: ${modeDifferences(root, 'line').join(', ')}. Run npm run mode:line or npm run mode:local.`);
    if (command === 'require-line' && mode !== 'line') {
      log('This needs LINE mode: run npm run mode:line first.');
      return 1;
    }
    // npm run dev is the stage's: vite dev on the LIFF mock, beside the verify mock. The app set for LINE
    // (VITE_LIFF_MOCK=false, in LINE mode and in a mix with it) is npm run start:line's.
    if (command === 'require-local' && appEnv.VITE_LIFF_MOCK === 'false') {
      log('The app is in LINE mode. For the stage, run npm run mode:local, then restart Strapi.');
      return 1;
    }
    return 0;
  }
  if (command === 'line') {
    const { problems, warnings } = lineInputs(appEnv);
    if (problems.length > 0) {
      log('Not switched. Set these in app/.env first:');
      for (const problem of problems) log(`- ${problem}`);
      return 1;
    }
    for (const warning of warnings) log(`Warning: ${warning}`);
  }
  if (command !== 'line' && command !== 'local') {
    log('Usage: node scripts/line-mode.mjs status | line | local | require-line | require-local');
    return 1;
  }
  const values = modeValues(command, strapiEnv, appEnv);
  writeEnv(join(root, 'strapi', '.env'), values.strapi);
  writeEnv(join(root, 'app', '.env'), values.app);
  if (command === 'line') {
    log('LINE mode: strapi/.env and app/.env now use LINE_MODE_LIFF_ID, LINE_MODE_CHANNEL_ID and LINE_MODE_DOMAIN (app/.env).');
    log('Next: restart Strapi, start the app with `npm run start:line` (not `npm run dev`), then `npm run tunnel`.');
  } else {
    log('Local mode: strapi/.env and app/.env use the LIFF mock and the local LINE verify mock again.');
    log('Stop ngrok first (Ctrl-C in its terminal).');
    log('Next: stop the LINE-mode app, then restart Strapi and start the app with `npm run dev`.');
  }
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
