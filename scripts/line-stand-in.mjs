// A stand-in for LINE's Messaging API on 127.0.0.1:4011, for local checks of the follow-up: nothing reaches LINE, so
// nothing reaches a phone. Strapi calls it when MAISON_LINE_API_BASE_URL points here (strapi/.env.example). The original
// project's stand-in uses 4010, so both can run on one laptop.
//   POST /v2/bot/message/push        answers 200 and logs the push (what Strapi sends for Let them know and Answer)
//   GET  /v2/bot/profile/<user ID>   answers a made-up display name (what Strapi asks for when a question comes in)
//   GET  /v2/bot/message/quota       answers the free plan's 200 messages a month (the Inquiries tab shows the month's quota)
//   GET  /v2/bot/message/quota/consumption   answers the pushes this stand-in has answered since it started, as the usage
// Every other route answers 404. Pushes and lookups are logged to strapi/.tmp/line-stand-in.jsonl, one JSON line each,
// without any header of the request: never Strapi's channel access token. From the repo root: npm run line:stand-in.
// Env: LINE_STAND_IN_PORT (4011).
import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOG_FILE = join(ROOT, 'strapi', '.tmp', 'line-stand-in.jsonl');
/** Where the stand-in listens unless LINE_STAND_IN_PORT says otherwise. */
export const DEFAULT_PORT = 4011;
/** What every customer is called: LINE's real answer is the customer's own name. */
export const DISPLAY_NAME = 'Demo customer (test)';

/** A log that adds one line of JSON to `file` for each entry, making its folder first. */
export const fileLog = (file) => (entry) => {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
};

/**
 * The stand-in, as a server that isn't listening yet. `log` gets an entry for each push, `{ at, kind: 'push', body }`,
 * and each profile lookup, `{ at, kind: 'profile', userId }`: what came in, and when, and none of its headers. The
 * quota lookups aren't logged: the Inquiries tab asks for them when it opens and after a reply, not on every refresh.
 */
export const createStandIn = ({ log }) => {
  /** The pushes answered since the stand-in started: LINE counts a push to one person once, however many messages it has. */
  let pushes = 0;
  return createServer((request, response) => {
    const answer = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const notFound = () => {
      request.resume(); // whatever body it has, unread
      answer(404, { message: 'Not found' });
    };
    const pathname = (request.url ?? '/').split('?')[0];

    const profile = /^\/v2\/bot\/profile\/([^/]+)$/.exec(pathname);
    if (request.method === 'GET' && profile) {
      let userId;
      try {
        userId = decodeURIComponent(profile[1]);
      } catch {
        return notFound(); // not valid percent-encoding
      }
      log({ at: new Date().toISOString(), kind: 'profile', userId });
      return answer(200, { userId, displayName: DISPLAY_NAME });
    }

    if (request.method === 'GET' && pathname === '/v2/bot/message/quota') return answer(200, { type: 'limited', value: 200 });
    if (request.method === 'GET' && pathname === '/v2/bot/message/quota/consumption') return answer(200, { totalUsage: pushes });

    if (request.method === 'POST' && pathname === '/v2/bot/message/push') {
      let raw = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => (raw += chunk));
      request.on('end', () => {
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return answer(400, { message: 'The request body is not JSON.' });
        }
        pushes += 1;
        log({ at: new Date().toISOString(), kind: 'push', body });
        answer(200, { sentMessages: [{ id: String(Date.now()), quoteToken: 'stand-in' }] });
      });
      return;
    }

    notFound();
  });
};

/** One line for the terminal: who a push is for, and what kinds of message; or whose profile was asked for. */
const describe = (entry) =>
  entry.kind === 'push'
    ? `push to ${entry.body?.to ?? '?'}: ${(Array.isArray(entry.body?.messages) ? entry.body.messages : []).map((message) => message?.type ?? '?').join(', ') || 'no messages'}`
    : `profile of ${entry.userId}`;

const start = () => {
  // `||`, not `??`: a key left empty counts as unset.
  const port = Number(process.env.LINE_STAND_IN_PORT || DEFAULT_PORT);
  const toFile = fileLog(LOG_FILE);
  const server = createStandIn({
    log: (entry) => {
      try {
        toFile(entry);
      } catch (error) {
        console.error(`[line-stand-in] The log couldn't be written: ${error.message}`); // the push is still answered
      }
      console.log(`[line-stand-in] ${describe(entry)}`);
    },
  });
  // One line, and exit 1, rather than a stack trace: most likely another stand-in is already running.
  // exitCode, not process.exit(): the message must reach a pipe before the process ends.
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use: is another LINE stand-in running?` : `The LINE stand-in couldn't start: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`LINE stand-in on http://127.0.0.1:${port}, logging to ${relative(process.cwd(), LOG_FILE) || LOG_FILE}`));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
