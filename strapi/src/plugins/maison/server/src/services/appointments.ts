import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { CREATED_VIA, UID, type CreatedVia, type Locale } from '../constants';
import { isDemoCustomer, isYourLine } from '../domain/demo-activity';
import { checkOpenAt, validateOpeningHours, type Weekday } from '../domain/hours';
import { generateReference } from '../domain/reference';
import { failure, type ServiceResult } from '../domain/service-result';
import { maskSubject } from '../domain/subject';
import { toZonedIso, zonedDayRange } from '../domain/time';

type Doc = Record<string, any>;

export interface AppointmentView {
  reference: string;
  status: 'requested' | 'confirmed';
  boutique: { slug: string; name: string };
  requestedFor: string;
  products: Array<{ slug: string; name: string }>;
  note: string;
  confirmationSent: boolean;
}

export interface AppointmentRequest {
  subject: string;
  boutique: string;
  productSlugs: string[];
  requestedFor: string;
  note?: string;
  createdVia: CreatedVia;
  /**
   * The customer's language. It names the boutique and products in the answer, and the appointment keeps it as its
   * `language`, which the visit's LINE confirmation is written in. Defaults to defaultLocale.
   */
  locale?: Locale;
  /** Only for tests. Defaults to the current time. */
  now?: Date;
}

/** An appointment as staff see it: the customer masked, labels from published versions only. */
export interface StaffAppointmentView {
  reference: string;
  status: 'requested' | 'confirmed';
  customer: string;
  boutique: { slug: string; name: string } | null;
  requestedFor: string;
  products: Array<{ slug: string; name: string }>;
  note: string;
  createdVia: CreatedVia;
  confirmationSent: boolean;
  /** One of Load demo activity's made-up customers, who gets no LINE message: the board shows "demo customer", never "not sent". */
  demoCustomer: boolean;
  /**
   * The presenter's own LINE account (the plugin's demoLineUserId): confirming it sends a real LINE message to the
   * presenter. The board shows a "Your LINE" label. Never the ID itself.
   */
  yourLine: boolean;
  createdAt: string;
}

export interface RequestFilters {
  status?: 'requested' | 'confirmed' | 'all';
  boutique?: string;
  date?: string;
  /** One request by its reference, whatever its status or its visit date: with it, the status filter is `all`. */
  reference?: string;
  limit?: number;
  locale?: Locale;
  /** Only for tests. Defaults to the current time. */
  now?: Date;
}

export interface ConfirmedAppointment {
  appointment: StaffAppointmentView;
  alreadyConfirmed: boolean;
}

/**
 * What staff see at a glance on the admin homepage: the board's headline numbers, and its newest rows. The three
 * counts follow one pipeline of visits still ahead: waiting for staff, then confirmed, then sent over LINE.
 */
export interface RequestsSummary {
  counts: {
    /** Requested and not confirmed yet, with the visit still ahead: what the board's "Waiting for staff" view lists. */
    waitingForStaff: number;
    /** Confirmed by staff, with the visit still ahead. */
    confirmedUpcoming: number;
    /** Of those confirmed upcoming visits, the ones whose LINE confirmation has been sent: the board's "LINE sent" rows among them. */
    confirmationsSent: number;
  };
  /**
   * The newest requests, newest first: the top of the board's "All requests" view, without the products. `createdAt` is
   * when the request came in and `note` is what the customer wrote, both as the board's rows have them.
   */
  recent: Array<
    Pick<
      StaffAppointmentView,
      'reference' | 'status' | 'customer' | 'boutique' | 'requestedFor' | 'note' | 'confirmationSent' | 'demoCustomer' | 'yourLine' | 'createdAt'
    >
  >;
}

const MIN_LEAD_MINUTES = 30;
const RECENT_REQUESTS = 5;
const DAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};
const POPULATE = { boutique: { fields: ['slug', 'name'] }, products: { fields: ['slug', 'name'] } };
/** Staff views read only documentIds from the draft's relations; every label comes from a published version. */
const STAFF_POPULATE = { boutique: { fields: ['documentId'] }, products: { fields: ['documentId'] } };

/*
 * The board's views, as conditions on the appointment drafts. The board's list and the homepage summary both use
 * these, so a count always matches the rows the board shows. `confirmed` is every confirmed appointment's documentId.
 */

/** A visit that hasn't started at `now`. */
const ahead = (now: Date): Doc => ({ requestedFor: { $gte: now.toISOString() } });

/** The board's "requested" view: what staff can still confirm, not confirmed yet and with the visit still ahead. */
const requestedConditions = (confirmed: string[], now: Date): Doc[] =>
  confirmed.length > 0 ? [{ documentId: { $notIn: confirmed } }, ahead(now)] : [ahead(now)];

/** The board's "confirmed" view, whenever the visit is. null when nothing is confirmed, so nothing can match. */
const confirmedConditions = (confirmed: string[]): Doc[] | null => (confirmed.length > 0 ? [{ documentId: { $in: confirmed } }] : null);

/**
 * A new appointment's reference: one no appointment has, and no notification names. An appointment deleted on its own
 * leaves its notifications, and a new visit under its reference would count as already confirmed over LINE.
 * `random` is only for tests.
 */
export const uniqueReference = async (strapi: Core.Strapi, random: () => number = Math.random): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const reference = generateReference(random);
    const [appointments, notifications] = await Promise.all([
      strapi.documents(UID.appointment).count({ filters: { reference: { $eq: reference } } }),
      strapi.documents(UID.notification).count({ filters: { appointmentReference: { $eq: reference } } }),
    ]);
    if (appointments === 0 && notifications === 0) return reference;
  }
  throw new Error('[maison] Could not find a free appointment reference after 20 attempts.');
};

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const publishedBySlug = (uid: string, slug: string, locale: Locale) =>
    strapi.documents(uid as any).findFirst({ locale, status: 'published', filters: { slug: { $eq: slug } } }) as Promise<Doc | null>;

  /** The appointment documents among `documentIds` that have a published version, i.e. that staff confirmed. */
  const confirmedIds = async (documentIds: string[]): Promise<Set<string>> => {
    if (documentIds.length === 0) return new Set();
    const rows = await strapi.documents(UID.appointment).findMany({
      status: 'published',
      filters: { documentId: { $in: documentIds } },
      fields: ['documentId'],
      limit: documentIds.length,
    });
    return new Set(rows.map((row) => row.documentId as string));
  };

  /** documentIds of every appointment that has a published version, i.e. that staff confirmed. */
  const allConfirmedIds = async (): Promise<string[]> => {
    const rows = await strapi.documents(UID.appointment).findMany({ status: 'published', fields: ['documentId'], limit: 5000 });
    return rows.map((row) => row.documentId as string);
  };

  /** The appointment references among `references` that have a `sent` notification. */
  const sentReferences = async (references: string[]): Promise<Set<string>> => {
    if (references.length === 0) return new Set();
    const rows = await strapi.documents(UID.notification).findMany({
      filters: { outcome: { $eq: 'sent' }, appointmentReference: { $in: references } },
      fields: ['appointmentReference'],
      limit: 1000,
    });
    return new Set((rows as Doc[]).map((row) => row.appointmentReference as string));
  };

  /** slug and name per documentId in `locale`, falling back to the default locale. Published versions only. */
  const labels = async (uid: string, documentIds: string[], locale: Locale) => {
    const map = new Map<string, { slug: string; name: string }>();
    const ids = [...new Set(documentIds)];
    if (ids.length === 0) return map;
    const fallback = getConfig(strapi).defaultLocale;
    for (const loc of locale === fallback ? [locale] : [locale, fallback]) {
      const rows = await strapi.documents(uid as any).findMany({
        locale: loc,
        status: 'published',
        filters: { documentId: { $in: ids } },
        fields: ['slug', 'name'],
        limit: ids.length,
      });
      for (const row of rows as Doc[]) {
        if (!map.has(row.documentId)) map.set(row.documentId, { slug: row.slug, name: row.name });
      }
    }
    return map;
  };

  /** Draft appointment documents (populated with POPULATE) → what customers see. */
  const toViews = async (docs: Doc[], locale: Locale): Promise<AppointmentView[]> => {
    const ids = docs.map((doc) => doc.documentId as string);
    const [confirmed, sent, boutiques, products] = await Promise.all([
      confirmedIds(ids),
      sentReferences(docs.map((doc) => doc.reference as string)),
      labels(UID.boutique, docs.map((doc) => doc.boutique?.documentId).filter(Boolean), locale),
      labels(UID.product, docs.flatMap((doc) => (doc.products ?? []).map((product: Doc) => product.documentId)), locale),
    ]);
    const { timezone } = getConfig(strapi);
    return docs.map((doc) => ({
      reference: doc.reference,
      status: confirmed.has(doc.documentId) ? 'confirmed' : 'requested',
      boutique: boutiques.get(doc.boutique?.documentId) ?? { slug: doc.boutique?.slug ?? '', name: doc.boutique?.name ?? '' },
      requestedFor: toZonedIso(new Date(doc.requestedFor), timezone),
      products: (doc.products ?? []).map((product: Doc) => products.get(product.documentId) ?? { slug: product.slug, name: product.name }),
      note: doc.customerNote ?? '',
      confirmationSent: sent.has(doc.reference),
    }));
  };

  /** Drafts (populated with STAFF_POPULATE) → what staff see. A label with no published version is left out, never read from a draft. */
  const toStaffViews = async (docs: Doc[], locale: Locale): Promise<StaffAppointmentView[]> => {
    const [confirmed, sent, boutiques, products] = await Promise.all([
      confirmedIds(docs.map((doc) => doc.documentId as string)),
      sentReferences(docs.map((doc) => doc.reference as string)),
      labels(UID.boutique, docs.map((doc) => doc.boutique?.documentId).filter(Boolean), locale),
      labels(UID.product, docs.flatMap((doc) => (doc.products ?? []).map((product: Doc) => product.documentId)), locale),
    ]);
    const { timezone, demoLineUserId } = getConfig(strapi);
    return docs.map((doc) => ({
      reference: doc.reference,
      status: confirmed.has(doc.documentId) ? 'confirmed' : 'requested',
      customer: maskSubject(doc.customer),
      boutique: boutiques.get(doc.boutique?.documentId) ?? null,
      requestedFor: toZonedIso(new Date(doc.requestedFor), timezone),
      products: ((doc.products ?? []) as Doc[]).flatMap((product) => products.get(product.documentId) ?? []),
      note: doc.customerNote ?? '',
      createdVia: (CREATED_VIA as readonly string[]).includes(doc.createdVia) ? (doc.createdVia as CreatedVia) : 'app',
      confirmationSent: sent.has(doc.reference),
      demoCustomer: isDemoCustomer(doc.customer),
      yourLine: isYourLine(doc.customer, demoLineUserId),
      createdAt: toZonedIso(new Date(doc.createdAt), timezone),
    }));
  };

  /** Future requests of this customer that staff haven't confirmed yet. */
  const openRequestCount = async (subject: string, now: Date) => {
    const drafts = await strapi.documents(UID.appointment).findMany({
      status: 'draft',
      filters: { customer: { $eq: subject }, requestedFor: { $gt: now.toISOString() } },
      fields: ['documentId'],
      limit: 100,
    });
    const confirmed = await confirmedIds(drafts.map((doc) => doc.documentId as string));
    return drafts.filter((doc) => !confirmed.has(doc.documentId as string)).length;
  };

  /**
   * The references of the confirmed visits still ahead at `now`, on the drafts the board lists. Appointments aren't
   * localized, so there's one draft per confirmed documentId, and this limit never cuts the list short.
   */
  const confirmedUpcomingReferences = async (confirmed: string[], now: Date): Promise<string[]> => {
    const view = confirmedConditions(confirmed);
    if (!view) return [];
    const rows = await strapi.documents(UID.appointment).findMany({
      status: 'draft',
      filters: { $and: [...view, ahead(now)] },
      fields: ['reference'],
      limit: confirmed.length,
    });
    return (rows as Doc[]).map((row) => row.reference as string);
  };

  // `summarizeRequests` reads the board's own rows through `listRequests`, so it refers to the service by name.
  const service = {
    /** Checks, in the spec's order, then creates a draft. Nothing here can publish. */
    async request(input: AppointmentRequest): Promise<ServiceResult<AppointmentView>> {
      const { defaultLocale, timezone, maxOpenRequestsPerCustomer } = getConfig(strapi);
      const now = input.now ?? new Date();

      const boutique = await publishedBySlug(UID.boutique, input.boutique, defaultLocale);
      if (!boutique) {
        return failure('not_found', `No boutique "${input.boutique}".`, 'Call find_boutiques to find valid boutique slugs.');
      }
      const products: Doc[] = [];
      for (const slug of [...new Set(input.productSlugs)]) {
        const product = await publishedBySlug(UID.product, slug, defaultLocale);
        if (!product) {
          return failure('not_found', `No published product "${slug}".`, 'Call search_products to find valid product slugs.');
        }
        products.push(product);
      }

      const when = new Date(input.requestedFor);
      if (when.getTime() - now.getTime() < MIN_LEAD_MINUTES * 60_000) {
        return failure(
          'in_the_past',
          `The visit must start at least ${MIN_LEAD_MINUTES} minutes from now.`,
          `Ask the customer for a later time. It is now ${toZonedIso(now, timezone)}.`
        );
      }

      const hours = validateOpeningHours(boutique.openingHours);
      const check = checkOpenAt(hours.ok ? hours.hours : [], when, timezone);
      if (!check.open) {
        const day = `${DAY_NAMES[check.weekday]} ${check.isoDate}`;
        const hint = check.entry
          ? `${boutique.name} is open from ${check.entry.opens} to ${check.entry.closes} (${timezone}) on ${day}. Suggest a time in that window, or another day; find_boutiques shows hours for a date.`
          : `${boutique.name} is closed all day on ${day}. Suggest another day; find_boutiques shows hours for a date.`;
        return failure('boutique_closed', `${boutique.name} is not open at ${toZonedIso(when, timezone)}.`, hint);
      }

      if ((await openRequestCount(input.subject, now)) >= maxOpenRequestsPerCustomer) {
        return failure(
          'too_many_open_requests',
          `This customer already has ${maxOpenRequestsPerCustomer} requests waiting for a boutique to confirm.`,
          'Call my_appointments to show them. A new request is possible once one is confirmed or its time has passed.'
        );
      }

      // The customer's language names the answer's labels, and stays with the visit for its LINE confirmation.
      const language = input.locale ?? defaultLocale;
      const created = await strapi.documents(UID.appointment).create({
        data: {
          reference: await uniqueReference(strapi),
          customer: input.subject,
          boutique: { documentId: boutique.documentId, locale: defaultLocale },
          products: products.map((product) => ({ documentId: product.documentId, locale: defaultLocale })),
          requestedFor: when.toISOString(),
          customerNote: input.note ?? '',
          createdVia: input.createdVia,
          language,
        },
      });
      const saved = await strapi.documents(UID.appointment).findOne({ documentId: created.documentId, status: 'draft', populate: POPULATE });
      const [view] = await toViews([saved as Doc], language);
      return { ok: true, value: view };
    },

    /**
     * How many requests this customer has waiting for a boutique to confirm, with the visit still ahead at `now`: what
     * `request` holds against maxOpenRequestsPerCustomer. Load demo activity asks it before it gives a request to the
     * presenter's own LINE account.
     */
    countOpenRequests(subject: string, now: Date = new Date()): Promise<number> {
      return openRequestCount(subject, now);
    },

    /** The customer's own appointments, newest first. */
    async listForCustomer(subject: string, locale: Locale): Promise<AppointmentView[]> {
      const docs = await strapi.documents(UID.appointment).findMany({
        status: 'draft',
        filters: { customer: { $eq: subject } },
        sort: 'createdAt:desc',
        populate: POPULATE,
        limit: 50,
      });
      return toViews(docs as Doc[], locale);
    },

    /**
     * Appointments for staff. "requested" (the default) lists what staff can still confirm: not confirmed yet, with
     * the visit ahead, soonest visit first. "confirmed" and "all" list the newest requests first. With a `reference`
     * the status is "all": a request is found whether it is confirmed or its visit has passed, and an unknown reference
     * gives an empty list.
     */
    async listRequests(filters: RequestFilters = {}): Promise<ServiceResult<StaffAppointmentView[]>> {
      const { defaultLocale, timezone } = getConfig(strapi);
      const status = filters.reference ? 'all' : (filters.status ?? 'requested');
      const conditions: Doc[] = [];

      if (filters.boutique) {
        const boutique = await publishedBySlug(UID.boutique, filters.boutique, defaultLocale);
        if (!boutique) {
          return failure('not_found', `No boutique "${filters.boutique}".`, 'Call find_boutiques to find valid boutique slugs.');
        }
        conditions.push({ boutique: { documentId: { $eq: boutique.documentId } } });
      }
      if (filters.reference) conditions.push({ reference: { $eq: filters.reference } });
      if (filters.date) {
        const { start, end } = zonedDayRange(filters.date, timezone);
        conditions.push({ requestedFor: { $gte: start.toISOString(), $lt: end.toISOString() } });
      }
      if (status !== 'all') {
        const confirmed = await allConfirmedIds();
        const view = status === 'confirmed' ? confirmedConditions(confirmed) : requestedConditions(confirmed, filters.now ?? new Date());
        if (!view) return { ok: true, value: [] };
        conditions.push(...view);
      }

      const docs = await strapi.documents(UID.appointment).findMany({
        status: 'draft',
        filters: conditions.length > 0 ? { $and: conditions } : {},
        sort: status === 'requested' ? 'requestedFor:asc' : 'createdAt:desc',
        populate: STAFF_POPULATE,
        limit: filters.limit ?? 20,
      });
      return { ok: true, value: await toStaffViews(docs as Doc[], filters.locale ?? defaultLocale) };
    },

    /**
     * Staff confirmation: publishes the draft, the same as Publish in the Content Manager. Confirming twice is safe.
     * Publishing sends the customer's LINE confirmation (document-middleware.ts) before it returns, so the answer's
     * confirmationSent already says whether it went out. Confirming again publishes nothing, so it sends nothing.
     */
    async confirm(reference: string, now: Date = new Date()): Promise<ServiceResult<ConfirmedAppointment>> {
      const { defaultLocale, timezone } = getConfig(strapi);
      const draft = (await strapi.documents(UID.appointment).findFirst({
        status: 'draft',
        filters: { reference: { $eq: reference } },
        fields: ['documentId', 'requestedFor'],
      })) as Doc | null;
      if (!draft) {
        return failure('not_found', `No appointment ${reference}.`, 'Use a reference from appointment_requests.');
      }

      const alreadyConfirmed = (await confirmedIds([draft.documentId])).size > 0;
      if (!alreadyConfirmed) {
        const when = new Date(draft.requestedFor);
        if (when.getTime() < now.getTime()) {
          return failure(
            'in_the_past',
            `The visit for ${reference} was at ${toZonedIso(when, timezone)}, which has passed.`,
            "A past visit can't be confirmed. Ask the customer to request a new time."
          );
        }
        await strapi.documents(UID.appointment).publish({ documentId: draft.documentId });
      }

      const saved = await strapi.documents(UID.appointment).findOne({ documentId: draft.documentId, status: 'draft', populate: STAFF_POPULATE });
      const [appointment] = await toStaffViews([saved as Doc], defaultLocale);
      return { ok: true, value: { appointment, alreadyConfirmed } };
    },

    /**
     * The numbers and rows behind the admin homepage's "Maison requests" widget. The counts use the board's own
     * conditions, on the drafts the board lists, and follow one pipeline of visits still ahead: "waiting" is its
     * "requested" view, "confirmed, upcoming" is its "confirmed" view with the past visits left out, and "LINE sent"
     * counts those confirmed upcoming rows with `confirmationSent`. Only their `sent` notifications are read.
     * The rows are the board's "All requests" rows, so they are masked, ordered and labelled the way the board has them.
     * They leave out the products and how the request was made.
     * `now` is only for tests. It defaults to the current time.
     */
    async summarizeRequests(now: Date = new Date()): Promise<RequestsSummary> {
      const confirmed = await allConfirmedIds();
      const [waitingForStaff, upcoming, newest] = await Promise.all([
        strapi.documents(UID.appointment).count({ status: 'draft', filters: { $and: requestedConditions(confirmed, now) } }),
        confirmedUpcomingReferences(confirmed, now),
        service.listRequests({ status: 'all', limit: RECENT_REQUESTS, now }),
      ]);
      // Only an unknown boutique filter can fail, and there is none here.
      if (newest.ok === false) throw new Error(`[maison] The newest requests could not be listed: ${newest.message}`);
      const sent = await sentReferences(upcoming);

      return {
        counts: { waitingForStaff, confirmedUpcoming: upcoming.length, confirmationsSent: sent.size },
        recent: newest.value.map(({ reference, status, customer, boutique, requestedFor, note, confirmationSent, demoCustomer, yourLine, createdAt }) => ({
          reference, status, customer, boutique, requestedFor, note, confirmationSent, demoCustomer, yourLine, createdAt,
        })),
      };
    },
  };
  return service;
};
