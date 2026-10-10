import { z } from '@strapi/utils';

import {
  CATEGORIES,
  CLOSE_REASONS,
  CREATED_VIA,
  INQUIRY_FILTERS,
  INQUIRY_KINDS,
  KNOWLEDGE_CATEGORIES,
  LOCALES,
  OCCASIONS,
  QUESTION_REASONS,
  SENTIMENT_LABELS,
} from '../constants';
import { ISO_DATE, isRealIsoDate } from '../domain/hours';
import { failure, type ServiceFailure } from '../domain/service-result';

const ISO_DATETIME_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const NOT_A_REAL_DATE = 'Not a real calendar date.';

export const localeInput = z.enum(LOCALES).optional().describe('Content language: "ja" (default) or "en".');
export const slugInput = z.string().min(1).max(120).regex(/^[a-z0-9-]+$/, 'Use a slug like "weekender-50".');
// A wrong format aborts the checks that follow, so it gets one message, not a calendar complaint as well.
export const isoDateInput = z
  .string()
  .regex(ISO_DATE, { error: 'Use YYYY-MM-DD.', abort: true })
  .refine(isRealIsoDate, NOT_A_REAL_DATE);
export const isoDateTimeInput = z
  .string()
  .regex(ISO_DATETIME_WITH_OFFSET, { error: 'Use ISO 8601 with a time zone, e.g. 2026-10-10T14:00:00+09:00.', abort: true })
  .refine((value) => isRealIsoDate(value.slice(0, 10)), NOT_A_REAL_DATE)
  .refine((value) => Number(value.slice(11, 13)) <= 23, 'Not a real time of day: the hour must be 00 to 23.')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a real date and time.');
export const categoryInput = z.enum(CATEGORIES);
export const occasionInput = z.enum(OCCASIONS);

/*
 * The customer tools' inputs. The REST routes parse with these same objects, so both doors check input the same way:
 * an MCP tool through resolveInputSchema, a route after decoding its query string or reading its JSON body.
 */

export const browseCollectionsInput = z.object({ locale: localeInput });

export const searchProductsInput = z.object({
  query: z.string().max(100).optional().describe('Free text matched against product names and descriptions.'),
  collection: slugInput.optional().describe('Collection slug from browse_collections.'),
  category: categoryInput.optional(),
  occasion: occasionInput.optional().describe('Gift occasion, e.g. "travel" for someone who travels.'),
  minPriceJpy: z.number().int().min(0).optional(),
  maxPriceJpy: z.number().int().min(0).optional().describe('Budget ceiling in whole yen.'),
  personalizable: z.boolean().optional().describe('Only pieces that can be personalized (initials, stripes, colors).'),
  inStockAt: slugInput.optional().describe('Boutique slug from find_boutiques: only pieces in stock there now.'),
  locale: localeInput,
  limit: z.number().int().min(1).max(20).optional().describe('Maximum results, default 8.'),
});

/** search_products' one rule across two fields, checked after the schema so the hint can say what to do. */
export const priceRangeFailure = (input: { minPriceJpy?: number; maxPriceJpy?: number }): ServiceFailure | null =>
  input.minPriceJpy !== undefined && input.maxPriceJpy !== undefined && input.minPriceJpy > input.maxPriceJpy
    ? failure('invalid_input', 'minPriceJpy is above maxPriceJpy.', 'Swap them, or drop one of the two limits.')
    : null;

export const viewProductInput = z.object({ slug: slugInput, locale: localeInput });

export const findBoutiquesInput = z.object({
  productSlugs: z.array(slugInput).max(5).optional().describe('Products to report stock for.'),
  date: isoDateInput.optional().describe('A calendar day (YYYY-MM-DD) to check opening hours for.'),
  locale: localeInput,
});

export const searchKnowledgeInput = z.object({
  // Trimmed before min(1), so a question of only spaces is refused like an empty one, and the search gets it trimmed.
  query: z.string().trim().min(1).max(300).describe('The customer\'s question in their own words, e.g. "How do I care for the leather?"'),
  productSlugs: z.array(slugInput).max(5).optional().describe('Products the question is about, from search_products: only entries about them, and general ones.'),
  locale: localeInput,
});

export const knowledgeEntryOutput = z.object({
  title: z.string(),
  answer: z.string().describe('What Maison has written. Answer from this, in the customer\'s language.'),
  category: z.string(),
  productSlugs: z.array(z.string()).describe('The pieces it is about; empty when it applies to every piece.'),
});

/** No customer field: the customer always comes from the caller's LINE sign-in. */
export const requestAppointmentInput = z.object({
  boutique: slugInput.describe('Boutique slug from find_boutiques, e.g. "ginza".'),
  productSlugs: z.array(slugInput).min(1).max(5).describe('One to five product slugs the customer wants to see.'),
  requestedFor: isoDateTimeInput.describe('Visit start, ISO 8601 with a time zone offset, e.g. 2026-10-10T14:00:00+09:00.'),
  note: z.string().max(500).optional().describe("The customer's own words for the boutique, e.g. who the gift is for."),
  locale: localeInput,
});

export const myAppointmentsInput = z.object({ locale: localeInput });

export const productCardOutput = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  priceJpy: z.number(),
  imageUrl: z.string().nullable(),
  occasions: z.array(z.string()),
  personalizable: z.boolean(),
  inStockAt: z.array(z.string()),
});

export const appointmentOutput = z.object({
  reference: z.string(),
  status: z.enum(['requested', 'confirmed']).describe('"requested" until the boutique confirms. Never call a requested visit confirmed.'),
  boutique: z.object({ slug: z.string(), name: z.string() }),
  requestedFor: z.string().describe('Visit start in the boutique\'s time zone, ISO 8601 with offset.'),
  products: z.array(z.object({ slug: z.string(), name: z.string() })),
  note: z.string(),
  confirmationSent: z.boolean().describe('Whether the LINE confirmation has been delivered.'),
});

/** No customer field: the customer always comes from the caller's LINE sign-in. */
export const handOffToStaffInput = z.object({
  question: z.string().trim().min(1).max(1000).describe("The customer's question, in their own words."),
  reason: z
    .enum(QUESTION_REASONS)
    .optional()
    .describe('"no_answer" (the default) when search_knowledge has no entry that answers it; "asked_for_person" when the customer asked for a person.'),
  productSlug: slugInput.optional().describe('The piece the question is about, when it is about one piece.'),
  locale: localeInput,
});

export const questionOutput = z.object({
  reference: z.string(),
  status: z.literal('open'),
  product: z.object({ slug: z.string(), name: z.string() }).nullable(),
});

/** An appointment reference such as APT-4821 (see domain/reference.ts). */
export const referenceInput = z.string().regex(/^APT-\d{4}$/, 'Use a reference like APT-4821.');

/** Staff filters for appointments. The appointment_requests tool, the chat and the admin board all use these. */
export const appointmentRequestsInput = z.object({
  status: z
    .enum(['requested', 'confirmed', 'all'])
    .optional()
    .describe('"requested" (default): waiting for staff, with the visit still ahead. "confirmed": confirmed by staff. "all": every request.'),
  boutique: slugInput.optional().describe('Only this boutique, by slug from find_boutiques.'),
  date: isoDateInput.optional().describe("Only visits on this calendar day (YYYY-MM-DD) in the boutique's time zone."),
  limit: z.number().int().min(1).max(50).optional().describe('Maximum appointments, default 20.'),
  locale: localeInput,
});

/** An appointment as staff see it. The customer is masked, and labels come from published versions only. */
export const staffAppointmentOutput = z.object({
  reference: z.string(),
  status: z.enum(['requested', 'confirmed']).describe('"confirmed" once staff have confirmed it.'),
  customer: z.string().describe('The LINE customer, masked like line:U4af…88. The full ID is never shown.'),
  boutique: z.object({ slug: z.string(), name: z.string() }).nullable().describe('null if the boutique is no longer published.'),
  requestedFor: z.string().describe("Visit start in the boutique's time zone, ISO 8601 with offset."),
  products: z.array(z.object({ slug: z.string(), name: z.string() })).describe('The published products the customer wants to see.'),
  note: z.string().describe("The customer's own words for the boutique."),
  createdVia: z
    .enum(CREATED_VIA)
    .describe('"concierge" when the AI concierge made the request, "app" for the app screens, "web" for a website through the REST routes.'),
  confirmationSent: z.boolean().describe('Whether the LINE confirmation has been delivered.'),
  demoCustomer: z
    .boolean()
    .describe("True for one of Load demo activity's made-up customers. Strapi sends them no LINE message, so their confirmation is never sent."),
  yourLine: z
    .boolean()
    .describe("True for the presenter's own LINE account, which the demo uses for a few items. Confirming it sends a real LINE message to the presenter."),
  createdAt: z.string().describe('When the request was made, ISO 8601 with offset.'),
});

/** A question reference such as Q-4821 (see domain/reference.ts). */
export const questionReferenceInput = z.string().regex(/^Q-\d{4}$/, 'Use a reference like Q-4821.');

/** Staff filters for customer questions, as the admin's Customer questions section sends them. */
export const questionsListInput = z.object({
  status: z.enum(['open', 'answered', 'all']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/**
 * What staff send with Answer: the text for the customer, and whether it also becomes product knowledge, under a
 * category and with a title. The title is what customers see over the answer in the concierge, so staff can write it
 * in place of the customer's own words. It is used only while `addToKnowledge` is true, and without one the title is
 * the customer's question.
 */
export const answerInput = z
  .object({
    text: z.string().trim().min(1).max(2000),
    addToKnowledge: z.boolean().optional().default(true),
    category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((reply) => !reply.addToKnowledge || reply.category !== undefined, {
    message: 'Pick a category to add the answer to product knowledge.',
    path: ['category'],
  });

/**
 * What the app's server logs after each concierge turn. No customer field: the customer always comes from the caller's
 * LINE sign-in. The limits are above what the inquiry holds (1,000 and 2,000), which the service cuts to, so a long turn
 * is logged and never refused.
 */
export const logInquiryInput = z.object({
  message: z.string().trim().min(1).max(4000).describe("The customer's last message."),
  reply: z.string().max(8000).optional().describe("The concierge's final text for the turn."),
  knowledgeFound: z.boolean().describe('Whether any search_knowledge call in the turn returned an entry.'),
  handedOff: z.boolean().describe('Whether the turn handed the question to staff.'),
  questionReference: questionReferenceInput.optional().describe('The question the hand-off recorded.'),
  productSlug: slugInput.optional().describe('The product page the customer was on.'),
  locale: localeInput,
});

/** Staff filters for inquiries, as the admin's Inquiries tab sends them. Without a filter: needs-answer. */
export const inquiryListInput = z.object({
  filter: z.enum(INQUIRY_FILTERS).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/** What staff send with Close: why the inquiry needs nothing more. */
export const closeInquiryInput = z.object({ reason: z.enum(CLOSE_REASONS) });

/** What staff send with Change label: a kind, a sentiment, or both. */
export const changeLabelInput = z
  .object({ kind: z.enum(INQUIRY_KINDS).optional(), sentimentLabel: z.enum(SENTIMENT_LABELS).optional() })
  .refine((input) => input.kind !== undefined || input.sentimentLabel !== undefined, { message: 'Give a kind, a sentiment, or both.' });

/**
 * What staff send with Reply on LINE: the text for the customer, trimmed, of 1 to 2,000 characters, which is what the
 * inquiry's `replyText` holds. There is no field for who replies: the signed-in admin does.
 */
export const replyInquiryInput = z.object({ text: z.string().trim().min(1).max(2000) });

/** Zod issues on one line, e.g. `reference: Use a reference like APT-4821.` */
export const describeIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.map(String).join('.') || 'input'}: ${issue.message}`).join('; ');
