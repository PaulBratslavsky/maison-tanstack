import seed from '../../seed/activity.json';
import type { AnalysisStatus, CreatedVia, InquiryKind, InquiryQueue, Locale, QuestionReason, SentimentLabel } from '../constants';
import { checkOpenAt, hoursForDate, toMinutes, zonedParts, type OpeningHoursEntry } from './hours';
import { sentimentLabelOf } from './inquiry-criteria';
import { queueFor } from './inquiry-queue';
import { zonedDayRange } from './time';

/*
 * The rules behind Load demo activity, as pure functions, and who its made-up customers are. What it adds is data, in
 * server/seed/activity.json, typed by ActivitySeed below.
 */

/** A made-up customer of the demo: a fixed, clearly fake LINE subject, and the display name staff see. */
export interface SeedCustomer {
  key: string;
  subject: string;
  name: string;
}

/**
 * An item marked `"owner": "you"` goes to the presenter's own LINE account when the plugin's demoLineUserId is set, in
 * place of its made-up customer.
 */
export type SeedOwner = 'you';

/** A visit request: when, as days ahead and a Tokyo time, and the pieces it wants, before the boutique's stock is read. */
export interface SeedAppointment {
  customer: string;
  boutique: string;
  pieces: string[];
  daysAhead: number;
  time: string;
  language: Locale;
  createdVia: CreatedVia;
  note: string | null;
  confirmed: boolean;
  hoursAgo: number;
  owner?: SeedOwner;
}

/** Labels as the model gives them. The sentiment label, the queue and the rest follow from them (inquiryLabels). */
export interface SeedLabels {
  kind: InquiryKind;
  sentimentScore: number;
  answered: boolean;
  reason: string;
  topic: string;
}

/** A question the concierge handed to staff, how far staff have got with it, and the concierge's turn that handed it off. */
export interface SeedQuestion {
  customer: string;
  question: string;
  reason: QuestionReason;
  language: Locale;
  productSlug?: string;
  status: 'open' | 'taken' | 'answered';
  staffName?: string;
  takenHoursAgo?: number;
  answer?: string;
  answeredHoursAgo?: number;
  hoursAgo: number;
  handOff: { reply: string; labels: SeedLabels };
  owner?: SeedOwner;
}

/** A concierge turn that handed nothing off. `labels` is null for one the labelling sweep should label. */
export interface SeedInquiry {
  customer: string;
  message: string;
  reply: string;
  language: Locale;
  productSlug: string | null;
  knowledgeFound: boolean;
  hoursAgo: number;
  labels: SeedLabels | null;
  owner?: SeedOwner;
}

export interface ActivitySeed {
  customers: SeedCustomer[];
  appointments: SeedAppointment[];
  questions: SeedQuestion[];
  inquiries: SeedInquiry[];
}

/** A demo visit is booked this many days after the day the button is pressed, on Tokyo's calendar: at least `first`, at most `last`. */
export const VISIT_DAYS = { first: 2, last: 13 } as const;

/** Every seeded row came in less than this many hours before the button was pressed. */
export const RECEIVED_WITHIN_HOURS = 72;

/** The app logs a concierge turn once its reply is written, so a hand-off's inquiry comes in this long after its question. */
export const HAND_OFF_LOGGED_AFTER_MS = 15_000;

/** Seeded labels say where they came from, and name no prompt version, so nobody takes them for a model's. */
export const DEMO_MODEL_VERSION = 'demo-seed';

/** Visits start on the hour or the half-hour, and a whole one fits before closing. */
const SLOT_MINUTES = 30;
const VISIT_MINUTES = 30;
const HOUR_MS = 60 * 60 * 1000;

/** `isoDate` (YYYY-MM-DD) moved by `days`. */
const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** The days ahead to try, in order: the one asked for, kept inside the window, then each later one, then each earlier one. */
const daysToTry = (daysAhead: number): number[] => {
  const asked = Math.min(Math.max(Math.round(daysAhead), VISIT_DAYS.first), VISIT_DAYS.last);
  const days: number[] = [];
  for (let day = asked; day <= VISIT_DAYS.last; day += 1) days.push(day);
  for (let day = asked - 1; day >= VISIT_DAYS.first; day -= 1) days.push(day);
  return days;
};

/**
 * The half-hour on a day's hours nearest to `preferred` (minutes since midnight), with a whole visit before closing, or
 * null when the day has none.
 */
const halfHourWithin = (entry: OpeningHoursEntry, preferred: number): number | null => {
  const first = Math.ceil(toMinutes(entry.opens) / SLOT_MINUTES) * SLOT_MINUTES;
  const last = Math.floor((toMinutes(entry.closes) - VISIT_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES;
  if (first > last) return null;
  return Math.min(Math.max(Math.round(preferred / SLOT_MINUTES) * SLOT_MINUTES, first), last);
};

export interface VisitPlan {
  daysAhead: number;
  /** HH:MM in `timezone`. */
  time: string;
  hours: OpeningHoursEntry[];
  now: Date;
  timezone: string;
}

/**
 * When a demo visit is: `daysAhead` days after today in `timezone` (kept between VISIT_DAYS.first and VISIT_DAYS.last), at
 * the half-hour nearest to `time` that leaves a whole visit inside the boutique's hours. A day the boutique is closed, or
 * has no such half-hour, gives way to the next day, and at the end of the window to the day before. Null when the
 * boutique is open on no day of the window.
 */
export const visitTime = ({ daysAhead, time, hours, now, timezone }: VisitPlan): Date | null => {
  const today = zonedParts(now, timezone).isoDate;
  for (const days of daysToTry(daysAhead)) {
    const isoDate = addDays(today, days);
    const entry = hoursForDate(hours, isoDate);
    const minutes = entry ? halfHourWithin(entry, toMinutes(time)) : null;
    if (minutes === null) continue;
    const at = new Date(zonedDayRange(isoDate, timezone).start.getTime() + minutes * 60_000);
    if (checkOpenAt(hours, at, timezone).open) return at;
  }
  return null;
};

export interface StockLevel {
  productSlug: string;
  boutiqueSlug: string;
  quantity: number;
}

/** The published pieces a boutique has at least one of, in slug order. */
export const inStockAt = (levels: StockLevel[], boutique: string, published: string[]): string[] =>
  [
    ...new Set(
      levels
        .filter((level) => level.boutiqueSlug === boutique && level.quantity > 0 && published.includes(level.productSlug))
        .map((level) => level.productSlug)
    ),
  ].sort();

/** The pieces a demo visit is for: the ones it wants that the boutique has, or else the first piece the boutique has. Empty when it has none. */
export const piecesAt = (wanted: string[], inStock: string[]): string[] => {
  const stocked = wanted.filter((slug) => inStock.includes(slug));
  return stocked.length > 0 ? stocked : inStock.slice(0, 1);
};

export interface LabelFields {
  kind?: InquiryKind;
  sentimentScore?: number;
  sentimentLabel?: SentimentLabel;
  answered?: boolean;
  reason?: string;
  topic?: string;
  modelVersion?: string;
  analysisStatus: AnalysisStatus;
  analysisAttempts: number;
  queue: InquiryQueue;
}

/**
 * What a seeded inquiry's labels write. Labels come with the sentiment label their score gives, `analyzed`, no attempts,
 * DEMO_MODEL_VERSION and no prompt version, in the queue queueFor gives, never one of the seed's own. With none, the
 * inquiry is pending, as a logged turn is, and the labelling sweep labels it.
 */
export const inquiryLabels = (labels: SeedLabels | null, handedOff: boolean): LabelFields =>
  labels
    ? {
        ...labels,
        sentimentLabel: sentimentLabelOf(labels.sentimentScore),
        analysisStatus: 'analyzed',
        analysisAttempts: 0,
        modelVersion: DEMO_MODEL_VERSION,
        queue: queueFor({ handedOff, kind: labels.kind, answered: labels.answered }),
      }
    : { analysisStatus: 'pending', analysisAttempts: 0, queue: queueFor({ handedOff, kind: null, answered: null }) };

/** How many rows the demo customers have of each kind. */
export interface DemoActivityCounts {
  appointments: number;
  questions: number;
  inquiries: number;
}

/** Whether the demo activity is there: any appointment, question or inquiry of a demo customer, which stops it being added again. */
export const demoActivityLoaded = ({ appointments, questions, inquiries }: DemoActivityCounts): boolean =>
  appointments > 0 || questions > 0 || inquiries > 0;

/** `hours` hours before `now`. */
export const hoursBefore = (now: Date, hours: number): Date => new Date(now.getTime() - hours * HOUR_MS);

/** The subjects of Load demo activity's five made-up customers, from activity.json. */
const DEMO_SUBJECTS: ReadonlySet<string> = new Set((seed as ActivitySeed).customers.map((customer) => customer.subject));

/**
 * Whether `subject` is one of Load demo activity's made-up customers (activity.json's `customers`). Their LINE user IDs
 * are made up, so LINE refuses every message to them: Strapi sends them nothing, and records the outcome `demo`.
 */
export const isDemoCustomer = (subject: unknown): boolean => typeof subject === 'string' && DEMO_SUBJECTS.has(subject);

/**
 * Whether `subject` is the presenter's own LINE account: `demoLineUserId` is set, and `subject` is `line:` followed by
 * exactly that ID. Replying, answering or confirming for it sends real LINE messages, so staff see a "Your LINE" label
 * on its rows. It is never a made-up customer's subject. It does not accept an ID alone, another case or spacing.
 */
export const isYourLine = (subject: unknown, demoLineUserId: string | null): boolean =>
  typeof demoLineUserId === 'string' && demoLineUserId !== '' && subject === `line:${demoLineUserId}`;

/** Who gets the items marked `"owner": "you"`. */
export interface ActivityOwners {
  /** The presenter's own LINE account as a subject (`line:U…`), from demoLineUserId, or null when that isn't set. */
  you: string | null;
  /** False when that account has as many open requests as a customer may have: its request then stays with the made-up customer. */
  youCanRequest: boolean;
}

/** A seed item, and who it is for: `subject`, and whether that is the presenter's own account. */
export interface Assigned<T> {
  item: T;
  subject: string;
  yours: boolean;
}

export interface AssignedActivity {
  appointments: Array<Assigned<SeedAppointment>>;
  questions: Array<Assigned<SeedQuestion>>;
  inquiries: Array<Assigned<SeedInquiry>>;
}

/**
 * Who each item of the seed is for, in the seed's order. An item marked `"owner": "you"` is the presenter's when
 * `owners.you` is set (and, for a request, when `owners.youCanRequest`). Every other item is its made-up customer's.
 * Throws for an item whose customer the seed doesn't name.
 */
export const assignActivity = (activity: ActivitySeed, { you, youCanRequest }: ActivityOwners): AssignedActivity => {
  const subjectOf = (key: string): string => {
    const customer = activity.customers.find((candidate) => candidate.key === key);
    if (!customer) throw new Error(`activity.json names no customer "${key}".`);
    return customer.subject;
  };
  const assign = <T extends { customer: string; owner?: SeedOwner }>(items: T[], youMay: boolean): Array<Assigned<T>> =>
    items.map((item) => {
      const yours = you !== null && youMay && item.owner === 'you';
      return { item, subject: yours ? (you as string) : subjectOf(item.customer), yours };
    });
  return {
    appointments: assign(activity.appointments, youCanRequest),
    questions: assign(activity.questions, true),
    inquiries: assign(activity.inquiries, true),
  };
};
