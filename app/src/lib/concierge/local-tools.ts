import { toolDefinition } from '@tanstack/ai';
import { z } from 'zod';

import { CHOOSE_VISIT } from '../visit-picker';
import type { Locale } from '../types';
import { RESOLVE_DATE_DESCRIPTION, resolveDate, resolveDateInput, tidyInput, type DateQuery } from './resolve-date';

/**
 * The concierge's two tools that are not Maison tools. They are plain TanStack AI tools with zod schemas, which `chat()`
 * checks before it runs or waits for them: input that fails the schema gives the model an error and the turn goes on.
 * This file has no secret and the browser uses it too (the visit picker's answer is a client tool built from
 * `chooseVisitTool`'s definition).
 */

/**
 * `resolve_date`: works out which day the customer means, so the model never has to. It answers from the same Tokyo
 * calendar as everything else here, and names the weekday in the reply's language. A server tool: it runs here.
 */
export const resolveDateTool = (locale: Locale, now: Date) =>
  toolDefinition({ name: 'resolve_date', description: RESOLVE_DATE_DESCRIPTION, inputSchema: resolveDateInput }).server((query) => resolveDate(query as DateQuery, locale, now)); // chat() has checked the input with the schema

/** A slug, as the Maison tools take one: lower-case letters, digits and hyphens. */
const SLUG = /^[a-z0-9-]{1,120}$/;

/**
 * choose_visit's input: a strict object, as resolve_date's, so a key it doesn't have is refused with its name, and the
 * same tidying (tidyInput): blanks and nulls mean "not given", case and spaces don't count, and a locale is ignored. The
 * picker checks the rest against the boutiques' hours and stock (lib/visit-picker.ts): a day or a time the call gets wrong
 * falls back, and is never sent as it is. A piece can't fall back: Strapi refuses the picker's whole find_boutiques call
 * for a piece it doesn't know. The server checks that after this schema, in `chooseVisitCheck` (visit-check.ts).
 */
export const chooseVisitInput = z.preprocess(
  tidyInput,
  z.strictObject({
    productSlugs: z
      .array(z.string().regex(SLUG, 'Use product slugs, such as "weekender-50".'))
      .min(1)
      .max(5)
      .describe('The pieces the customer wants to see: 1 to 5 product slugs, from search_products or view_product.'),
    boutique: z.string().regex(SLUG, 'Use a boutique slug, such as "ginza".').optional().describe('Only when the customer named a boutique: its slug, such as "ginza".'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD: the date resolve_date returned.').optional().describe('Only when the customer named a day: the date resolve_date returned, YYYY-MM-DD.'),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, 24-hour: 2 pm is "14:00".')
      .optional()
      .describe('Only when the customer named a time: HH:MM, 24-hour, such as "14:00" for 2 pm.'),
  })
);

/** What the model reads about choose_visit. */
export const CHOOSE_VISIT_DESCRIPTION =
  'Shows the customer the visit picker in the chat: the form to request a boutique visit, filled in with what you pass. Pass productSlugs, the pieces to see, and only what the customer named: the boutique slug, the date resolve_date returned, and the time as HH:MM (24-hour). The customer checks it and sends the request there, so your reply stops here until they answer. It answers status "requested", with the visit, once the customer has sent it, or status "closed" when they closed the picker without a request.';

/**
 * choose_visit, the app's own tool for a visit: it shows the customer the visit picker, the product page's booking form,
 * filled in from the call. A client tool: it has no function to run on the server, so the model's call ends the step
 * loop and the browser answers it (`addToolResult`, from the picker) once the customer has sent the request or closed it.
 */
export const chooseVisitDefinition = toolDefinition({ name: CHOOSE_VISIT, description: CHOOSE_VISIT_DESCRIPTION, inputSchema: chooseVisitInput });
export const chooseVisitTool = chooseVisitDefinition.client();
