import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import {
  INQUIRY_FILTERS,
  INQUIRY_KINDS,
  UID,
  type AnalysisStatus,
  type CloseReason,
  type InquiryFilter,
  type InquiryKind,
  type InquiryQueue,
  type InquiryStatus,
  type Locale,
  type QuestionStatus,
  type SentimentLabel,
} from '../constants';
import { isDemoCustomer, isYourLine } from '../domain/demo-activity';
import { isRealIsoDate } from '../domain/hours';
import { queueFor } from '../domain/inquiry-queue';
import { inquiryReplyText } from '../domain/inquiry-replies';
import { DEMO_DETAIL, NO_TOKEN, lineDetailOf, reasonOf } from '../domain/line-outcome';
import { getMonthlyUsage, pushMessages, type MonthlyUsage } from '../domain/line-push';
import { failure, type ServiceResult } from '../domain/service-result';
import { lineUserIdOf, maskSubject } from '../domain/subject';
import { fitLines } from '../domain/text';
import { isoOrNull, zonedDayRange } from '../domain/time';
import { productNamed, rememberProductNames } from './product-names';

type Doc = Record<string, any>;

/** One concierge turn, as the app's server logs it. */
export interface InquiryLogInput {
  subject: string;
  message: string;
  reply?: string;
  knowledgeFound: boolean;
  handedOff: boolean;
  /** The question the turn's hand-off recorded. It is stored only when it is this customer's. */
  questionReference?: string;
  productSlug?: string;
  /** The chat's language. Defaults to defaultLocale. */
  locale?: Locale;
}

/** An inquiry as staff see it: the customer masked, with the model's labels, and what staff did about it. */
export interface StaffInquiryView {
  documentId: string;
  createdAt: string;
  customer: string;
  message: string;
  reply: string | null;
  language: Locale;
  product: { slug: string; name: string } | null;
  knowledgeFound: boolean;
  handedOff: boolean;
  /** The question a hand-off recorded. Its status is null when that question no longer exists. */
  question: { reference: string; status: QuestionStatus | null } | null;
  kind: InquiryKind | null;
  sentimentScore: number | null;
  sentimentLabel: SentimentLabel | null;
  answered: boolean | null;
  reason: string | null;
  topic: string | null;
  analysisStatus: AnalysisStatus;
  analysisAttempts: number;
  humanCorrected: boolean;
  queue: InquiryQueue;
  status: InquiryStatus;
  closeReason: CloseReason | null;
  replyText: string | null;
  repliedAt: string | null;
  repliedBy: string | null;
  /** How the last LINE message went: `demo` for a made-up demo customer, who gets none. */
  line: { outcome: 'sent' | 'failed' | 'demo'; detail: string | null } | null;
  /**
   * The presenter's own LINE account (the plugin's demoLineUserId): Reply on LINE sends a real LINE message to the
   * presenter. The list shows a "Your LINE" label. Never the ID itself.
   */
  yourLine: boolean;
}

export interface InquiryFilters {
  /** needs-answer, the default: the Inquiries tab opens on it. */
  filter?: InquiryFilter;
  limit?: number;
  /** Only inquiries that came in on or after this day (YYYY-MM-DD), a day in the plugin's time zone. */
  since?: string;
  /** Only inquiries of this kind, as well as the filter's own conditions: All with a kind lists replied and closed ones too. */
  kind?: InquiryKind;
}

/** The open inquiries in each queue, and the open ones nobody has labelled. */
export interface InquirySummary {
  needsAnswer: number;
  complaint: number;
  praise: number;
  notLabelled: number;
}

/** What the quota route answers: whether Strapi can message customers at all, and this month's messages on the channel. */
export interface InquiryQuota extends MonthlyUsage {
  /** False without a channel access token: a reply can't be sent, and `used` and `limit` are null. */
  configured: boolean;
}

/**
 * What became of Reply on LINE:
 * - `sent`: LINE took the message, and the inquiry says so. With `warning`, recording it failed, and `message` says so.
 * - `demo`: the customer is one of Load demo activity's made-up customers. Nothing went to LINE, the inquiry is replied
 *   all the same, and records `demo`.
 * - `failed`: LINE refused it or didn't answer. The inquiry records why, and stays open.
 * - `not_found`, `already_closed`, `already_replied`: nothing was sent.
 * - `use_question`: the inquiry is a hand-off, which is answered under Questions. Nothing was sent.
 * - `not_configured`: there's no channel access token. Nothing was sent or recorded.
 */
export type InquiryReplyStatus =
  | 'sent'
  | 'demo'
  | 'not_found'
  | 'already_closed'
  | 'already_replied'
  | 'use_question'
  | 'failed'
  | 'not_configured';

export interface InquiryReplyOutcome {
  documentId: string;
  status: InquiryReplyStatus;
  /** What happened, in words staff can read. Never the token. */
  message: string;
  /** The customer has the reply, but recording it failed, and `message` says so: staff should read it, not just see a success. */
  warning?: true;
}

/** What the inquiry's `message` and `reply` hold, in UTF-16 units: their `maxLength`. */
const MESSAGE_LENGTH = 1000;
const REPLY_LENGTH = 2000;
const LIST_LIMIT = 50;

/**
 * What each filter shows. Every one but All is open inquiries only: a replied or a closed one has left the queues.
 * Not labelled is an inquiry nobody has labelled yet: it is waiting for the sweep (pending), the sweep passed it over
 * because AI was off (skipped), or the model failed on it (failed). One a person labelled is not, whatever its status.
 */
const OPEN = { status: { $eq: 'open' } };
const FILTERS: Record<InquiryFilter, Doc> = {
  'needs-answer': { ...OPEN, queue: { $eq: 'needs-answer' } },
  complaint: { ...OPEN, queue: { $eq: 'complaint' } },
  praise: { ...OPEN, queue: { $eq: 'praise' } },
  'not-labelled': { ...OPEN, analysisStatus: { $in: ['pending', 'skipped', 'failed'] }, humanCorrected: { $ne: true } },
  all: {},
};

/** Whether a value, whatever it came as, is one of the filters. A name like `toString` isn't, though `FILTERS['toString']` is a function. */
const isInquiryFilter = (value: unknown): value is InquiryFilter => (INQUIRY_FILTERS as readonly unknown[]).includes(value);

/** What staff are told when a row can't take an action any more, by Close and by Reply on LINE alike. */
const ALREADY_CLOSED = 'This inquiry is closed already.';
const ALREADY_REPLIED = 'This inquiry has been replied to already.';

const noInquiry = (documentId: string) => `No inquiry "${documentId}".`;
const notFound = (documentId: string) => failure('not_found', noInquiry(documentId), 'Reload the Inquiries tab: it may have been deleted.');

export default ({ strapi }: { strapi: Core.Strapi }) => {
  /** A published piece by slug, named in `language`, or in the default language when it has no version in that one. */
  const findProduct = productNamed(strapi);

  /** The reference when a question with it belongs to this customer, else null: a turn never links to anyone else's question. */
  const theirQuestion = async (subject: string, reference: string): Promise<string | null> =>
    (await strapi.documents(UID.question).count({ filters: { reference: { $eq: reference }, customer: { $eq: subject } } })) > 0 ? reference : null;

  /** What became of each hand-off's question, by reference, from one query. A question deleted since has no entry. */
  const questionStatuses = async (rows: Doc[]): Promise<Map<string, QuestionStatus>> => {
    const references = [...new Set(rows.flatMap((row) => (row.questionReference ? [row.questionReference as string] : [])))];
    if (references.length === 0) return new Map();
    const questions = (await strapi.documents(UID.question).findMany({
      filters: { reference: { $in: references } },
      fields: ['reference', 'status'],
    })) as Doc[];
    return new Map(questions.map((question) => [question.reference, question.status]));
  };

  const toStaffView = (
    row: Doc,
    product: StaffInquiryView['product'],
    question: StaffInquiryView['question'],
    demoLineUserId: string | null
  ): StaffInquiryView => ({
    documentId: row.documentId,
    createdAt: new Date(row.createdAt).toISOString(),
    customer: maskSubject(row.customer),
    message: row.message,
    reply: row.reply ?? null,
    language: row.language,
    product,
    knowledgeFound: Boolean(row.knowledgeFound),
    handedOff: Boolean(row.handedOff),
    question,
    kind: row.kind ?? null,
    sentimentScore: row.sentimentScore ?? null,
    sentimentLabel: row.sentimentLabel ?? null,
    answered: row.answered ?? null,
    reason: row.reason ?? null,
    topic: row.topic ?? null,
    analysisStatus: row.analysisStatus,
    analysisAttempts: row.analysisAttempts ?? 0,
    humanCorrected: Boolean(row.humanCorrected),
    queue: row.queue,
    status: row.status,
    closeReason: row.closeReason ?? null,
    replyText: row.replyText ?? null,
    repliedAt: isoOrNull(row.repliedAt),
    repliedBy: row.repliedBy ?? null,
    line: row.lineOutcome ? { outcome: row.lineOutcome, detail: row.lineDetail || null } : null,
    yourLine: isYourLine(row.customer, demoLineUserId),
  });

  /** Rows as staff see them. Each piece is looked up once per language, and the questions of all the hand-offs in one query. */
  const viewsOf = async (rows: Doc[]): Promise<StaffInquiryView[]> => {
    const statuses = await questionStatuses(rows);
    const nameOf = rememberProductNames(findProduct);
    const questionOf = (row: Doc): StaffInquiryView['question'] =>
      row.questionReference ? { reference: row.questionReference, status: statuses.get(row.questionReference) ?? null } : null;
    const { demoLineUserId } = getConfig(strapi);
    return Promise.all(rows.map(async (row) => toStaffView(row, await nameOf(row), questionOf(row), demoLineUserId)));
  };

  const findRow = async (documentId: string): Promise<Doc | null> => (await strapi.documents(UID.inquiry).findOne({ documentId })) as Doc | null;

  /** Writes `data` to the inquiry. Strapi's types know only `id` and `documentId` for this content type, and `update` checks its data against them. */
  const updateInquiry = (documentId: string, data: Doc) => strapi.documents(UID.inquiry).update({ documentId, data });

  /** Writes `data` to the row, and answers the row as staff see it now: what was read, with what was written. */
  const changed = async (row: Doc, data: Doc): Promise<ServiceResult<StaffInquiryView>> => {
    await updateInquiry(row.documentId, data);
    const [view] = await viewsOf([{ ...row, ...data }]);
    return { ok: true, value: view };
  };

  /**
   * The inquiry a reply is for, with the token to send it with, or the outcome that says why nothing can be sent: no
   * such inquiry, a closed or a replied one, a hand-off (answered under Questions), or no token. The inquiry's own state
   * comes before the token: it is what staff can see on the row, and a refusal never depends on the setup. A made-up
   * demo customer's inquiry needs no token, since nothing goes to LINE: `token` is then whatever is set, or null.
   */
  const readyToReply = async (documentId: string): Promise<{ row: Doc; token: string | null } | { refusal: InquiryReplyOutcome }> => {
    const refuse = (status: InquiryReplyStatus, message: string) => ({ refusal: { documentId, status, message } });
    const row = await findRow(documentId);
    if (!row) return refuse('not_found', noInquiry(documentId));
    if (row.status === 'closed') return refuse('already_closed', ALREADY_CLOSED);
    if (row.status === 'replied') return refuse('already_replied', ALREADY_REPLIED);
    if (row.questionReference) return refuse('use_question', `Answer it under Questions (${row.questionReference}).`);
    const { lineChannelAccessToken: token } = getConfig(strapi);
    if (isDemoCustomer(row.customer)) return { row, token };
    if (!token) {
      strapi.log.warn(`[maison] ${NO_TOKEN}`);
      return refuse('not_configured', NO_TOKEN);
    }
    return { row, token };
  };

  /**
   * Pushes `text` to the inquiry's customer. When LINE refuses it or doesn't answer, this records why on the inquiry,
   * changes nothing else, and returns the `failed` outcome. When LINE takes it, it returns nothing.
   */
  const deliver = async (row: Doc, text: string, token: string): Promise<InquiryReplyOutcome | undefined> => {
    const { lineApiBaseUrl } = getConfig(strapi);
    const { status, detail } = await pushMessages({ apiBaseUrl: lineApiBaseUrl, token }, lineUserIdOf(row.customer), [{ type: 'text', text }]);
    if (status === 'sent') return undefined;
    const lineDetail = lineDetailOf(detail, token);
    try {
      await updateInquiry(row.documentId, { lineOutcome: 'failed', lineDetail });
    } catch (error) {
      // Nothing was sent, so this isn't dangerous: staff still hear that it failed, and why.
      strapi.log.error(`[maison] The failed LINE reply to inquiry ${row.documentId} couldn't be recorded: ${reasonOf(error, token)}`);
    }
    strapi.log.warn(`[maison] The reply to inquiry ${row.documentId} wasn't sent. ${lineDetail}`);
    return { documentId: row.documentId, status: 'failed', message: `The reply wasn't sent. ${lineDetail}` };
  };

  /**
   * LINE took the reply, but the inquiry couldn't be updated, so the row still shows it as unsent and staff might send it
   * again. The outcome is `sent`: the customer has it.
   */
  const sentUnrecorded = (documentId: string, error: unknown, token: string | null): InquiryReplyOutcome => {
    const message = `Sent the reply on LINE, but recording it failed (${reasonOf(error, token)}). Don't send it again.`;
    strapi.log.error(`[maison] Inquiry ${documentId}: ${message}`);
    return { documentId, status: 'sent', message, warning: true };
  };

  return {
    /**
     * Records one concierge turn for staff, with nothing labelled: the model labels it later, and a person can before it.
     * The message and the reply keep their line breaks, cut to what the row holds. A hand-off is in Needs an answer at
     * once. The piece and the question are stored only when they are real: a published piece, and a question that is
     * this customer's. Anything else is dropped and the turn is still logged.
     */
    async log(input: InquiryLogInput): Promise<ServiceResult<{ logged: true }>> {
      const { defaultLocale } = getConfig(strapi);
      const language = input.locale ?? defaultLocale;
      const [product, questionReference] = await Promise.all([
        input.productSlug ? findProduct(input.productSlug, language) : null,
        input.questionReference ? theirQuestion(input.subject, input.questionReference) : null,
      ]);
      await strapi.documents(UID.inquiry).create({
        data: {
          customer: input.subject,
          message: fitLines(input.message, MESSAGE_LENGTH),
          reply: fitLines(input.reply ?? '', REPLY_LENGTH) || null,
          language,
          knowledgeFound: input.knowledgeFound,
          handedOff: input.handedOff,
          questionReference,
          productSlug: product?.slug ?? null,
          analysisStatus: 'pending',
          queue: queueFor({ handedOff: input.handedOff, kind: null, answered: null }),
          status: 'open',
        },
      });
      return { ok: true, value: { logged: true } };
    },

    /**
     * The Inquiries tab's rows, newest first. A filter that is not one of `INQUIRY_FILTERS` is `invalid_input`: the route
     * checks it first, and a caller that doesn't is told, and never shown every row. So is a `kind` that is not one of
     * `INQUIRY_KINDS`, and a `since` that is not a real date. `since` keeps the inquiries from that day on, a day in the
     * plugin's time zone. `kind` is added to the filter's own conditions.
     */
    async list(filters: InquiryFilters = {}): Promise<ServiceResult<StaffInquiryView[]>> {
      const filter = filters.filter ?? 'needs-answer';
      if (!isInquiryFilter(filter)) {
        return failure('invalid_input', `Unknown filter "${String(filter)}".`, `Use one of ${INQUIRY_FILTERS.join(', ')}.`);
      }
      if (filters.kind !== undefined && !(INQUIRY_KINDS as readonly unknown[]).includes(filters.kind)) {
        return failure('invalid_input', `Unknown kind "${String(filters.kind)}".`, `Use one of ${INQUIRY_KINDS.join(', ')}.`);
      }
      if (filters.since !== undefined && !isRealIsoDate(filters.since)) {
        return failure('invalid_input', `The date "${String(filters.since)}" is not a real date.`, 'Use YYYY-MM-DD, such as 2026-10-06.');
      }
      const { timezone } = getConfig(strapi);
      const rows = (await strapi.documents(UID.inquiry).findMany({
        filters: {
          ...FILTERS[filter],
          ...(filters.kind !== undefined ? { kind: { $eq: filters.kind } } : {}),
          ...(filters.since !== undefined ? { createdAt: { $gte: zonedDayRange(filters.since, timezone).start.toISOString() } } : {}),
        },
        sort: 'createdAt:desc',
        limit: filters.limit ?? LIST_LIMIT,
      })) as Doc[];
      return { ok: true, value: await viewsOf(rows) };
    },

    /** One inquiry as staff see it, or `not_found`. */
    async view(documentId: string): Promise<ServiceResult<StaffInquiryView>> {
      const row = await findRow(documentId);
      if (!row) return notFound(documentId);
      const [view] = await viewsOf([row]);
      return { ok: true, value: view };
    },

    /** The cards above the rows: the open inquiries each filter shows. */
    async summary(): Promise<InquirySummary> {
      const countOf = (filter: InquiryFilter) => strapi.documents(UID.inquiry).count({ filters: FILTERS[filter] });
      const [needsAnswer, complaint, praise, notLabelled] = await Promise.all([
        countOf('needs-answer'),
        countOf('complaint'),
        countOf('praise'),
        countOf('not-labelled'),
      ]);
      return { needsAnswer, complaint, praise, notLabelled };
    },

    /**
     * Close: the inquiry needs nothing more, for the reason given. Only an open one: a closed one is `already_closed`,
     * and a replied one is `already_replied`, with its reply left as it was.
     */
    async close(documentId: string, reason: CloseReason): Promise<ServiceResult<StaffInquiryView>> {
      const row = await findRow(documentId);
      if (!row) return notFound(documentId);
      if (row.status === 'closed') {
        return failure('already_closed', ALREADY_CLOSED, 'Reload the Inquiries tab to see where it stands.');
      }
      if (row.status === 'replied') {
        return failure('already_replied', ALREADY_REPLIED, 'Reload the Inquiries tab to see the reply.');
      }
      return changed(row, { status: 'closed', closeReason: reason });
    },

    /**
     * Change label: a person sets the kind, the sentiment, or both. The row is marked as corrected, so labelling never
     * overwrites it and Not labelled no longer lists it, and its queue follows the new kind by the same rule the model's
     * labels go through. A sentiment clears the model's score, since the person gave a label and no score; the reason and
     * the topic stay as the model wrote them. The analysis status stays as it was: `skipped` says AI was off when the
     * sweep saw the row, and only the sweep sets it.
     *
     * A sentiment alone is refused for a row with no kind (`invalid_input`, "Pick a kind too."): a row with no kind is in
     * no queue, and a person's label takes it out of Not labelled, so it would drop out of sight.
     */
    async changeLabel(
      documentId: string,
      labels: { kind?: InquiryKind; sentimentLabel?: SentimentLabel }
    ): Promise<ServiceResult<StaffInquiryView>> {
      if (labels.kind === undefined && labels.sentimentLabel === undefined) {
        return failure('invalid_input', 'Give a kind, a sentiment, or both.', 'Pick a kind or a sentiment to change.');
      }
      const row = await findRow(documentId);
      if (!row) return notFound(documentId);
      if (labels.kind === undefined && (row.kind ?? null) === null) {
        return failure('invalid_input', 'Pick a kind too.', 'This inquiry has no kind yet, and without one it is in no queue.');
      }
      return changed(row, {
        ...(labels.kind !== undefined ? { kind: labels.kind } : {}),
        ...(labels.sentimentLabel !== undefined ? { sentimentLabel: labels.sentimentLabel, sentimentScore: null } : {}),
        humanCorrected: true,
        queue: queueFor({ handedOff: Boolean(row.handedOff), kind: labels.kind ?? row.kind ?? null, answered: row.answered ?? null }),
      });
    },

    /**
     * Label again: puts an inquiry the model failed on back to pending with no attempts, for the next sweep. Any other is
     * `not_failed`, and so is one a person labelled: the sweep never picks it, so staff would see nothing happen.
     */
    async labelAgain(documentId: string): Promise<ServiceResult<StaffInquiryView>> {
      const row = await findRow(documentId);
      if (!row) return notFound(documentId);
      if (row.humanCorrected) {
        return failure('not_failed', "A person labelled this inquiry, so it isn't labelled again.", 'Use Change label to change its labels.');
      }
      if (row.analysisStatus !== 'failed') {
        return failure('not_failed', 'Only an inquiry the model failed to label can be labelled again.', 'Use Change label to set its labels yourself.');
      }
      return changed(row, { analysisStatus: 'pending', analysisAttempts: 0 });
    },

    /**
     * Reply on LINE: pushes the staff member's text to the customer as one LINE message, in the inquiry's language, and
     * marks the inquiry replied, with the text, when, and by whom. `staffName` is the staff member's first name, recorded
     * and never sent: the reply goes out as Maison's, and a null name is recorded as Maison. Only an open inquiry with no
     * question: a closed or a replied one is refused, and a hand-off is answered under Questions (`use_question`), so
     * nothing is sent twice or around the question's flow. A message LINE refuses is recorded as failed, with LINE's
     * answer, and the inquiry stays open. A made-up demo customer gets no message: the inquiry is replied all the same, and
     * records `demo`. `now` is only for tests. It defaults to the current time.
     */
    async reply(documentId: string, text: string, staffName: string | null, now: Date = new Date()): Promise<InquiryReplyOutcome> {
      const ready = await readyToReply(documentId);
      if ('refusal' in ready) return ready.refusal;
      const { row, token } = ready;
      const replyText = text.trim();

      // A made-up demo customer gets no LINE message: the inquiry is replied all the same, and records `demo`.
      if (isDemoCustomer(row.customer)) {
        await updateInquiry(documentId, {
          status: 'replied',
          replyText,
          repliedAt: now,
          repliedBy: staffName ?? 'Maison',
          lineOutcome: 'demo',
          lineDetail: DEMO_DETAIL,
        });
        const message = 'Marked it replied. Demo customer: no LINE message.';
        strapi.log.info(`[maison] Inquiry ${documentId}: ${message}`);
        return { documentId, status: 'demo', message };
      }

      const failed = await deliver(row, inquiryReplyText({ language: row.language, message: row.message, text: replyText }), token as string);
      if (failed) return failed;

      try {
        await updateInquiry(documentId, {
          status: 'replied',
          replyText,
          repliedAt: now,
          repliedBy: staffName ?? 'Maison',
          lineOutcome: 'sent',
          lineDetail: '',
        });
      } catch (error) {
        return sentUnrecorded(documentId, error, token);
      }
      strapi.log.info(`[maison] Sent the reply to inquiry ${documentId} on LINE.`);
      return { documentId, status: 'sent', message: 'Sent the reply on LINE.' };
    },

    /**
     * This month's messages on Maison's LINE channel, for the Inquiries tab: replies count toward it, as confirmations do.
     * `configured` is false without a channel access token: replies can't be sent then, which the reply form says up front,
     * and LINE isn't asked. `used` and `limit` are null without a token, and when LINE gives no answer.
     */
    async quota(): Promise<InquiryQuota> {
      const { lineChannelAccessToken: token, lineApiBaseUrl } = getConfig(strapi);
      if (!token) return { configured: false, used: null, limit: null };
      return { configured: true, ...(await getMonthlyUsage({ apiBaseUrl: lineApiBaseUrl, token })) };
    },

    /**
     * The question was answered on LINE: every open inquiry that came from its hand-off is replied, with the answer.
     * `lineOutcome` is `demo` when the question was a made-up demo customer's, who got no LINE message. Called by
     * `questions.answer`, which never lets a failure here change its outcome.
     */
    async markQuestionReplied(
      reference: string,
      reply: { replyText: string; repliedBy: string; at: Date; lineOutcome?: 'sent' | 'demo' }
    ): Promise<void> {
      const rows = (await strapi.documents(UID.inquiry).findMany({
        filters: { questionReference: { $eq: reference }, status: { $eq: 'open' } },
      })) as Doc[];
      const line = reply.lineOutcome === 'demo' ? { lineOutcome: 'demo', lineDetail: DEMO_DETAIL } : { lineOutcome: 'sent' };
      await Promise.all(
        rows.map((row) =>
          updateInquiry(row.documentId, {
            status: 'replied',
            replyText: reply.replyText,
            repliedAt: reply.at,
            repliedBy: reply.repliedBy,
            ...line,
          })
        )
      );
    },
  };
};
