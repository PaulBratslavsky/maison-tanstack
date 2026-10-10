import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STARTING_TEXT, writeStartingText } from '../strapi/src/api/home-page/starting-text.mjs';

const HOME_PAGE = 'api::home-page.home-page';

/**
 * Strapi as the starting text uses it: i18n's locales, and the Home page's rows in the database, one per locale and
 * status (each locale's draft, and its published copy once published). `log` lists every write, in order.
 */
const fakeStrapi = ({ locales = ['en'], defaultLocale = 'en', rows = [] } = {}) => {
  const store = { locales: locales.map((code) => ({ code })), rows: structuredClone(rows), log: [] };
  let documents = 0;
  const localesService = {
    findByCode: async (code) => store.locales.find((locale) => locale.code === code) ?? null,
    create: async (locale) => {
      store.log.push(`add the locale ${locale.code}, ${locale.name}`);
      store.locales.push(locale);
      return locale;
    },
    getDefaultLocale: async () => defaultLocale,
  };
  const documentService = {
    create: async ({ locale, data }) => {
      store.log.push(`create ${locale}`);
      const row = { documentId: `home-${++documents}`, locale, status: 'draft', ...data };
      store.rows.push(row);
      return row;
    },
    // Adds a locale's draft to the document, or changes the one it has.
    update: async ({ documentId, locale, data }) => {
      store.log.push(`update ${locale}`);
      const draft = store.rows.find((row) => row.documentId === documentId && row.locale === locale && row.status === 'draft');
      if (draft) Object.assign(draft, data);
      else store.rows.push({ documentId, locale, status: 'draft', ...data });
      return { documentId, locale, ...data };
    },
    // Copies each draft of the locale ('*': every locale) to its published version.
    publish: async ({ documentId, locale }) => {
      store.log.push(`publish ${locale}`);
      const drafts = store.rows.filter((row) => row.documentId === documentId && row.status === 'draft' && (locale === '*' || row.locale === locale));
      for (const draft of drafts) {
        store.rows = store.rows.filter((row) => !(row.documentId === documentId && row.locale === draft.locale && row.status === 'published'));
        store.rows.push({ ...draft, status: 'published' });
      }
      return { documentId };
    },
  };
  return {
    store,
    // The existence check must count every row, so a filter (published only, one locale) fails the test.
    db: { query: (uid) => (assert.equal(uid, HOME_PAGE), { count: async (params) => (assert.equal(params, undefined, 'count takes no filter'), store.rows.length) }) },
    plugin: (name) => (assert.equal(name, 'i18n'), { service: (service) => (assert.equal(service, 'locales'), localesService) }),
    documents: (uid) => (assert.equal(uid, HOME_PAGE), documentService),
  };
};

const published = (store, locale) => {
  const { eyebrow, headline, intro, ctaLabel } = store.rows.find((row) => row.status === 'published' && row.locale === locale);
  return { eyebrow, headline, intro, ctaLabel };
};

test('the starting text is the approved text, with no intro', () => {
  assert.deepEqual(STARTING_TEXT, {
    en: { eyebrow: 'Gifts, chosen with care', headline: 'Find the right piece. See it in person.', ctaLabel: 'Ask the concierge' },
    ja: { eyebrow: '心を込めて選ぶ、贈り物', headline: 'ふさわしい一品を。店頭で、お手に取って。', ctaLabel: 'コンシェルジュに相談する' },
  });
});

test('on an empty store, writes one Home page in en and ja and publishes both; the next start writes nothing', async () => {
  // A fresh database: i18n has made its default locale, en, and ja comes later with Maison's demo catalog.
  const strapi = fakeStrapi();
  assert.equal(await writeStartingText(strapi), true);
  assert.deepEqual(strapi.store.log, ['add the locale ja, Japanese (ja)', 'create en', 'update ja', 'publish *']);
  assert.deepEqual(published(strapi.store, 'en'), { ...STARTING_TEXT.en, intro: undefined });
  assert.deepEqual(published(strapi.store, 'ja'), { ...STARTING_TEXT.ja, intro: undefined });
  assert.deepEqual([...new Set(strapi.store.rows.map((row) => row.documentId))], ['home-1'], 'one document, as a single type has');
  assert.equal(strapi.store.rows.length, 4, 'a draft and a published version in each locale');

  const once = structuredClone(strapi.store.rows);
  assert.equal(await writeStartingText(strapi), false);
  assert.deepEqual(strapi.store.rows, once);
  assert.equal(strapi.store.log.length, 4, 'no write on the second start');
});

test("creates the default locale's version first, as Maison's seed does, whichever locale that is", async () => {
  const strapi = fakeStrapi({ locales: ['ja'], defaultLocale: 'ja' });
  assert.equal(await writeStartingText(strapi), true);
  assert.deepEqual(strapi.store.log, ['add the locale en, English (en)', 'create ja', 'update en', 'publish *']);
  assert.deepEqual(published(strapi.store, 'en'), { ...STARTING_TEXT.en, intro: undefined });
  assert.deepEqual(published(strapi.store, 'ja'), { ...STARTING_TEXT.ja, intro: undefined });
});

test('leaves a Home page alone when one exists, in either locale, draft or published, and writes nothing', async () => {
  const edit = { documentId: 'home-edited', eyebrow: 'An edit', headline: 'Edited in the Content Manager', ctaLabel: 'Ask us' };
  const cases = {
    'a draft in en, never published': [{ ...edit, locale: 'en', status: 'draft' }],
    'a draft in ja, never published': [{ ...edit, locale: 'ja', status: 'draft' }],
    'published in ja only': [{ ...edit, locale: 'ja', status: 'draft' }, { ...edit, locale: 'ja', status: 'published' }],
    'published in both, with a newer draft in en': [
      { ...edit, locale: 'en', status: 'draft', headline: 'Not published yet' },
      { ...edit, locale: 'en', status: 'published' },
      { ...edit, locale: 'ja', status: 'draft' },
      { ...edit, locale: 'ja', status: 'published' },
    ],
  };
  for (const [name, rows] of Object.entries(cases)) {
    const strapi = fakeStrapi({ locales: ['en', 'ja'], rows });
    assert.equal(await writeStartingText(strapi), false, name);
    assert.deepEqual(strapi.store.rows, rows, name);
    assert.deepEqual(strapi.store.log, [], name);
  }
});
