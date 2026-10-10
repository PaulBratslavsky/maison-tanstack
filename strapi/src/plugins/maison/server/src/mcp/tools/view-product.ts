import { z } from '@strapi/utils';

import { getConfig } from '../../config';
import { ACTION } from '../../constants';
import { productNotFound } from '../../domain/failures';
import { toolError, toolSuccess } from '../../domain/tool-result';
import { defineTool } from '../define';
import { viewProductInput } from '../schemas';

const product = z.object({
  locale: z.enum(['ja', 'en']).describe('The language actually returned; falls back to ja when no translation exists.'),
  slug: z.string(),
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  priceJpy: z.number(),
  description: z.string(),
  craftStory: z.string(),
  dimensionsCm: z.object({ width: z.number(), height: z.number(), depth: z.number() }).nullable(),
  personalization: z.object({ offered: z.boolean(), kinds: z.array(z.string()), leadDays: z.number().nullable() }),
  images: z.array(z.object({ url: z.string(), alt: z.string() })),
  occasions: z.array(z.string()),
  collection: z.object({ slug: z.string(), name: z.string() }).nullable(),
  stock: z.array(z.object({ boutique: z.string(), name: z.string(), quantity: z.number() })),
});

export const viewProductTool = defineTool({
  name: 'view_product',
  title: 'Get product details',
  description:
    "Full details for one published product: description, craft story, dimensions, personalization options and stock per boutique. Use the slug from search_products. Never invent details the product doesn't have.",
  auth: { policies: [{ action: ACTION.catalogRead }] },
  resolveInputSchema: () => viewProductInput,
  resolveOutputSchema: () => z.object({ product }),
  createHandler: (strapi) => async ({ args }) => {
    const locale = args.locale ?? getConfig(strapi).defaultLocale;
    const found = await strapi.plugin('maison').service('catalog').getProduct(locale, args.slug);
    if (!found) {
      const { code, message, hint } = productNotFound(args.slug);
      return toolError(code, message, hint);
    }
    return toolSuccess({ product: found });
  },
});
