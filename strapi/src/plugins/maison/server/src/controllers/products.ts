import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import type { Locale } from '../constants';
import { productNotFound } from '../domain/failures';
import { priceRangeFailure, searchProductsInput, viewProductInput } from '../mcp/schemas';
import { fromQuery } from '../rest/query';
import { parseOrReply, replyFailure, replyValue } from '../rest/reply';

/**
 * The products over REST, at /api/maison/products, as search_products and view_product: each action takes its tool's
 * input as query parameters, checks it with the same schema, calls the same service, and answers with the tool's
 * structured content. The actions are find and findOne, so a read-only API token may call them, as may a role or token
 * holding plugin::maison.products.find and plugin::maison.products.findOne.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const catalog = () => strapi.plugin('maison').service('catalog');
  const localeOf = (input: { locale?: Locale }) => input.locale ?? getConfig(strapi).defaultLocale;

  return {
    /** GET /products, as search_products. */
    async find(ctx) {
      const query = fromQuery(ctx.query, { numbers: ['minPriceJpy', 'maxPriceJpy', 'limit'], booleans: ['personalizable'] });
      const input = parseOrReply(ctx, searchProductsInput, query);
      if (!input) return;
      const invalid = priceRangeFailure(input);
      if (invalid) return replyFailure(ctx, invalid);
      const locale = localeOf(input);
      const result = await catalog().searchProducts(locale, input);
      if (!result.ok) return replyFailure(ctx, result);
      replyValue(ctx, { locale, ...result.value });
    },

    /** GET /products/:slug, as view_product. The path names the product; a slug in the query string can't change it. */
    async findOne(ctx) {
      const input = parseOrReply(ctx, viewProductInput, { ...fromQuery(ctx.query), slug: ctx.params.slug });
      if (!input) return;
      const product = await catalog().getProduct(localeOf(input), input.slug);
      if (!product) return replyFailure(ctx, productNotFound(input.slug));
      replyValue(ctx, { product });
    },
  };
};
