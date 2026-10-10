// Creates strapi/.env and app/.env from their .env.example files, or merges into the ones that exist.
// `npm install` runs it. Safe to run again:
// - it adds the keys a .env lacks, with the example's value;
// - it fills Strapi's secrets and the demo admin's password where they are empty or `tobemodified`;
// - it never changes or drops a value that is set;
// - it prints key names only, never a value, and leaves each file readable by you only.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const secret = () => randomBytes(16).toString('base64');

/** Strapi's keys and salts, made the way create-strapi makes them, and the demo admin's password. */
export const GENERATED = {
  APP_KEYS: () => [secret(), secret(), secret(), secret()].join(','),
  API_TOKEN_SALT: secret,
  ADMIN_JWT_SECRET: secret,
  TRANSFER_TOKEN_SALT: secret,
  JWT_SECRET: secret,
  ENCRYPTION_KEY: secret,
  // Strapi wants a lower-case letter, a capital and a digit.
  DEMO_ADMIN_PASSWORD: () => `Maison1-${randomBytes(18).toString('base64url')}`,
};

// Only an empty value or exactly `tobemodified` (quoted or not) is a placeholder.
const isPlaceholder = (value) => value === '' || /^(["']?)tobemodified\1$/i.test(value);

// A line that sets a key, as dotenv reads it: an optional `export `, the key, then `=` or `: `.
const KEY_LINE = /^\s*(export\s+)?([\w.-]+)(?:\s*=|:\s)\s*(.*)$/;

/** The quotes dotenv lets a value open, and the pattern that finds the quote closing it: a quote with a backslash before it does not close. */
const CLOSING = { '"': /^(?:\\"|[^"])*"/, "'": /^(?:\\'|[^'])*'/, '`': /^(?:\\`|[^`])*`/ };

/**
 * Splits text into lines that each keep their own line ending ('' for a last line without one). A line ending is \r\n, \n or a
 * lone \r. A value that opens a quote and closes it on a later line, as dotenv allows, is one setting: its first line says
 * `span` (how many lines follow it) and each of those lines says `inValue`, so none of them is read as a key.
 */
function linesOf(text) {
  const lines = [];
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (match[0] === '') break;
    lines.push({ text: match[1], eol: match[2], span: 0, inValue: false });
  }
  for (let index = 0; index < lines.length; index += 1) {
    const found = lines[index].text.trimStart().startsWith('#') ? null : lines[index].text.match(KEY_LINE);
    const quote = found?.[3][0];
    if (!quote || !CLOSING[quote]) continue;
    // The text from just after the opening quote to the end of the file, and the offset where each later line starts.
    let rest = found[3].slice(1) + lines[index].eol;
    const starts = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      starts.push(rest.length);
      rest += lines[next].text + lines[next].eol;
    }
    const closing = rest.match(CLOSING[quote]);
    if (!closing) continue;
    const end = closing[0].length - 1;
    while (lines[index].span < starts.length && starts[lines[index].span] <= end) lines[index].span += 1;
    for (let inner = 1; inner <= lines[index].span; inner += 1) lines[index + inner].inValue = true;
    index += lines[index].span;
  }
  return lines;
}

/** The line ending a file uses: \r\n if it has any, else \n, else a lone \r, else \n. */
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : text.includes('\n') || !text.includes('\r') ? '\n' : '\r');

/** The key a line sets, its value and its `export ` prefix, or null for a comment or other line. */
function setting(line) {
  if (line.inValue || line.text.trimStart().startsWith('#')) return null;
  const match = line.text.match(KEY_LINE);
  return match ? { exported: Boolean(match[1]), key: match[2], value: match[3].trim() } : null;
}

/** Each key's last line, the one dotenv reads. */
function lastLineOfEachKey(lines) {
  const keys = new Map();
  lines.forEach((line, index) => {
    const found = setting(line);
    if (found) keys.set(found.key, { ...found, index });
  });
  return keys;
}

/**
 * Merges an example file into an existing .env text (or null when there is none).
 * Returns the new text and the names it added and filled. Never changes a set value, and returns the
 * text unchanged when there is nothing to add or fill.
 */
export function mergeEnv(existing, example, secrets = GENERATED) {
  const lines = linesOf(existing ?? example);
  const present = lastLineOfEachKey(lines);
  const added = [];

  if (existing !== null) {
    const eol = eolOf(existing);
    for (const [key, { value }] of lastLineOfEachKey(linesOf(example))) {
      if (present.has(key)) continue;
      const last = lines.at(-1);
      if (last && last.eol === '') last.eol = eol;
      lines.push({ text: `${key}=${value}`, eol, span: 0, inValue: false });
      present.set(key, { exported: false, key, value, index: lines.length - 1 });
      added.push(key);
    }
  }

  const filled = [];
  for (const [key, make] of Object.entries(secrets)) {
    const found = present.get(key);
    if (!found || !isPlaceholder(found.value)) continue;
    lines[found.index].text = `${found.exported ? 'export ' : ''}${key}=${make()}`;
    filled.push(key);
  }

  return { text: lines.map((line) => line.text + line.eol).join(''), added, filled };
}

/**
 * Sets KEY=value for each key in an existing .env text (or '' for none). Every line that sets the key takes the value,
 * so whichever line a parser reads, it reads the new value. A missing key is added at the end. Every other line stays
 * as it is, with its own line ending, and the new lines use the file's ending.
 */
export function setEnvValues(existing, values) {
  const lines = linesOf(existing);
  const eol = eolOf(existing);
  for (const [key, value] of Object.entries(values)) {
    let found = false;
    for (let index = 0; index < lines.length; index += 1) {
      const current = setting(lines[index]);
      if (current?.key !== key) continue;
      lines[index].text = `${current.exported ? 'export ' : ''}${key}=${value}`;
      // The new value is one line, so the lines of the old multi-line value go too.
      lines.splice(index + 1, lines[index].span);
      lines[index].span = 0;
      found = true;
    }
    if (found) continue;
    const last = lines.at(-1);
    if (last && last.eol === '') last.eol = eol;
    lines.push({ text: `${key}=${value}`, eol, span: 0, inValue: false });
  }
  return lines.map((line) => line.text + line.eol).join('');
}

/** Creates or merges `<app>/.env` for each app that has a `.env.example`. */
export function initEnv({ root, apps = ['strapi', 'app'], secrets = GENERATED, log = console.log }) {
  for (const app of apps) {
    const example = join(root, app, '.env.example');
    const file = join(root, app, '.env');
    if (!existsSync(example)) continue;

    const existed = existsSync(file);
    const before = existed ? readFileSync(file, 'utf8') : null;
    const { text, added, filled } = mergeEnv(before, readFileSync(example, 'utf8'), secrets);
    if (text !== before) writeFileSync(file, text, { mode: 0o600 });
    chmodSync(file, 0o600);

    if (!existed) log(`Created ${app}/.env from ${app}/.env.example.`);
    if (added.length > 0) log(`Added ${added.join(', ')} to ${app}/.env.`);
    if (filled.length > 0) log(`Generated ${filled.join(', ')} in ${app}/.env.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initEnv({ root: join(dirname(fileURLToPath(import.meta.url)), '..') });
}
