import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { findBoutiquesInput } from '../mcp/schemas';
import { fromQuery } from '../rest/query';
import { parseOrReply, replyFailure, replyValue } from '../rest/reply';

/**
 * The boutiques over REST, at /api/maison/boutiques, as find_boutiques: the tool's input as query parameters, checked
 * with the same schema, the same service, and the tool's structured content back. The action is find, so a read-only
 * API token may call it, as may a role or token holding plugin::maison.boutiques.find.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /** GET /boutiques, as find_boutiques. Several products repeat the parameter: ?productSlugs=a&productSlugs=b. */
  async find(ctx) {
    const input = parseOrReply(ctx, findBoutiquesInput, fromQuery(ctx.query, { lists: ['productSlugs'] }));
    if (!input) return;
    const locale = input.locale ?? getConfig(strapi).defaultLocale;
    const result = await strapi.plugin('maison').service('catalog').getBoutiques(locale, { date: input.date, productSlugs: input.productSlugs });
    if (!result.ok) return replyFailure(ctx, result);
    replyValue(ctx, { date: input.date ?? null, boutiques: result.value });
  },
});
