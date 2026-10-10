import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { browseCollectionsInput } from '../mcp/schemas';
import { fromQuery } from '../rest/query';
import { parseOrReply, replyValue } from '../rest/reply';

/**
 * The collections over REST, at /api/maison/collections, as browse_collections: the tool's input as query parameters,
 * checked with the same schema, the same service, and the tool's structured content back. The action is find, so a
 * read-only API token may call it, as may a role or token holding plugin::maison.collections.find.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /** GET /collections, as browse_collections. */
  async find(ctx) {
    const input = parseOrReply(ctx, browseCollectionsInput, fromQuery(ctx.query));
    if (!input) return;
    const locale = input.locale ?? getConfig(strapi).defaultLocale;
    replyValue(ctx, { locale, collections: await strapi.plugin('maison').service('catalog').browseCollections(locale) });
  },
});
