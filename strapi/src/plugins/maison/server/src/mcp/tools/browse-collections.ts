import { z } from '@strapi/utils';

import { getConfig } from '../../config';
import { ACTION } from '../../constants';
import { toolSuccess } from '../../domain/tool-result';
import { defineTool } from '../define';
import { browseCollectionsInput } from '../schemas';

export const browseCollectionsTool = defineTool({
  name: 'browse_collections',
  title: 'Browse collections',
  description:
    "Lists the house's published collections with a short story and product count. Start here when a customer wants to browse; then call search_products with a collection slug. It doesn't list products or prices.",
  auth: { policies: [{ action: ACTION.catalogRead }] },
  resolveInputSchema: () => browseCollectionsInput,
  resolveOutputSchema: () =>
    z.object({
      locale: z.enum(['ja', 'en']),
      collections: z.array(
        z.object({ slug: z.string(), name: z.string(), teaser: z.string(), heroImageUrl: z.string().nullable(), productCount: z.number() })
      ),
    }),
  createHandler: (strapi) => async ({ args }) => {
    const locale = args.locale ?? getConfig(strapi).defaultLocale;
    const collections = await strapi.plugin('maison').service('catalog').browseCollections(locale);
    return toolSuccess({ locale, collections });
  },
});
