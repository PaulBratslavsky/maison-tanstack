import { z } from '@strapi/utils';

import { getConfig } from '../../config';
import { ACTION } from '../../constants';
import { toolError, toolSuccess } from '../../domain/tool-result';
import { defineTool } from '../define';
import { findBoutiquesInput } from '../schemas';

export const findBoutiquesTool = defineTool({
  name: 'find_boutiques',
  title: 'Get boutiques',
  description:
    "Lists boutiques with opening hours, whether each is open on a given date, and stock for up to five products. Use it before requesting an appointment. It doesn't book anything.",
  auth: { policies: [{ action: ACTION.catalogRead }] },
  resolveInputSchema: () => findBoutiquesInput,
  resolveOutputSchema: () =>
    z.object({
      date: z.string().nullable(),
      boutiques: z.array(
        z.object({
          slug: z.string(),
          name: z.string(),
          city: z.string(),
          address: z.string(),
          hours: z.array(z.object({ weekday: z.string(), opens: z.string(), closes: z.string() })),
          openOnDate: z.boolean().nullable(),
          hoursOnDate: z.object({ opens: z.string(), closes: z.string() }).nullable(),
          stock: z.array(z.object({ product: z.string(), quantity: z.number() })),
        })
      ),
    }),
  createHandler: (strapi) => async ({ args }) => {
    const locale = args.locale ?? getConfig(strapi).defaultLocale;
    const result = await strapi
      .plugin('maison')
      .service('catalog')
      .getBoutiques(locale, { date: args.date, productSlugs: args.productSlugs });
    if (!result.ok) return toolError(result.code, result.message, result.hint);
    return toolSuccess({ date: args.date ?? null, boutiques: result.value });
  },
});
