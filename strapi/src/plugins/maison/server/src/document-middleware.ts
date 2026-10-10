import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { OCCASIONS, PERSONALIZATION_KINDS, PLUGIN_ID, UID } from './constants';
import { validateOpeningHours } from './domain/hours';
import { validateEnumArray, validateSlugArray } from './domain/validation';

type Data = Record<string, unknown>;

const fail = (message: string): never => {
  throw new errors.ValidationError(message);
};

const validateProduct = (data: Data) => {
  const fields = [
    ['personalizationKinds', PERSONALIZATION_KINDS],
    ['giftOccasions', OCCASIONS],
  ] as const;
  for (const [field, allowed] of fields) {
    if (data[field] === undefined || data[field] === null) continue;
    const problem = validateEnumArray(data[field], allowed, field);
    if (problem) fail(problem);
  }
};

const validateBoutique = (data: Data) => {
  if (data.openingHours === undefined) return;
  const result = validateOpeningHours(data.openingHours);
  if (result.ok === false) fail(result.reason);
};

/** A knowledge entry's products are slugs, as stock levels keep them, so republishing a product never breaks the link. */
const validateKnowledge = (data: Data) => {
  if (data.productSlugs === undefined || data.productSlugs === null) return;
  const problem = validateSlugArray(data.productSlugs, 'productSlugs');
  if (problem) fail(problem);
};

const assertUniqueStockPair = async (strapi: Core.Strapi, data: Data) => {
  const { productSlug, boutiqueSlug } = data;
  if (typeof productSlug !== 'string' || typeof boutiqueSlug !== 'string') return;
  const existing = await strapi.documents(UID.stockLevel).count({
    filters: { productSlug: { $eq: productSlug }, boutiqueSlug: { $eq: boutiqueSlug } },
  });
  if (existing > 0) fail('A stock level for this product and boutique already exists; update it instead.');
};

/**
 * The references of the appointments a publish published: one, as appointments aren't localized. A publish asked
 * for only some fields answers without the reference, so it's then read from the published version.
 */
const publishedReferences = async (strapi: Core.Strapi, published: unknown, documentId: unknown): Promise<string[]> => {
  const entries = ((published as { entries?: Data[] } | null)?.entries ?? []) as Data[];
  if (entries.length === 0) return [];
  const references = entries.map((entry) => entry.reference).filter((reference): reference is string => typeof reference === 'string');
  if (references.length > 0) return [...new Set(references)];
  if (typeof documentId !== 'string') return [];
  const appointment = (await strapi.documents(UID.appointment).findOne({
    documentId,
    status: 'published',
    fields: ['reference'],
  })) as Data | null;
  return typeof appointment?.reference === 'string' ? [appointment.reference] : [];
};

/** Sends each published appointment's LINE confirmation. A send that fails is logged, and the next one still goes. */
const sendConfirmations = async (strapi: Core.Strapi, published: unknown, documentId: unknown) => {
  for (const reference of await publishedReferences(strapi, published, documentId)) {
    try {
      await strapi.plugin(PLUGIN_ID).service('line-confirmations').sendConfirmation(reference);
    } catch (error) {
      strapi.log.error(`[maison] The LINE confirmation for ${reference} couldn't be sent: ${(error as Error)?.message ?? error}`);
    }
  }
};

/** The same, for after a publish: it never throws, not even at once, and never rejects. What fails is logged. */
const sendConfirmationsSafely = (strapi: Core.Strapi, published: unknown, documentId: unknown): Promise<void> =>
  sendConfirmations(strapi, published, documentId).catch((error) => {
    strapi.log.error(`[maison] The LINE confirmations of a publish couldn't be sent: ${(error as Error)?.message ?? error}`);
  });

/**
 * Same rules for the admin and the tools: every create/update goes through the Document Service.
 *
 * And the same confirmation: publishing an appointment confirms the visit, whichever way it happens. That's the board's
 * Confirm, the admin chat and MCP clients (all through appointments.confirm), and Publish in the Content Manager.
 * - A publish of its own, as appointments.confirm makes it, has committed by the time `next()` resolves. Strapi then
 *   sends the customer the LINE confirmation and waits for it, so the answer and the board's next refresh show how it
 *   went. The push's 8-second timeout bounds that wait.
 * - A publish inside someone else's transaction, as the Content Manager's Publish and bulk Publish make it, sends once
 *   that transaction commits, without making it wait. A push can't be rolled back, so a rolled-back publish sends
 *   nothing, and LINE's answer never holds the database (SQLite has one connection). The board shows the outcome on
 *   its next refresh.
 * Sending never fails the publish.
 */
export const registerDocumentMiddleware = (strapi: Core.Strapi) => {
  strapi.documents.use(async (ctx, next) => {
    if (ctx.action === 'create' || ctx.action === 'update') {
      const data = ((ctx.params as { data?: Data }).data ?? {}) as Data;
      if (ctx.uid === UID.product) validateProduct(data);
      if (ctx.uid === UID.boutique) validateBoutique(data);
      if (ctx.uid === UID.knowledge) validateKnowledge(data);
      if (ctx.uid === UID.stockLevel && ctx.action === 'create') await assertUniqueStockPair(strapi, data);
    }
    return next();
  });

  strapi.documents.use(async (ctx, next) => {
    if (ctx.uid !== UID.appointment || ctx.action !== 'publish') return next();
    const published = await next();
    const { documentId } = ctx.params as { documentId?: string };
    if (strapi.db.inTransaction()) {
      await strapi.db.transaction(async ({ onCommit }) => {
        // The caller's transaction runs this right after it commits, so it must never throw.
        onCommit(() => {
          void sendConfirmationsSafely(strapi, published, documentId);
        });
      });
      return published;
    }
    await sendConfirmationsSafely(strapi, published, documentId);
    return published;
  });
};
