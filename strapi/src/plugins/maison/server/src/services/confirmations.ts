import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { LOCALES, UID, type Locale } from '../constants';
import { isDemoCustomer } from '../domain/demo-activity';
import { buildConfirmationMessage, type FlexMessage } from '../domain/flex-message';
import { failure, type ServiceResult } from '../domain/service-result';
import { lineUserIdOf, parseSubject } from '../domain/subject';
import { formatEnDateTime, formatJaDateTime, toZonedIso } from '../domain/time';

type Doc = Record<string, any>;
/**
 * What a notification records: LINE took the confirmation (`sent`), refused it or couldn't be reached (`failed`), or
 * the visit is a made-up demo customer's, who gets no LINE message (`demo`). Only Strapi records `demo`:
 * record_confirmation takes `sent` and `failed`.
 */
export type Outcome = 'sent' | 'failed' | 'demo';
/** Who recorded an outcome: Strapi itself, when it sent the confirmation, or the ops agent, through record_confirmation. */
export type RecordedBy = 'strapi' | 'ops-agent';

export interface PendingConfirmation {
  reference: string;
  lineUserId: string;
  boutique: { name: string; address: string };
  requestedFor: string;
  requestedForText: string;
  products: Array<{ name: string }>;
  previousAttempts: number;
  appLink: string;
  message: FlexMessage;
}

export interface RecordedConfirmation {
  notification: { reference: string; status: Outcome; sentAt: string; detail: string };
  alreadyRecorded: boolean;
}

/** Who gets an appointment's LINE confirmation, and what it says. */
export type LineConfirmation = Omit<PendingConfirmation, 'reference' | 'previousAttempts'>;

/**
 * What a confirmation needs from a published appointment: the boutique's name and address, and the products' names,
 * with their documentIds, which inVisitLanguage looks them up by.
 */
export const CONFIRMATION_POPULATE = {
  boutique: { fields: ['documentId', 'name', 'address'] },
  products: { fields: ['documentId', 'name'] },
};

/**
 * The language a visit was booked in, which its confirmation is written in. Visits booked before appointments kept one
 * have none: those are Japanese, as is any value that isn't a locale.
 */
const visitLanguage = (appointment: Doc): Locale =>
  (LOCALES as readonly unknown[]).includes(appointment.language) ? (appointment.language as Locale) : 'ja';

/** The published versions of `documentIds` in `locale`, by documentId, with `fields`. */
const publishedIn = async (
  strapi: Core.Strapi,
  uid: string,
  locale: Locale,
  documentIds: unknown[],
  fields: string[]
): Promise<Map<string, Doc>> => {
  const found = new Map<string, Doc>();
  const ids = [...new Set(documentIds.filter((id): id is string => typeof id === 'string'))];
  if (ids.length === 0) return found;
  const rows = await strapi.documents(uid as any).findMany({
    locale,
    status: 'published',
    filters: { documentId: { $in: ids } },
    fields,
    limit: ids.length,
  });
  for (const row of rows as Doc[]) found.set(row.documentId, row);
  return found;
};

/** A field's value in the visit's language when it has one, and its value in the default locale when it doesn't. */
const orDefault = (translated: unknown, inDefaultLocale: unknown) =>
  typeof translated === 'string' && translated.trim() !== '' ? translated : inDefaultLocale;

/**
 * Appointments populated with CONFIRMATION_POPULATE, with their boutique's name and address and their products' names
 * in each visit's language, for confirmationFor. An appointment links its boutique and products in the default locale
 * (appointments.request), so for a visit in another language this reads the published versions of the linked
 * documents in that language, one lookup per language and content type, and keeps the default locale's value of each
 * field that's missing or empty there. A visit in the default locale is left as it is.
 * pending_confirmations and Strapi's sender both go through it, so the two can't drift.
 */
export const inVisitLanguage = async (strapi: Core.Strapi, appointments: Doc[]): Promise<Doc[]> => {
  const { defaultLocale } = getConfig(strapi);
  const named = new Map<Locale, { boutiques: Map<string, Doc>; products: Map<string, Doc> }>();
  for (const language of new Set(appointments.map(visitLanguage))) {
    if (language === defaultLocale) continue;
    const visits = appointments.filter((appointment) => visitLanguage(appointment) === language);
    const [boutiques, products] = await Promise.all([
      publishedIn(strapi, UID.boutique, language, visits.map((visit) => visit.boutique?.documentId), ['name', 'address']),
      publishedIn(
        strapi,
        UID.product,
        language,
        visits.flatMap((visit) => ((visit.products ?? []) as Doc[]).map((product) => product.documentId)),
        ['name']
      ),
    ]);
    named.set(language, { boutiques, products });
  }
  return appointments.map((appointment) => {
    const names = named.get(visitLanguage(appointment));
    if (!names) return appointment;
    const boutique = appointment.boutique as Doc | null | undefined;
    const boutiqueIn = boutique ? names.boutiques.get(boutique.documentId) : undefined;
    return {
      ...appointment,
      boutique: boutique && {
        ...boutique,
        name: orDefault(boutiqueIn?.name, boutique.name),
        address: orDefault(boutiqueIn?.address, boutique.address),
      },
      products: ((appointment.products ?? []) as Doc[]).map((product) => ({
        ...product,
        name: orDefault(names.products.get(product.documentId)?.name, product.name),
      })),
    };
  });
};

/** A visit's date and time as each language writes it. */
const DATE_TIME: Record<Locale, (date: Date, timeZone: string) => string> = { ja: formatJaDateTime, en: formatEnDateTime };

/**
 * The LINE confirmation of a published appointment populated with CONFIRMATION_POPULATE: its recipient, its details
 * and its flex message, in the visit's language. It names the boutique and products as the appointment it's given
 * does, and looks nothing up: inVisitLanguage gives it those names in the visit's language. pending_confirmations lists
 * it and Strapi sends it, so the two can't drift. null when the appointment has no valid LINE customer.
 */
export const confirmationFor = (
  appointment: Doc,
  { liffUrl, timezone, houseName }: { liffUrl: string; timezone: string; houseName: Record<Locale, string> }
): LineConfirmation | null => {
  const subject = parseSubject(appointment.customer);
  if (!subject) return null;
  const language = visitLanguage(appointment);
  const when = new Date(appointment.requestedFor);
  const appLink = `${liffUrl}/visits/${appointment.reference}`;
  const boutique = { name: appointment.boutique?.name ?? '', address: appointment.boutique?.address ?? '' };
  const products = ((appointment.products ?? []) as Doc[]).map((product) => ({ name: product.name as string }));
  const requestedForText = DATE_TIME[language](when, timezone);
  return {
    lineUserId: lineUserIdOf(subject),
    boutique,
    requestedFor: toZonedIso(when, timezone),
    requestedForText,
    products,
    appLink,
    message: buildConfirmationMessage({
      language,
      houseName: houseName[language],
      reference: appointment.reference,
      boutiqueName: boutique.name,
      boutiqueAddress: boutique.address,
      requestedForText,
      productNames: products.map((product) => product.name),
      appLink,
    }),
  };
};

const DETAIL_MAX = 500;
/** Strapi's maxLength counts UTF-16 units (an emoji is two), so measure that, and never cut a surrogate pair. */
const clip = (text: string) => {
  if (text.length <= DETAIL_MAX) return text;
  let clipped = '';
  for (const char of text) {
    if (clipped.length + char.length > DETAIL_MAX - 1) break;
    clipped += char;
  }
  return `${clipped}…`;
};

export default ({ strapi }: { strapi: Core.Strapi }) => {
  /** Per appointment reference: whether a `sent` or `demo` notification exists (nothing left to send), and how many `failed` ones. */
  const outcomes = async (references: string[]) => {
    const map = new Map<string, { sent: boolean; failed: number }>();
    if (references.length === 0) return map;
    const rows = await strapi.documents(UID.notification).findMany({
      filters: { appointmentReference: { $in: references } },
      fields: ['appointmentReference', 'outcome'],
      limit: 5000,
    });
    for (const row of rows as Doc[]) {
      const reference = row.appointmentReference as string;
      const entry = map.get(reference) ?? { sent: false, failed: 0 };
      // A demo record leaves nothing to send, as a sent one does, and was never an attempt.
      if (row.outcome === 'sent' || row.outcome === 'demo') entry.sent = true;
      if (row.outcome === 'failed') entry.failed += 1;
      map.set(reference, entry);
    }
    return map;
  };

  /**
   * References of every appointment with nothing left to send: a `sent` notification, or a `demo` one. Not capped: a cap
   * would let them be listed again.
   */
  const sentReferences = async (): Promise<string[]> => {
    const rows = await strapi.documents(UID.notification).findMany({
      filters: { outcome: { $in: ['sent', 'demo'] } },
      fields: ['appointmentReference'],
    });
    return [...new Set((rows as Doc[]).map((row) => row.appointmentReference as string))];
  };

  const toRecorded = (reference: string, row: Doc, alreadyRecorded: boolean): RecordedConfirmation => ({
    notification: { reference, status: row.outcome, sentAt: new Date(row.sentAt).toISOString(), detail: row.detail ?? '' },
    alreadyRecorded,
  });

  return {
    /**
     * Upcoming published (staff-confirmed) appointments without a `sent` notification, soonest visit first. A made-up demo
     * customer's visit is never pending: Strapi records `demo` for it, and there's nothing to send.
     */
    async listPending(limit: number, now: Date = new Date()): Promise<ServiceResult<PendingConfirmation[]>> {
      const { liffUrl, timezone, houseName } = getConfig(strapi);
      if (!liffUrl) {
        return failure(
          'not_configured',
          'The maison plugin has no liffUrl, so the confirmation link would be broken.',
          'Set liffUrl in the maison plugin config (MAISON_LIFF_URL in LaunchPad) and restart Strapi. Send nothing until then.'
        );
      }
      // The query itself leaves out visits that are over and ones already sent, so `limit` counts only what's left to send.
      const sent = await sentReferences();
      const published = (await strapi.documents(UID.appointment).findMany({
        status: 'published',
        filters: {
          requestedFor: { $gte: now.toISOString() },
          ...(sent.length > 0 ? { reference: { $notIn: sent } } : {}),
        },
        sort: 'requestedFor:asc',
        populate: CONFIRMATION_POPULATE,
        limit,
      })) as Doc[];
      const state = await outcomes(published.map((doc) => doc.reference as string));

      const pending: PendingConfirmation[] = [];
      // Each visit's message is in its language, with the names Strapi's sender uses too.
      for (const doc of await inVisitLanguage(strapi, published)) {
        if (state.get(doc.reference)?.sent) continue; // recorded as sent (or demo) since the query above
        if (isDemoCustomer(doc.customer)) continue; // a made-up customer gets no LINE message
        const confirmation = confirmationFor(doc, { liffUrl, timezone, houseName });
        if (!confirmation) {
          strapi.log.warn(`[maison] Appointment ${doc.reference} has no valid LINE customer, so it can't be confirmed over LINE.`);
          continue;
        }
        // In the order pending_confirmations has always listed them.
        pending.push({
          reference: doc.reference,
          lineUserId: confirmation.lineUserId,
          boutique: confirmation.boutique,
          requestedFor: confirmation.requestedFor,
          requestedForText: confirmation.requestedForText,
          products: confirmation.products,
          previousAttempts: state.get(doc.reference)?.failed ?? 0,
          appLink: confirmation.appLink,
          message: confirmation.message,
        });
      }
      return { ok: true, value: pending };
    },

    /**
     * Appends a delivery outcome. A second `sent` for the same appointment returns the first one instead, and so does a
     * second `demo`. `recordedBy` defaults to the ops agent, so record_confirmation, which never passes it, keeps writing
     * 'ops-agent'.
     */
    async record(input: {
      reference: string;
      status: Outcome;
      detail: string;
      recordedBy?: RecordedBy;
    }): Promise<ServiceResult<RecordedConfirmation>> {
      const appointment = (await strapi.documents(UID.appointment).findFirst({
        status: 'draft',
        filters: { reference: { $eq: input.reference } },
        fields: ['documentId', 'reference'],
      })) as Doc | null;
      if (!appointment) {
        return failure('not_found', `No appointment ${input.reference}.`, 'Use a reference from pending_confirmations.');
      }
      const published = await strapi.documents(UID.appointment).count({
        status: 'published',
        filters: { documentId: { $eq: appointment.documentId } },
      });
      if (published === 0) {
        return failure(
          'not_published',
          `Appointment ${input.reference} has not been confirmed by the boutique.`,
          'Only published appointments get confirmations. Do not message the customer; call pending_confirmations for the ones to send.'
        );
      }
      if (input.status === 'sent' || input.status === 'demo') {
        const existing = (await strapi.documents(UID.notification).findFirst({
          filters: { outcome: { $eq: input.status }, appointmentReference: { $eq: input.reference } },
          sort: 'sentAt:asc',
        })) as Doc | null;
        if (existing) return { ok: true, value: toRecorded(input.reference, existing, true) };
      }
      const created = await strapi.documents(UID.notification).create({
        data: {
          appointmentReference: input.reference,
          channel: 'line',
          outcome: input.status,
          sentAt: new Date().toISOString(),
          detail: clip(input.detail),
          recordedBy: input.recordedBy ?? 'ops-agent',
        },
      });
      const saved = (await strapi.documents(UID.notification).findOne({ documentId: created.documentId })) as Doc;
      return { ok: true, value: toRecorded(input.reference, saved, false) };
    },
  };
};
