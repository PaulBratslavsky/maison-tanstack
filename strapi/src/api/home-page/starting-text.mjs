// The Home page's starting text: what the app's Home screen shows on a fresh database, until someone edits the page
// in the Content Manager and publishes it. Strapi's bootstrap (src/index.ts) runs writeStartingText at every start, and
// it writes only while there's no Home page at all, so it never overwrites an edit.
// Plain JavaScript, so the root npm test runs its tests with node --test (scripts/home-page-starting-text.test.mjs).

const HOME_PAGE = 'api::home-page.home-page';

/** @typedef {{ eyebrow: string, headline: string, intro?: string, ctaLabel: string }} HomePageText */

/**
 * The same words as the app's built-in text (app/src/lib/copy.ts), which it shows when Strapi can't give it the page. No
 * intro: the app shows one only when it's set.
 * @type {{ en: HomePageText, ja: HomePageText }}
 */
export const STARTING_TEXT = {
  en: {
    eyebrow: 'Gifts, chosen with care',
    headline: 'Find the right piece. See it in person.',
    ctaLabel: 'Ask the concierge',
  },
  ja: {
    eyebrow: '心を込めて選ぶ、贈り物',
    headline: 'ふさわしい一品を。店頭で、お手に取って。',
    ctaLabel: 'コンシェルジュに相談する',
  },
};

/** The names i18n gives the two locales, and Maison's demo catalog too. */
const LOCALE_NAMES = { en: 'English (en)', ja: 'Japanese (ja)' };

/**
 * Writes the starting text, as one published Home page in en and ja, when there's no Home page in any locale, draft or
 * published. Answers whether it wrote. Like Maison's seed (createLocalized), it creates the default locale's version,
 * adds the other locale's, then publishes both. A locale i18n doesn't have yet is added first: on a fresh database, ja
 * otherwise comes only with Maison's demo catalog, from npm run setup.
 * @param {import('@strapi/strapi').Core.Strapi} strapi
 * @returns {Promise<boolean>}
 */
export const writeStartingText = async (strapi) => {
  // The query engine counts every row of the type: each locale's draft and published version. The Document Service
  // would look at one locale and one status at a time.
  if ((await strapi.db.query(HOME_PAGE).count()) > 0) return false;

  const locales = strapi.plugin('i18n').service('locales');
  for (const code of Object.keys(STARTING_TEXT)) {
    if (!(await locales.findByCode(code))) await locales.create({ code, name: LOCALE_NAMES[code] });
  }
  // i18n's default is en here (Strapi's own, as STRAPI_PLUGIN_I18N_INIT_LOCALE_CODE isn't set).
  const [first, second] = (await locales.getDefaultLocale()) === 'ja' ? ['ja', 'en'] : ['en', 'ja'];
  const documents = strapi.documents(HOME_PAGE);
  const { documentId } = await documents.create({ locale: first, data: STARTING_TEXT[first] });
  await documents.update({ documentId, locale: second, data: STARTING_TEXT[second] });
  await documents.publish({ documentId, locale: '*' });
  return true;
};
