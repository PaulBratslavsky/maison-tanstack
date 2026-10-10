import { z } from '@strapi/utils';

import { getConfig } from '../../config';
import { ACTION } from '../../constants';
import { toolError, toolSuccess } from '../../domain/tool-result';
import { defineTool } from '../define';
import { knowledgeEntryOutput, searchKnowledgeInput } from '../schemas';

export const searchKnowledgeTool = defineTool({
  name: 'search_knowledge',
  title: 'Search product knowledge',
  description:
    "Searches what Maison has written down for customers: care, materials, sizing, personalization, delivery, returns, repairs, warranty, gift wrapping and visiting a boutique. Use it for every question about those, and answer only from the entries it returns. It returns at most 4 entries, best first, or none. Never make up a policy.",
  auth: { policies: [{ action: ACTION.catalogRead }] },
  resolveInputSchema: () => searchKnowledgeInput,
  resolveOutputSchema: () =>
    z.object({
      locale: z.enum(['ja', 'en']),
      entries: z.array(knowledgeEntryOutput).describe('Best first. Empty when nothing Maison has written answers the question.'),
    }),
  createHandler: (strapi) => async ({ args }) => {
    const locale = args.locale ?? getConfig(strapi).defaultLocale;
    const result = await strapi.plugin('maison').service('catalog').searchKnowledge(locale, { query: args.query, productSlugs: args.productSlugs });
    if (!result.ok) return toolError(result.code, result.message, result.hint);
    return toolSuccess({ locale, ...result.value });
  },
});
