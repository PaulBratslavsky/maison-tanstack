import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { searchKnowledgeInput } from '../mcp/schemas';
import { fromQuery } from '../rest/query';
import { parseOrReply, replyFailure, replyValue } from '../rest/reply';

/**
 * Product knowledge over REST, at /api/maison/knowledge, as search_knowledge: the tool's input as query parameters
 * (productSlugs repeated), checked with the same schema, the same service, and the tool's structured content back. The
 * action is find, so a read-only API token may call it, as may a role or token holding plugin::maison.knowledge.find.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /** GET /knowledge, as search_knowledge. */
  async find(ctx) {
    const input = parseOrReply(ctx, searchKnowledgeInput, fromQuery(ctx.query, { lists: ['productSlugs'] }));
    if (!input) return;
    const locale = input.locale ?? getConfig(strapi).defaultLocale;
    const result = await strapi.plugin('maison').service('catalog').searchKnowledge(locale, { query: input.query, productSlugs: input.productSlugs });
    if (!result.ok) return replyFailure(ctx, result);
    replyValue(ctx, { locale, ...result.value });
  },
});
