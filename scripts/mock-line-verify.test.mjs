import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { lineUserIdOf } from './mock-line-verify.mjs';

const MOCK = fileURLToPath(new URL('./mock-line-verify.mjs', import.meta.url));
const USER = `U${'0123456789abcdef'.repeat(2)}`; // U and 32 lowercase hex digits, as LINE gives a user ID

test("accepts valid.<LINE user ID>, the LIFF mock's ID token, and answers with the user ID", () => {
  assert.equal(lineUserIdOf(`valid.${USER}`), USER);
  assert.equal(lineUserIdOf(`valid.U${'f'.repeat(32)}`), `U${'f'.repeat(32)}`);
});

test('refuses every other form', () => {
  for (const token of [
    null,
    '',
    'valid',
    'valid.',
    USER, // no "valid."
    `invalid.${USER}`,
    `Valid.${USER}`,
    `valid.${USER}.extra`, // exactly two parts
    `valid..${USER}`,
    `valid.u${USER.slice(1)}`, // a lower-case u
    `valid.${USER.toUpperCase()}`, // upper-case hex
    `valid.${USER.slice(0, -1)}`, // 31 digits
    `valid.${USER}0`, // 33 digits
    `valid.${USER.slice(0, -1)}g`, // not hex
    `valid. ${USER}`,
    `valid.${USER} `,
    `valid.${USER}\n`,
  ]) {
    assert.equal(lineUserIdOf(token), null, JSON.stringify(token));
  }
});

/** A port that something already listens on, on 127.0.0.1. */
const takenPort = async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: server.address().port, close: () => server.close() };
};

/** The mock as `npm run dev` starts it, on `port`: its output so far, and its exit. */
const startMock = (port) => {
  const child = spawn(process.execPath, [MOCK], { env: { ...process.env, MOCK_LINE_VERIFY_PORT: String(port), LINE_LOGIN_CHANNEL_ID: '1234567890' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { text: '' };
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => (output.text += chunk));
  return { child, output, exited: once(child, 'exit') };
};

test('exits 1, with what to check, when its port is taken, as by another verify mock', async () => {
  const taken = await takenPort();
  try {
    const { output, exited } = startMock(taken.port);
    const [code] = await exited;
    assert.equal(code, 1);
    assert.equal(output.text.trim(), `Port ${taken.port} is in use: is another verify mock running?`);
  } finally {
    taken.close();
  }
});

test('answers a verify request with the rule, on 127.0.0.1, and only for its channel', async () => {
  const free = await takenPort();
  free.close(); // a free port, for the mock to take
  const { child, output, exited } = startMock(free.port);
  try {
    for (let attempt = 0; attempt < 50 && !output.text.includes('Mock LINE verify endpoint on'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    const verify = (form) => fetch(`http://127.0.0.1:${free.port}/verify`, { method: 'POST', body: new URLSearchParams(form) });
    const accepted = await verify({ id_token: `valid.${USER}`, client_id: '1234567890' });
    assert.equal(accepted.status, 200);
    assert.deepEqual((({ sub, aud, iss }) => ({ sub, aud, iss }))(await accepted.json()), { sub: USER, aud: '1234567890', iss: 'https://access.line.me' });
    assert.equal((await verify({ id_token: `valid.${USER}.extra`, client_id: '1234567890' })).status, 400);
    assert.equal((await verify({ id_token: `valid.${USER}`, client_id: '1234567891' })).status, 400); // another channel
  } finally {
    child.kill();
    await exited;
  }
});
