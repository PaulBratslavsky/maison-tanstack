import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, test } from 'node:test';

import { main } from './line-qr.mjs';

const LIFF_ID = '1234567890-AbcdEfgh'; // made up: never a real LIFF ID in this repo

const folders = [];
after(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));
const tempFolder = (prefix) => {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  folders.push(folder);
  return folder;
};

/** A checkout whose app/.env holds `env`, and an output folder elsewhere, which doesn't exist yet. */
const demo = (env) => {
  const root = tempFolder('maison-qr-');
  mkdirSync(join(root, 'app'));
  writeFileSync(join(root, 'app', '.env'), env, { mode: 0o600 });
  return { root, outDir: join(tempFolder('maison-qr-out-'), 'qr') };
};
const run = async (args, { root, outDir }) => {
  const lines = [];
  const code = await main(args, { root, outDir, log: (line) => lines.push(line) });
  return { code, lines, out: lines.join('\n') };
};
/** Every file under `folder`, relative to it, or [] when it doesn't exist. */
const filesIn = (folder) =>
  existsSync(folder)
    ? readdirSync(folder, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(folder, join(entry.parentPath, entry.name)))
        .sort()
    : [];

test("prints a page's LINE link and a QR code, and saves the code as a 1024 px PNG and an SVG, in outDir only", async () => {
  const demoDir = demo(`VITE_LIFF_MOCK=true\nLINE_MODE_LIFF_ID=${LIFF_ID}\n`); // no channel ID or domain: not needed
  const { code, lines, out } = await run(['/visits'], demoDir);
  assert.equal(code, 0, out);
  assert.equal(lines[0], `https://liff.line.me/${LIFF_ID}/visits`);
  assert.ok(lines[1].split('\n').length > 10, 'a QR code for the terminal');
  assert.deepEqual(filesIn(demoDir.outDir), ['maison-line-qr.png', 'maison-line-qr.svg']);
  assert.deepEqual(filesIn(demoDir.root), ['app/.env'], 'nothing written outside outDir');

  const png = readFileSync(join(demoDir.outDir, 'maison-line-qr.png'));
  assert.ok(png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'a PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1024, 1024], 'width and height (IHDR)');
  const svg = readFileSync(join(demoDir.outDir, 'maison-line-qr.svg'), 'utf8');
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
  assert.match(svg.trim(), /<\/svg>$/);
  assert.match(svg, /<path fill="#ffffff" d="M0 0h/); // white under the whole code
  assert.match(svg, /<path stroke="#000000" d="M4 4/); // black modules, from a four-module margin in
});

test('without a path, links to the start page', async () => {
  const { code, lines } = await run([], demo(`LINE_MODE_LIFF_ID=${LIFF_ID}\n`));
  assert.equal(code, 0);
  assert.equal(lines[0], `https://liff.line.me/${LIFF_ID}`);
});

test('refuses without a LIFF ID, or with something else, names the key, and writes nothing', async () => {
  for (const env of ['VITE_LIFF_MOCK=true\n', 'LINE_MODE_LIFF_ID=\n', 'LINE_MODE_LIFF_ID=not-a-liff-id\n', 'LINE_MODE_LIFF_ID=1234567890\n']) {
    const demoDir = demo(env);
    const { code, out } = await run(['/visits'], demoDir);
    assert.equal(code, 1, env);
    assert.match(out, /LINE_MODE_LIFF_ID: your LIFF app's LIFF ID/, env);
    assert.doesNotMatch(out, /LINE_MODE_(CHANNEL_ID|DOMAIN)/, 'only the LIFF ID is needed');
    assert.deepEqual(filesIn(demoDir.outDir), [], env);
  }
});

test('refuses a path with ?, #, :// or a space, and writes nothing', async () => {
  for (const path of ['/visits?code=abc', '/visits#top', 'https://maison.example/visits', '/my visits', '/visits\t']) {
    const demoDir = demo(`LINE_MODE_LIFF_ID=${LIFF_ID}\n`);
    const { code, out } = await run([path], demoDir);
    assert.equal(code, 1, path);
    assert.doesNotMatch(out, /liff\.line\.me/, path);
    assert.deepEqual(filesIn(demoDir.outDir), [], path);
  }
});

test('refuses a second argument, an option, a .. segment and a backslash, each with its reason, and writes nothing', async () => {
  for (const [args, reason] of [
    [['/visits', '/products/weekender-50'], /one page path at most/],
    [['--help'], /takes no options/],
    // A .. would climb out of the app's LIFF link: https://liff.line.me/<LIFF ID>/.. is liff.line.me itself.
    [['/visits/../..'], /without \.\. segments/],
    [['/visits/%2E%2e/admin'], /without \.\. segments/], // as a URL reads it too
    [['/visits\\..\\..'], /without backslashes/], // a URL parser reads \ as / for https: /visits/../.., so liff.line.me itself
  ]) {
    const demoDir = demo(`LINE_MODE_LIFF_ID=${LIFF_ID}\n`);
    const { code, out } = await run(args, demoDir);
    const label = JSON.stringify(args);
    assert.equal(code, 1, label);
    assert.match(out, reason, label);
    assert.match(out, /^No QR code/, label);
    assert.doesNotMatch(out, /liff\.line\.me/, label);
    assert.deepEqual(filesIn(demoDir.outDir), [], label);
  }
});
