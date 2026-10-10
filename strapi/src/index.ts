import { join } from 'node:path';
import type { Core } from '@strapi/strapi';

/** src/api/home-page/starting-text.mjs */
type StartingText = { writeStartingText: (strapi: Core.Strapi) => Promise<boolean> };

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * Fills in the Home page on a fresh database, and leaves any Home page that exists alone.
   * starting-text.mjs is plain JavaScript, so the root npm test can run its tests with node --test. tsc doesn't copy it
   * into dist/, where Strapi runs this file from, so it's loaded from src/. tsc turns the import() into a require(),
   * which loads an ES module on Node 22.12 and later.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // The Home page is optional: without it the app shows its built-in text. So a failure here is logged, and Strapi
    // starts anyway.
    try {
      const { writeStartingText }: StartingText = await import(join(strapi.dirs.app.api, 'home-page', 'starting-text.mjs'));
      if (await writeStartingText(strapi)) strapi.log.info('Home page: wrote the starting text in en and ja, and published it.');
    } catch (error) {
      strapi.log.error(
        `Home page: couldn't write the starting text (${(error as Error).message}). The app shows its built-in text until a Home page is published in the Content Manager.`
      );
    }
  },
};
