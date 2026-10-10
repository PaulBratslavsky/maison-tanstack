import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import seed from '../../seed/activity.json';
import { getConfig } from '../config';
import { UID } from '../constants';
import {
  HAND_OFF_LOGGED_AFTER_MS,
  VISIT_DAYS,
  assignActivity,
  demoActivityLoaded,
  hoursBefore,
  inStockAt,
  inquiryLabels,
  piecesAt,
  visitTime,
  type ActivitySeed,
  type Assigned,
  type SeedAppointment,
  type SeedInquiry,
  type SeedQuestion,
  type StockLevel,
} from '../domain/demo-activity';
import { validateOpeningHours } from '../domain/hours';
import { getDisplayName } from '../domain/line-push';
import { failure, type ServiceResult } from '../domain/service-result';
import { lineUserIdOf } from '../domain/subject';
import { asSentence } from '../domain/text';
import { inBackground } from './background';
import { uniqueQuestionReference } from './questions';

/*
 * Load demo activity, for the seed service. It is no service of its own: `services/index.ts` doesn't register it.
 */

type Doc = Record<string, any>;

const activity = seed as ActivitySeed;

/** What Load demo activity added. All zeros, with `created` false, when the demo activity was there already. */
export interface ActivityResult {
  created: boolean;
  customers: number;
  appointments: number;
  /** Of those requests, the ones confirmed. */
  confirmed: number;
  questions: number;
  inquiries: number;
}

/** What a press answers when it starts a load: the rows it will add, in the background. */
export interface ActivityCounts {
  appointments: number;
  questions: number;
  inquiries: number;
}

/**
 * What a press of Load demo activity did: started the load in the background, with the counts it will add and `done`,
 * which settles when it has ended (for tests, and for loadDemoActivity), or found it there already, with `result`.
 */
export type ActivityStart =
  | { started: true; counts: ActivityCounts; done: Promise<ActivityResult> }
  | { started: false; result: ActivityResult };

const NOTHING_ADDED: ActivityResult = { created: false, customers: 0, appointments: 0, confirmed: 0, questions: 0, inquiries: 0 };

const LOAD_CATALOG = 'Press Load demo catalog, then Load demo activity again.';
const ALREADY_LOADING = 'Demo activity is still loading from the last press: the lists fill in over the next few seconds.';

/**
 * True from a press until the load it started has ended, whether it finished or failed. Module-level, so every press in
 * this Strapi process sees it, whatever service instance it goes through.
 */
let loading = false;

/** A visit ready to request: what the seed says, who for, and the time and pieces the boutique's hours and stock allow. */
interface PlannedVisit extends Assigned<SeedAppointment> {
  requestedFor: Date;
  pieces: string[];
}

/** Everything a load will write, worked out before anything is written. */
interface PlannedActivity {
  visits: PlannedVisit[];
  questions: Array<Assigned<SeedQuestion>>;
  inquiries: Array<Assigned<SeedInquiry>>;
}

const customerOf = (key: string) => {
  const customer = activity.customers.find((candidate) => candidate.key === key);
  if (!customer) throw new Error(`activity.json names no customer "${key}".`);
  return customer;
};

/**
 * Sets when a seeded row came in. Strapi stamps createdAt with the current time as it creates a row, so the seed's time is
 * written afterwards, through the query engine, to every row that matches `where`: for a confirmed visit, its draft and
 * its published version.
 */
const setReceived = (strapi: Core.Strapi, uid: string, where: Doc, createdAt: Date) =>
  strapi.db.query(uid as any).updateMany({ where, data: { createdAt } });

/**
 * Each seeded visit's time and pieces, from the boutiques' hours and stock as they are now, before anything is written.
 * A boutique that isn't published, is open on no day of the window, or has no published piece in stock is `not_found` or
 * `boutique_closed`, and nothing is added.
 */
const planVisits = async (
  strapi: Core.Strapi,
  visits: Array<Assigned<SeedAppointment>>,
  now: Date
): Promise<ServiceResult<PlannedVisit[]>> => {
  const { defaultLocale, timezone } = getConfig(strapi);
  const boutiqueSlugs = [...new Set(visits.map(({ item }) => item.boutique))];
  const [boutiques, products, stock] = (await Promise.all([
    strapi.documents(UID.boutique).findMany({
      locale: defaultLocale,
      status: 'published',
      filters: { slug: { $in: boutiqueSlugs } },
      fields: ['slug', 'openingHours'],
      limit: boutiqueSlugs.length,
    }),
    strapi.documents(UID.product).findMany({ locale: defaultLocale, status: 'published', fields: ['slug'], limit: 1000 }),
    strapi.documents(UID.stockLevel).findMany({
      filters: { boutiqueSlug: { $in: boutiqueSlugs }, quantity: { $gt: 0 } },
      fields: ['productSlug', 'boutiqueSlug', 'quantity'],
      limit: 5000,
    }),
  ])) as [Doc[], Doc[], Doc[]];
  const published = products.map((product) => product.slug as string);
  const levels = stock as StockLevel[];

  const plans: PlannedVisit[] = [];
  for (const assigned of visits) {
    const visit = assigned.item;
    const boutique = boutiques.find((candidate) => candidate.slug === visit.boutique);
    if (!boutique) {
      return failure('not_found', `Load demo catalog first: there's no published boutique "${visit.boutique}".`, LOAD_CATALOG);
    }
    const hours = validateOpeningHours(boutique.openingHours);
    const requestedFor = visitTime({ daysAhead: visit.daysAhead, time: visit.time, hours: hours.ok ? hours.hours : [], now, timezone });
    if (!requestedFor) {
      return failure(
        'boutique_closed',
        `The boutique "${visit.boutique}" isn't open on any day from ${VISIT_DAYS.first} to ${VISIT_DAYS.last} days from now.`,
        'Check its opening hours in the Content Manager, then press Load demo activity again.'
      );
    }
    const pieces = piecesAt(visit.pieces, inStockAt(levels, visit.boutique, published));
    if (pieces.length === 0) {
      return failure(
        'not_found',
        `The boutique "${visit.boutique}" has no published piece in stock.`,
        'Give it stock of a published piece in the Content Manager, then press Load demo activity again.'
      );
    }
    plans.push({ ...assigned, requestedFor, pieces });
  }
  return { ok: true, value: plans };
};

/**
 * What a press will write, or null when the demo activity is there already: any appointment, question or inquiry of
 * the five made-up customers. Only theirs count, so nobody else's activity, the presenter's own included, ever stops a
 * load or is touched. With demoLineUserId set, the items marked "you" go to that account, unless it has as many open
 * requests as a customer may have: its request then stays with the made-up customer, and the log says so. It only reads.
 */
const planDemoActivity = async (strapi: Core.Strapi, now: Date): Promise<ServiceResult<PlannedActivity | null>> => {
  const theirs = { filters: { customer: { $in: activity.customers.map((customer) => customer.subject) } } };
  const [appointments, questions, inquiries] = await Promise.all([
    strapi.documents(UID.appointment).count(theirs),
    strapi.documents(UID.question).count(theirs),
    strapi.documents(UID.inquiry).count(theirs),
  ]);
  if (demoActivityLoaded({ appointments, questions, inquiries })) return { ok: true, value: null };

  const { demoLineUserId, maxOpenRequestsPerCustomer } = getConfig(strapi);
  const you = demoLineUserId ? `line:${demoLineUserId}` : null;
  let youCanRequest = true;
  if (you) {
    const open = await strapi.plugin('maison').service('appointments').countOpenRequests(you, now);
    youCanRequest = open < maxOpenRequestsPerCustomer;
    if (!youCanRequest) {
      // Never the account's ID: only the setting's name.
      strapi.log.warn(
        `[maison] Your demo LINE account (MAISON_DEMO_LINE_USER_ID) already has ${open} open requests, so its request went to a made-up customer.`
      );
    }
  }
  const assigned = assignActivity(activity, { you, youCanRequest });

  const visits = await planVisits(strapi, assigned.appointments, now);
  if (visits.ok === false) return visits;
  return { ok: true, value: { visits: visits.value, questions: assigned.questions, inquiries: assigned.inquiries } };
};

/**
 * Requests each visit as its customer would, through the appointments service, so the board's own rules accept it and
 * it gets a reference from the same generator. A confirmed one is then confirmed as the board's Confirm does it: the
 * publish runs the LINE confirmation, which records `demo` for a made-up customer without calling LINE. One visit after
 * another: a request, its confirmation, then when it came in.
 */
const requestVisits = async (strapi: Core.Strapi, plans: PlannedVisit[], now: Date): Promise<void> => {
  const appointments = strapi.plugin('maison').service('appointments');
  for (const { item: visit, subject, requestedFor, pieces } of plans) {
    const requested = await appointments.request({
      subject,
      boutique: visit.boutique,
      productSlugs: pieces,
      requestedFor: requestedFor.toISOString(),
      ...(visit.note ? { note: visit.note } : {}),
      createdVia: visit.createdVia,
      locale: visit.language,
      now,
    });
    if (requested.ok === false) throw new Error(requested.message);
    const { reference } = requested.value;
    if (visit.confirmed) {
      const confirmed = await appointments.confirm(reference, now);
      if (confirmed.ok === false) throw new Error(confirmed.message);
    }
    await setReceived(strapi, UID.appointment, { reference }, hoursBefore(now, visit.hoursAgo));
  }
};

/**
 * The name staff see on a question: the made-up customer's, or for the presenter's own account the display name LINE
 * gives, as a hand-off asks for it. Null without a token, or an answer from LINE.
 */
const customerNameOf = async (strapi: Core.Strapi, { item, subject, yours }: Assigned<SeedQuestion>): Promise<string | null> => {
  if (!yours) return customerOf(item.customer).name;
  const { lineChannelAccessToken: token, lineApiBaseUrl } = getConfig(strapi);
  return token ? getDisplayName({ apiBaseUrl: lineApiBaseUrl, token }, lineUserIdOf(subject)) : null;
};

/**
 * Records a question as the concierge's hand-off does, as far along as the seed says: taken, or answered. Nothing went to
 * the customer on LINE, so no LINE outcome is written, and an answer never becomes product knowledge. Then the
 * concierge's turn that handed it off is logged, linked to it, as the app logs it a moment later. The answered
 * question's inquiry is replied, with the answer, as answering a question marks it.
 */
const recordQuestion = async (strapi: Core.Strapi, assigned: Assigned<SeedQuestion>, now: Date): Promise<void> => {
  const { item: question, subject } = assigned;
  const reference = await uniqueQuestionReference(strapi);
  const asked = hoursBefore(now, question.hoursAgo);
  const answeredAt = question.status === 'answered' ? hoursBefore(now, question.answeredHoursAgo ?? 0) : null;
  const created = await strapi.documents(UID.question).create({
    data: {
      reference,
      customer: subject,
      customerName: await customerNameOf(strapi, assigned),
      question: question.question,
      reason: question.reason,
      language: question.language,
      productSlug: question.productSlug ?? null,
      status: question.status,
      ...(question.status === 'taken' ? { staffName: question.staffName, takenAt: hoursBefore(now, question.takenHoursAgo ?? 0) } : {}),
      ...(question.status === 'answered' ? { staffName: question.staffName, answer: question.answer, answeredAt } : {}),
    },
  });
  await setReceived(strapi, UID.question, { documentId: created.documentId }, asked);

  const handOff = await strapi.documents(UID.inquiry).create({
    data: {
      customer: subject,
      message: question.question,
      reply: question.handOff.reply,
      language: question.language,
      knowledgeFound: false,
      handedOff: true,
      questionReference: reference,
      productSlug: question.productSlug ?? null,
      via: 'concierge',
      ...inquiryLabels(question.handOff.labels, true),
      status: answeredAt ? 'replied' : 'open',
      ...(answeredAt ? { replyText: question.answer, repliedAt: answeredAt, repliedBy: question.staffName } : {}),
    },
  });
  await setReceived(strapi, UID.inquiry, { documentId: handOff.documentId }, new Date(asked.getTime() + HAND_OFF_LOGGED_AFTER_MS));
};

/**
 * The questions one after another, each with its hand-off. One at a time keeps each new reference unique:
 * uniqueQuestionReference checks the database, and the question before has been written by then. The chain is shorter
 * than the visits', so running the questions side by side would not make the load end sooner.
 */
const recordQuestions = async (strapi: Core.Strapi, questions: Array<Assigned<SeedQuestion>>, now: Date): Promise<void> => {
  for (const question of questions) await recordQuestion(strapi, question, now);
};

/** Logs a concierge turn that handed nothing off, labelled as the seed says, or pending for the labelling sweep. */
const logInquiry = async (strapi: Core.Strapi, { item: inquiry, subject }: Assigned<SeedInquiry>, now: Date): Promise<void> => {
  const created = await strapi.documents(UID.inquiry).create({
    data: {
      customer: subject,
      message: inquiry.message,
      reply: inquiry.reply,
      language: inquiry.language,
      knowledgeFound: inquiry.knowledgeFound,
      handedOff: false,
      productSlug: inquiry.productSlug,
      via: 'concierge',
      ...inquiryLabels(inquiry.labels, false),
      status: 'open',
    },
  });
  await setReceived(strapi, UID.inquiry, { documentId: created.documentId }, hoursBefore(now, inquiry.hoursAgo));
};

/** The standalone turns one after another, in the seed's order. */
const logInquiries = async (strapi: Core.Strapi, inquiries: Array<Assigned<SeedInquiry>>, now: Date): Promise<void> => {
  for (const inquiry of inquiries) await logInquiry(strapi, inquiry, now);
};

/** The message that says a load stopped partway, and what to do. */
const stoppedPartway = (error: unknown): string =>
  `Loading the demo activity stopped partway: ${asSentence(String((error as Error)?.message ?? error))} Press Reset demo activity, then Load demo activity again.`;

/**
 * The writes of a load. The three groups don't depend on each other, so they run side by side: the visits (each request,
 * its confirmation, then when it came in), the questions (each with its hand-off), and the standalone inquiries. Inside
 * each, the order stays. It waits for all three to end, so the button's flag is cleared only when nothing is writing
 * any more, then fails with the first failure, which says to reset.
 */
const writeDemoActivity = async (strapi: Core.Strapi, plan: PlannedActivity, now: Date): Promise<ActivityResult> => {
  const ended = await Promise.allSettled([
    requestVisits(strapi, plan.visits, now),
    recordQuestions(strapi, plan.questions, now),
    logInquiries(strapi, plan.inquiries, now),
  ]);
  const stopped = ended.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
  if (stopped) throw new errors.ApplicationError(stoppedPartway(stopped.reason));
  return {
    created: true,
    customers: activity.customers.length,
    appointments: plan.visits.length,
    confirmed: plan.visits.filter(({ item }) => item.confirmed).length,
    questions: plan.questions.length,
    inquiries: plan.questions.length + plan.inquiries.length,
  };
};

/** What the log says once a load has finished: the counts, and how many items went to the presenter's own account. */
const loadedLine = (result: ActivityResult, plan: PlannedActivity): string => {
  const yours = [...plan.visits, ...plan.questions, ...plan.inquiries].filter((entry) => entry.yours).length;
  const owner = yours > 0 ? `, ${yours} of them for your demo LINE account` : '';
  return `[maison] Loaded demo activity: ${result.appointments} requests (${result.confirmed} confirmed), ${result.questions} questions and ${result.inquiries} inquiries${owner}.`;
};

/**
 * A press of Load demo activity: five made-up customers' visit requests, questions and inquiries, received over the last
 * three days (server/seed/activity.json), and with demoLineUserId set, three of them for the presenter's own LINE account.
 *
 * It first reads what it needs (planDemoActivity), so "load the catalog first" and the like still come back on the
 * press, as does `started: false` when the demo activity is there already. Then it starts the writes in the background
 * and answers at once, with the counts it will add. A failure there is logged as an error that says to reset, and never
 * escapes. A press while a load is running, planning included, is `already_loading`, and starts nothing.
 * `now` is only for tests. It defaults to the current time.
 */
export const startDemoActivity = async (strapi: Core.Strapi, now: Date = new Date()): Promise<ServiceResult<ActivityStart>> => {
  if (loading) return failure('already_loading', ALREADY_LOADING, 'Wait for it to finish. Press Reset demo activity first to load it again.');
  // Set before anything is awaited, so a second press in the same moment finds it set.
  loading = true;
  let handedOver = false;
  try {
    const planned = await planDemoActivity(strapi, now);
    if (planned.ok === false) return planned;
    const plan = planned.value;
    if (plan === null) return { ok: true, value: { started: false, result: NOTHING_ADDED } };

    const done = inBackground(() => writeDemoActivity(strapi, plan, now), {
      release: () => {
        loading = false;
      },
      finished: (result) => strapi.log.info(loadedLine(result, plan)),
      failed: (error) => strapi.log.error(`[maison] ${error instanceof errors.ApplicationError ? error.message : stoppedPartway(error)}`),
    });
    handedOver = true;
    const counts = { appointments: plan.visits.length, questions: plan.questions.length, inquiries: plan.questions.length + plan.inquiries.length };
    return { ok: true, value: { started: true, counts, done } };
  } finally {
    // Nothing was started: the next press may plan afresh. Once the writes have started, they clear it when they end.
    if (!handedOver) loading = false;
  }
};

/**
 * Load demo activity, waiting for it to end: what it added, or all zeros when it was there already. A failure partway
 * rejects with the message that says to reset. Tests and the integration suites use it; the route uses startDemoActivity.
 */
export const loadDemoActivity = async (strapi: Core.Strapi, now: Date = new Date()): Promise<ServiceResult<ActivityResult>> => {
  const started = await startDemoActivity(strapi, now);
  if (started.ok === false) return started;
  // `=== false`, not `!started`: this project doesn't compile in strict mode, where only a comparison narrows the union.
  const { value } = started;
  return { ok: true, value: value.started === false ? value.result : await value.done };
};
