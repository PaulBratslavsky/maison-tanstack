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

const isPlaceholder = (value) => value === '' || /^["']?tobemodified/i.test(value);

// A line that sets a key, as dotenv reads it: an optional `export `, the key, then `=` or `:`.
const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]\s?(.*)$/;

function keysOf(text) {
  const keys = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(KEY_LINE);
    if (match && !line.trimStart().startsWith('#')) keys.set(match[1], match[2].trim());
  }
  return keys;
}

/**
 * Merges an example file into an existing .env text (or null when there is none).
 * Returns the new text and the names it added and filled. Never changes a set value.
 */
export function mergeEnv(existing, example, secrets = GENERATED) {
  const eol = existing?.includes('\r\n') ? '\r\n' : '\n';
  let lines = (existing ?? example).split(/\r?\n/);
  const present = keysOf(lines.join('\n'));
  const added = [];

  if (existing !== null) {
    // Drop the empty last element from a trailing newline, so the added keys follow the last line.
    if (lines.at(-1) === '') lines.pop();
    for (const [key, value] of keysOf(example)) {
      if (present.has(key)) continue;
      lines.push(`${key}=${value}`);
      present.set(key, value);
      added.push(key);
    }
    lines.push('');
  }

  const filled = [];
  for (const [key, make] of Object.entries(secrets)) {
    if (!present.has(key) || !isPlaceholder(present.get(key))) continue;
    const index = lines.findIndex((line) => line.match(KEY_LINE)?.[1] === key && !line.trimStart().startsWith('#'));
    const prefix = lines[index].trimStart().startsWith('export ') ? 'export ' : '';
    lines[index] = `${prefix}${key}=${make()}`;
    filled.push(key);
  }

  return { text: lines.join(eol), added, filled };
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
