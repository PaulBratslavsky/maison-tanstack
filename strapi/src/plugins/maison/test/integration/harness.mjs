import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUBJECT_A = `line:U${'a'.repeat(32)}`;
export const SUBJECT_B = `line:U${'b'.repeat(32)}`;

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * The calendar date in Tokyo `days` days from now, as YYYY-MM-DD. Tests that run against the real clock book their
 * visits relative to it, so they never expire. With `weekday` (0 is Sunday, 2 Tuesday), the first such day on or
 * after that date.
 */
export const tokyoDate = (days, { weekday } = {}) => {
  // Shifted by Tokyo's offset, the UTC fields read as Tokyo's calendar (Japan has no daylight saving time).
  const day = new Date(Date.now() + TOKYO_OFFSET_MS + days * DAY_MS);
  if (weekday !== undefined) day.setUTCDate(day.getUTCDate() + ((weekday - day.getUTCDay() + 7) % 7));
  return day.toISOString().slice(0, 10);
};

/** `date` at `time` (HH:MM) in Tokyo, the way the app sends a visit and the services answer it. */
export const tokyoTime = (date, time) => `${date}T${time}:00+09:00`;

/** A moment the way the services write one: Tokyo wall-clock time and offset, in whole seconds ("2026-10-10T14:00:00+09:00"). */
export const tokyoIso = (moment) => `${new Date(moment.getTime() + TOKYO_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;

/** The Strapi app that holds this plugin: strapi/, three folders above the plugin (strapi/src/plugins/maison). */
export const defaultAppDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

/** STRAPI_APP_DIR, when a suite is to run against another app, else the app that holds the plugin. */
const appDirectory = () => process.env.STRAPI_APP_DIR || defaultAppDir;

/** Loads a package the way the Strapi app resolves it, e.g. the app's own copy of @strapi/utils. */
export const requireFromApp = (id) => createRequire(path.join(appDirectory(), 'package.json'))(id);

/** The AI settings an app's .env can hold, which the plugin's `aiProvider`, `aiModel`, `aiApiKey` and `aiBaseUrl` take. */
const AI_VARIABLES = ['AI_PROVIDER', 'AI_MODEL', 'AI_API_KEY', 'AI_BASE_URL'];

/**
 * Boots the Strapi app (it loads this plugin from src/plugins/maison, so run `npm run build` in the plugin first) against .tmp/maison-test-<name>.db, then sets `maisonConfig` on
 * the plugin's config.
 *
 * No test reaches LINE or a model. The app's .env can't hand Strapi a channel access token or an AI setting, a real key
 * among them: dotenv never overrides a variable that's already set, even to ''. And once Strapi has loaded, the token,
 * the AI key and the AI base URL are null unless `maisonConfig` gives one, along with a lineApiBaseUrl or an
 * aiBaseUrl on this machine.
 *
 * Strapi's cron is stopped right after the load, for every suite: the plugin's per-minute labelling job, or a job of the
 * app's own, would race the suite's own calls. A suite that wants a job to run calls it itself.
 */
export async function bootStrapi(name, { maisonConfig = {} } = {}) {
  const appDir = appDirectory();
  const dbFile = `.tmp/maison-test-${name}.db`;
  rmSync(path.join(appDir, dbFile), { force: true });
  process.env.DATABASE_FILENAME = dbFile;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
  for (const variable of AI_VARIABLES) process.env[variable] = '';
  process.chdir(appDir);
  const { createStrapi, compileStrapi } = requireFromApp('@strapi/strapi');
  const appContext = await compileStrapi({ appDir });
  const strapi = createStrapi(appContext);
  await strapi.load();
  strapi.cron.stop();
  for (const [key, value] of Object.entries({ lineChannelAccessToken: null, aiApiKey: null, aiBaseUrl: null, ...maisonConfig })) {
    strapi.config.set(`plugin::maison.${key}`, value);
  }
  return strapi;
}

export async function ensureLocales(strapi) {
  const locales = strapi.plugin('i18n').service('locales');
  for (const [code, name] of [['ja', 'Japanese (ja)'], ['en', 'English (en)']]) {
    if (!(await locales.findByCode(code))) await locales.create({ code, name });
  }
}
