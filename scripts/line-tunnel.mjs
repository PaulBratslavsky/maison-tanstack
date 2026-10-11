// Opens LINE mode's one public https origin: ngrok from your domain (LINE_MODE_DOMAIN in app/.env) to the app on
// 127.0.0.1:3004. It refuses unless the demo is safely in LINE mode, because with the local verify mock behind the tunnel
// anyone on the internet could sign in as any customer. It checks that:
//   - strapi/.env has no LINE_VERIFY_URL, and both .env files are in LINE mode (npm run mode:line)
//   - nothing answers on the verify mock's port, 127.0.0.1:4546 (`npm run dev` starts the mock; LINE mode uses
//     `npm run start:line`, which doesn't)
//   - the app on :3004 is the LINE build that `npm run start:line` serves: its X-Maison-Liff header says line, which
//     neither a build for the LIFF mock nor a dev server says
//   - the running Strapi, reached through the app, refuses a forged ID token: LINE checks it (400 invalid_grant)
// Only the app is exposed: it proxies Strapi's /mcp, token endpoint and /uploads, and Strapi's admin stays here.
// ngrok runs with --inspect=false, so its local inspector (:4040) keeps no copy of customers' tokens.
// From the repo root: npm run tunnel, or `npm run tunnel -- --dry-run` for the checks alone. Prints no .env value.
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { lineInputs, modeDifferences, readEnv } from './line-mode.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The app listens on this machine only; ngrok connects to it here, so phones reach it only through the tunnel.
const APP = '127.0.0.1:3004';

/** Whether anything accepts a TCP connection on 127.0.0.1:port within a second. */
const answers = (port) =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });

/** Everything that stands in the way of a safe tunnel, in words, without values. An empty list means go. */
export const checkTunnel = async ({ root = ROOT, appUrl = `http://${APP}`, mockVerifyPort } = {}) => {
  const strapiEnv = readEnv(join(root, 'strapi', '.env'));
  const appEnv = readEnv(join(root, 'app', '.env'));
  const problems = [];
  if (strapiEnv.LINE_VERIFY_URL) {
    problems.push("strapi/.env sets LINE_VERIFY_URL, so Strapi would trust the local mock's ID tokens. Run npm run mode:line, then restart Strapi.");
  }
  const inputs = lineInputs(appEnv);
  if (inputs.problems.length > 0) problems.push(`Set your LINE values in app/.env: ${inputs.problems.join('; ')}.`);
  const differences = modeDifferences(root, 'line').filter((key) => !key.startsWith('LINE_VERIFY_URL'));
  if (inputs.problems.length === 0 && differences.length > 0) {
    problems.push(`Not in LINE mode: ${differences.join(', ')}. Run npm run mode:line, then restart Strapi and the app.`);
  }

  const port = Number(mockVerifyPort ?? (appEnv.MOCK_LINE_VERIFY_PORT || 4546));
  const mockRunning = await answers(port);
  if (mockRunning) {
    problems.push(`Something answers on 127.0.0.1:${port}, the LINE verify mock's port. Stop the app's dev server (npm run dev starts the mock); LINE mode runs npm run start:line.`);
  }

  // What app/src/lib/liff-header.ts says: line (the start:line build), line-dev (a dev server in LINE mode) or mock.
  let liff;
  try {
    liff = (await fetch(`${appUrl}/`, { signal: AbortSignal.timeout(10_000) })).headers.get('x-maison-liff') ?? 'none';
  } catch {
    problems.push(`The app isn't answering on ${appUrl}. Start it with npm run start:line.`);
  }
  if (liff === 'mock') {
    problems.push(`The app on ${appUrl} was built for the LIFF mock (X-Maison-Liff: mock). Stop it, and start it with npm run start:line.`);
  } else if (liff === 'line-dev') {
    problems.push(`The app on ${appUrl} is a development server (X-Maison-Liff: line-dev), not the LINE build. Stop it, and start it with npm run start:line.`);
  } else if (liff !== undefined && liff !== 'line') {
    problems.push(`The app on ${appUrl} isn't the LINE build (X-Maison-Liff: ${liff}). Stop it, and start it with npm run start:line.`);
  }

  // Last, and only once nothing else is wrong: a forged ID token, through the app, to the running Strapi.
  if (problems.length === 0) {
    let status = 0;
    let error = '';
    try {
      const response = await fetch(`${appUrl}/api/strapi-oauth-mcp-manager/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          client_id: appEnv.VITE_MAISON_CLIENT_ID ?? '',
          subject_token: `valid.U${'0'.repeat(32)}`, // what the verify mock accepts, and LINE refuses
          subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        }),
        signal: AbortSignal.timeout(20_000),
      });
      status = response.status;
      error = (await response.json().catch(() => ({}))).error ?? '';
    } catch {
      error = 'unreachable';
    }
    if (status >= 200 && status < 300) {
      problems.push('Strapi accepted a forged ID token: it still verifies against a mock. Restart Strapi after npm run mode:line, and stop anything on the mock\'s port.');
    } else if (status === 400 && error === 'invalid_grant') {
      // LINE refused it: the answer we want.
    } else if (status === 502) {
      // The app's proxy answers 502 when nothing answers on STRAPI_URL.
      problems.push("The app couldn't reach Strapi on STRAPI_URL (app/.env). Start Strapi, and run this again once it answers.");
    } else if (error === 'temporarily_unavailable') {
      problems.push("Strapi couldn't check an ID token with its verify endpoint. Restart Strapi after npm run mode:line (it may still point at the stopped mock), and check that this laptop is online.");
    } else if (error === 'invalid_client' || error === 'unauthorized_client') {
      problems.push("Strapi doesn't accept the app's OAuth client for LINE sign-in. Run npm run setup, then restart the app (npm run start:line).");
    } else {
      problems.push(`The token endpoint answered ${status || 'nothing'}${error ? ` (${error})` : ''} through the app. Check that Strapi is running on STRAPI_URL (app/.env).`);
    }
  }
  return problems;
};

const runNgrok = (args) =>
  new Promise((resolve) => {
    const child = spawn('ngrok', args, { stdio: 'inherit' });
    child.once('error', () => {
      console.error('ngrok isn\'t installed, or not on your PATH: https://ngrok.com/download, then `ngrok config add-authtoken`.');
      resolve(1);
    });
    child.once('exit', (code) => resolve(code ?? 0));
  });

export const main = async (args, { root = ROOT, appUrl, mockVerifyPort, log = console.log, startNgrok = runNgrok } = {}) => {
  const problems = await checkTunnel({ root, appUrl, mockVerifyPort });
  if (problems.length > 0) {
    log('No tunnel. Fix these first:');
    for (const problem of problems) log(`- ${problem}`);
    return 1;
  }
  log('Safe to open: LINE verifies ID tokens, the app is built for LINE, and the verify mock is off.');
  if (args.includes('--dry-run')) {
    log('Dry run: ngrok not started.');
    return 0;
  }
  const { domain } = lineInputs(readEnv(join(root, 'app', '.env')));
  log(`Starting ngrok on LINE_MODE_DOMAIN (app/.env) for the app on ${APP}. Ctrl-C stops it.`);
  return startNgrok(['http', APP, `--url=https://${domain}`, '--inspect=false']);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
