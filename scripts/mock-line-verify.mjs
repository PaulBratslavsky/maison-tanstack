// A local stand-in for LINE's ID token verify endpoint (POST /verify), used on stage and in development.
// It accepts "valid.<LINE user ID>" for the configured channel, which is what the app's LIFF mock returns.
// Never point production at it. With --reuse, a port that is taken is not an error: the mock says so and stays idle, so
// the app's scripts can start it next to `vite` without a second `npm run dev` stopping the app. Env: MOCK_LINE_VERIFY_PORT (4546), LINE_LOGIN_CHANNEL_ID (1234567890).
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const LINE_USER_ID = /^U[0-9a-f]{32}$/;

/**
 * The mock's token rule: the LINE user ID in an ID token it accepts, or null. It accepts "valid." and a LINE user ID
 * (U and 32 lowercase hex digits), in exactly two parts: "valid.U…" passes, "valid.U….extra" doesn't.
 */
export const lineUserIdOf = (idToken) => {
  const parts = (idToken ?? '').split('.');
  const [kind, sub] = parts;
  return parts.length === 2 && kind === 'valid' && LINE_USER_ID.test(sub) ? sub : null;
};

const start = () => {
  // `||`, not `??`: a key left empty in .env counts as unset.
  const port = Number(process.env.MOCK_LINE_VERIFY_PORT || 4546);
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID || '1234567890';

  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/verify') return send(404, { error: 'not_found' });
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const form = new URLSearchParams(raw);
      if (form.get('client_id') !== channelId) {
        return send(400, { error: 'invalid_request', error_description: 'Invalid IdToken Audience.' });
      }
      const sub = lineUserIdOf(form.get('id_token'));
      if (sub === null) {
        return send(400, { error: 'invalid_request', error_description: 'Invalid IdToken.' });
      }
      const now = Math.floor(Date.now() / 1000);
      return send(200, { iss: 'https://access.line.me', sub, aud: channelId, exp: now + 3600, iat: now, amr: ['linesso'], name: 'Demo customer' });
    });
  });

  // One line, and exit 1, rather than a stack trace: most likely `npm run dev` is already running, with its own mock.
  // exitCode, not process.exit(): the message must reach a pipe (concurrently's) before the process ends.
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && process.argv.includes('--reuse')) {
      console.log(`A verify mock already answers on port ${port}. Using it.`);
      // Idle, not exited: `concurrently -k` stops the app when any of its processes ends.
      setInterval(() => {}, 2 ** 30);
      return;
    }
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use: is another verify mock running?` : `The verify mock couldn't start: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(`Mock LINE verify endpoint on http://127.0.0.1:${port}/verify: accepts valid.<LINE user ID> for channel ${channelId}`)
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
