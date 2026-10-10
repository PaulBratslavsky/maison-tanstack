import { z } from '@strapi/utils';

import { getConfig } from '../../config';
import { ACTION } from '../../constants';
import { toolError, toolSuccess } from '../../domain/tool-result';
import { defineTool } from '../define';
import { priceRangeFailure, productCardOutput, searchProductsInput } from '../schemas';

export const searchProductsTool = defineTool({
  name: 'search_products',
  title: 'Search products',
  description:
    'Finds published products by collection, category, gift occasion, price range, personalization and boutique stock. Use it for every product question; never invent products, prices or availability. Results are sorted by price, highest first.',
  auth: { policies: [{ action: ACTION.catalogRead }] },
  resolveInputSchema: () => searchProductsInput,
  resolveOutputSchema: () => z.object({ locale: z.enum(['ja', 'en']), total: z.number(), products: z.array(productCardOutput) }),
  createHandler: (strapi) => async ({ args }) => {
    const invalid = priceRangeFailure(args);
    if (invalid) return toolError(invalid.code, invalid.message, invalid.hint);
    const locale = args.locale ?? getConfig(strapi).defaultLocale;
    const result = await strapi.plugin('maison').service('catalog').searchProducts(locale, args);
    if (!result.ok) return toolError(result.code, result.message, result.hint);
    return toolSuccess({ locale, ...result.value });
  },
});
