import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { MAX_OPEN_QUESTIONS, UID, type KnowledgeCategory, type Locale, type QuestionReason, type QuestionStatus } from '../constants';
import { isDemoCustomer, isYourLine } from '../domain/demo-activity';
import { isRealIsoDate } from '../domain/hours';
import { DEMO_DETAIL, NO_TOKEN, lineDetailOf, reasonOf } from '../domain/line-outcome';
import { getDisplayName, pushMessages } from '../domain/line-push';
import { acknowledgementText, answerText, knowledgeTitleOf } from '../domain/question-messages';
import { generateReference } from '../domain/reference';
import { failure, type ServiceResult } from '../domain/service-result';
import { lineUserIdOf, maskSubject } from '../domain/subject';
import { isoOrNull, zonedDayRange } from '../domain/time';
import { productNamed, rememberProductNames } from './product-names';

type Doc = Record<string, any>;

export interface QuestionRequest {
  subject: string;
  question: string;
  reason: QuestionReason;
  productSlug?: string;
  /** The chat's language. Defaults to defaultLocale. */
  locale?: Locale;
}

/** What the concierge gets back. */
export interface QuestionView {
  reference: string;
  status: 'open';
  product: { slug: string; name: string } | null;
}

/** A question as staff see it: the customer masked, with their LINE name when LINE gave one. */
export interface StaffQuestionView {
  reference: string;
  customer: string;
  customerName: string | null;
  question: string;
  reason: QuestionReason;
  language: Locale;
  product: { slug: string; name: string } | null;
  status: QuestionStatus;
  staffName: string | null;
  takenAt: string | null;
  answeredAt: string | null;
  answer: string | null;
  addedToKnowledge: boolean;
  /** How the last LINE message went: `demo` for a made-up demo customer, who gets none. */
  line: { outcome: 'sent' | 'failed' | 'demo'; detail: string } | null;
  /**
   * The presenter's own LINE account (the plugin's demoLineUserId): Let them know and Answer send real LINE messages to
   * the presenter. The list shows a "Your LINE" label. Never the ID itself.
   */
  yourLine: boolean;
  createdAt: string;
}

export interface QuestionFilters {
  /** open: open or taken, the default. */
  status?: 'open' | 'answered' | 'all';
  limit?: number;
  /** Only questions that came in on or after this day (YYYY-MM-DD), a day in the plugin's time zone. */
  since?: string;
  /** One question by its reference, whatever its status: with it, the status filter is `all`. */
  reference?: string;
}

const STATUS_FILTERS: Record<NonNullable<QuestionFilters['status']>, Doc> = {
  open: { status: { $in: ['open', 'taken'] } },
  answered: { status: { $eq: 'answered' } },
  all: {},
};

/**
 * What became of a staff message:
 * - `sent`: LINE took it, and the question says so. With `warning`, something after that went wrong, and the message says what.
 * - `demo`: the customer is one of Load demo activity's made-up customers. Nothing went to LINE, everything else the
 *   action does happened, and the question records `demo`. With `warning`, as for `sent`.
 * - `failed`: LINE refused it or didn't answer. The question records why, and nothing else changed.
 * - `not_found`, `already_taken`, `already_answered`: nothing was sent.
 * - `not_configured`: there's no channel access token. Nothing was sent or recorded.
 */
export type ReplyStatus = 'sent' | 'demo' | 'failed' | 'not_found' | 'already_taken' | 'already_answered' | 'not_configured';

export interface ReplyOutcome {
  reference: string;
  status: ReplyStatus;
  /** What happened, in words staff can read. Never the token. */
  message: string;
  /** The knowledge entry the answer became. */
  knowledgeDocumentId?: string;
  /**
   * The customer has the message, but something after it went wrong, and `message` says what: LINE took it and recording
   * it failed, or the knowledge entry couldn't be made. Staff should read it, not just see a success.
   */
  warning?: true;
}

export interface Reply {
  text: string;
  addToKnowledge: boolean;
  category?: KnowledgeCategory;
  /** The knowledge entry's title, only while `addToKnowledge`. Without one, the customer's question is the title. */
  title?: string;
}

/** A question as two of them are compared: trimmed, with every run of whitespace as one space, in lower case. */
const sameWordsAs = (question: string): string => question.replace(/\s+/g, ' ').trim().toLowerCase();

/** A reference no question has, like Q-4821. `random` is only for tests. */
export const uniqueQuestionReference = async (strapi: Core.Strapi, random: () => number = Math.random): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const reference = generateReference(random, 'Q');
    if ((await strapi.documents(UID.question).count({ filters: { reference: { $eq: reference } } })) === 0) return reference;
  }
  throw new Error('[maison] Could not find a free question reference after 20 attempts.');
};

export default ({ strapi }: { strapi: Core.Strapi }) => {
  /** A published piece by slug, named in `language`, or in the default language when it has no version in that one. */
  const findProduct = productNamed(strapi);

  const toStaffView = (row: Doc, product: StaffQuestionView['product'], demoLineUserId: string | null): StaffQuestionView => ({
    reference: row.reference,
    customer: maskSubject(row.customer),
    customerName: row.customerName ?? null,
    question: row.question,
    reason: row.reason,
    language: row.language,
    product,
    status: row.status,
    staffName: row.staffName ?? null,
    takenAt: isoOrNull(row.takenAt),
    answeredAt: isoOrNull(row.answeredAt),
    answer: row.answer ?? null,
    addedToKnowledge: Boolean(row.knowledgeDocumentId),
    line: row.lineOutcome ? { outcome: row.lineOutcome, detail: row.lineDetail ?? '' } : null,
    yourLine: isYourLine(row.customer, demoLineUserId),
    createdAt: new Date(row.createdAt).toISOString(),
  });

  /**
   * The question a staff message is for, with the token to send it with, or the outcome that says why nothing can be
   * sent: no such question, an answered one, a taken one when `refuseTaken` (Let them know; Answer may follow it), or no token.
   * A made-up demo customer's question needs no token, since nothing goes to LINE: `token` is then whatever is set, or null.
   */
  const readyToSend = async (
    reference: string,
    refuseTaken: boolean
  ): Promise<{ row: Doc; token: string | null } | { refusal: ReplyOutcome }> => {
    const row = (await strapi.documents(UID.question).findFirst({ filters: { reference: { $eq: reference } } })) as Doc | null;
    if (!row) return { refusal: { reference, status: 'not_found', message: `No question ${reference}.` } };
    if (row.status === 'answered') {
      return { refusal: { reference, status: 'already_answered', message: `Question ${reference} has been answered already.` } };
    }
    if (refuseTaken && row.status === 'taken') {
      return { refusal: { reference, status: 'already_taken', message: `${row.staffName || 'Someone'} has let the customer know already.` } };
    }
    const { lineChannelAccessToken: token } = getConfig(strapi);
    if (isDemoCustomer(row.customer)) return { row, token };
    if (!token) {
      strapi.log.warn(`[maison] ${NO_TOKEN}`);
      return { refusal: { reference, status: 'not_configured', message: NO_TOKEN } };
    }
    return { row, token };
  };

  /** Writes `data` to the question. Strapi's types know only `id` and `documentId` for this content type, and `update` checks its data against them. */
  const updateQuestion = (row: Doc, data: Doc) => strapi.documents(UID.question).update({ documentId: row.documentId, data });

  /** What the question records about LINE once the action is done: LINE took the message, or the customer is a made-up demo customer, who gets none. */
  const lineFields = (demo: boolean) => (demo ? { lineOutcome: 'demo', lineDetail: DEMO_DETAIL } : { lineOutcome: 'sent', lineDetail: '' });

  /**
   * Pushes `text` to the question's customer. When LINE refuses it or doesn't answer, this records why on the question,
   * changes nothing else, and returns the `failed` outcome. When LINE takes it, it returns nothing.
   */
  const deliver = async (row: Doc, text: string, token: string): Promise<ReplyOutcome | undefined> => {
    const { lineApiBaseUrl } = getConfig(strapi);
    const { status, detail } = await pushMessages({ apiBaseUrl: lineApiBaseUrl, token }, lineUserIdOf(row.customer), [{ type: 'text', text }]);
    if (status === 'sent') return undefined;
    const lineDetail = lineDetailOf(detail, token);
    try {
      await updateQuestion(row, { lineOutcome: 'failed', lineDetail });
    } catch (error) {
      // Nothing was sent, so this isn't dangerous: staff still hear that it failed, and why.
      strapi.log.error(`[maison] The failed LINE message for ${row.reference} couldn't be recorded: ${reasonOf(error, token)}`);
    }
    const message = `The LINE message for ${row.reference} wasn't sent. ${lineDetail}`;
    strapi.log.warn(`[maison] ${message}`);
    return { reference: row.reference, status: 'failed', message };
  };

  /**
   * LINE took the message, but the question couldn't be updated, so the board still shows it as unsent and staff
   * might send it again. The outcome is `sent`: the customer has it. `sent` is what was sent, in words, without the full stop.
   */
  const sentUnrecorded = (reference: string, sent: string, error: unknown, token: string | null): ReplyOutcome => {
    const message = `${sent}, but recording it failed (${reasonOf(error, token)}). Don't send it again.`;
    strapi.log.error(`[maison] ${message}`);
    return { reference, status: 'sent', message, warning: true };
  };

  /**
   * The answer is the reply to every inquiry the question came from, so they show as replied, with it. The customer has the
   * answer by now, so a failure here never changes the outcome: it is logged, and the question stays answered.
   */
  const markInquiriesReplied = async (row: Doc, text: string, staffName: string | null, at: Date, token: string | null, demo: boolean): Promise<void> => {
    const reply = { replyText: text, repliedBy: staffName ?? 'Maison', at, ...(demo ? { lineOutcome: 'demo' } : {}) };
    try {
      await strapi.plugin('maison').service('inquiries').markQuestionReplied(row.reference, reply);
    } catch (error) {
      strapi.log.warn(`[maison] ${row.reference} is answered, but its inquiries couldn't be marked replied: ${reasonOf(error, token)}`);
    }
  };

  /** The name of the question's piece in its language, or null when the question isn't about one, or the piece isn't published. */
  const productNameOf = async (row: Doc): Promise<string | null> =>
    row.productSlug ? ((await findProduct(row.productSlug, row.language))?.name ?? null) : null;

  /** The entry's title: the one staff gave, or the customer's question when they gave none (or only spaces). Cut to fit. */
  const knowledgeTitle = (row: Doc, reply: Reply): string => (reply.title ? knowledgeTitleOf(reply.title) : '') || knowledgeTitleOf(row.question);

  /** The answer as a published product knowledge entry in the question's language. Returns its document ID. */
  const createKnowledge = async (row: Doc, reply: Reply): Promise<string> => {
    const { documentId } = await strapi.documents(UID.knowledge).create({
      locale: row.language,
      data: {
        title: knowledgeTitle(row, reply),
        answer: reply.text,
        category: reply.category,
        productSlugs: row.productSlug ? [row.productSlug] : [],
        keywords: '',
      },
    });
    await strapi.documents(UID.knowledge).publish({ documentId, locale: row.language });
    return documentId;
  };

  return {
    /**
     * Records a question for staff. Nothing here messages the customer. A question the customer has with staff already
     * (open or taken, in the same words: ignoring capitals and extra whitespace) isn't recorded again: the answer is the
     * existing question's reference, and the piece it is about. That comes before the limit, so a repeat never counts
     * against it.
     */
    async ask(input: QuestionRequest): Promise<ServiceResult<QuestionView>> {
      const { defaultLocale, lineChannelAccessToken: token, lineApiBaseUrl } = getConfig(strapi);
      const language = input.locale ?? defaultLocale;
      // The questions this customer has with staff: open, or taken and not answered yet. Five is the limit, so never many.
      const waiting = (await strapi.documents(UID.question).findMany({
        filters: { customer: { $eq: input.subject }, status: { $in: ['open', 'taken'] } },
      })) as Doc[];
      const asked = sameWordsAs(input.question);
      const repeat = waiting.find((row) => sameWordsAs(row.question) === asked);
      if (repeat) {
        const product = repeat.productSlug ? await findProduct(repeat.productSlug, language) : null;
        return { ok: true, value: { reference: repeat.reference, status: 'open', product } };
      }
      if (waiting.length >= MAX_OPEN_QUESTIONS) {
        return failure(
          'too_many_open_questions',
          `This customer already has ${MAX_OPEN_QUESTIONS} questions with Maison's client advisors.`,
          "Don't hand this one off. Tell the customer their earlier questions are with the advisors, who will reply in the LINE chat with Maison."
        );
      }
      // An unknown piece never refuses the hand-off: the question still reaches staff, without it.
      const product = input.productSlug ? await findProduct(input.productSlug, language) : null;
      // Staff find the customer's chat in LINE by this name. Without a token, or an answer from LINE, there's none.
      const customerName = token ? await getDisplayName({ apiBaseUrl: lineApiBaseUrl, token }, lineUserIdOf(input.subject)) : null;
      const reference = await uniqueQuestionReference(strapi);
      await strapi.documents(UID.question).create({
        data: {
          reference,
          customer: input.subject,
          customerName,
          question: input.question.trim(),
          reason: input.reason,
          language,
          productSlug: product?.slug ?? null,
          status: 'open',
        },
      });
      return { ok: true, value: { reference, status: 'open', product } };
    },

    /**
     * The Customer questions section's rows, newest first. Each piece is looked up once per language. `since` keeps the
     * questions from that day on, and a `since` that is not a real date is `invalid_input`. A `reference` finds one question
     * whatever its status.
     */
    async list(filters: QuestionFilters = {}): Promise<ServiceResult<StaffQuestionView[]>> {
      if (filters.since !== undefined && !isRealIsoDate(filters.since)) {
        return failure('invalid_input', `The date "${String(filters.since)}" is not a real date.`, 'Use YYYY-MM-DD, such as 2026-10-06.');
      }
      const { timezone } = getConfig(strapi);
      const rows = (await strapi.documents(UID.question).findMany({
        filters: {
          ...STATUS_FILTERS[filters.reference ? 'all' : (filters.status ?? 'open')],
          ...(filters.reference ? { reference: { $eq: filters.reference } } : {}),
          ...(filters.since !== undefined ? { createdAt: { $gte: zonedDayRange(filters.since, timezone).start.toISOString() } } : {}),
        },
        sort: 'createdAt:desc',
        limit: filters.limit ?? 50,
      })) as Doc[];
      // One lookup per piece and language, shared by every question about it.
      const nameOf = rememberProductNames(findProduct);
      const { demoLineUserId } = getConfig(strapi);
      const views = await Promise.all(rows.map(async (row) => toStaffView(row, await nameOf(row), demoLineUserId)));
      return { ok: true, value: views };
    },

    /**
     * Let them know: sends the customer one LINE message in the staff member's name, saying a person has the question
     * and will reply in the chat, and marks the question taken. Only an open question: a taken one is `already_taken`,
     * and nothing is sent twice. `staffName` is the staff member's first name, or null to speak for the team. A made-up
     * demo customer gets no message: the question is taken all the same, and records `demo`.
     * `now` is only for tests. It defaults to the current time.
     */
    async notify(reference: string, staffName: string | null, now: Date = new Date()): Promise<ReplyOutcome> {
      const ready = await readyToSend(reference, true);
      if ('refusal' in ready) return ready.refusal;
      const { row, token } = ready;

      // A made-up demo customer gets no LINE message: the question is taken all the same, and records `demo`.
      if (isDemoCustomer(row.customer)) {
        await updateQuestion(row, { status: 'taken', staffName, takenAt: now, ...lineFields(true) });
        const message = `Marked ${reference} taken. Demo customer: no LINE message.`;
        strapi.log.info(`[maison] ${message}`);
        return { reference, status: 'demo', message };
      }

      const text = acknowledgementText({
        language: row.language,
        staffName,
        question: row.question,
        productName: await productNameOf(row),
      });
      const failed = await deliver(row, text, token as string);
      if (failed) return failed;

      const sent = `Sent the LINE message for ${reference}`;
      try {
        await updateQuestion(row, { status: 'taken', staffName, takenAt: now, ...lineFields(false) });
      } catch (error) {
        return sentUnrecorded(reference, sent, error, token);
      }
      strapi.log.info(`[maison] ${sent}.`);
      return { reference, status: 'sent', message: `${sent}.` };
    },

    /**
     * Answer: sends the customer the answer on LINE in the staff member's name, and marks the question answered. An open
     * or a taken question can be answered, an answered one is `already_answered`. With `addToKnowledge`, the answer also
     * becomes a published knowledge entry in the question's language, about its piece, titled as staff wrote it, or with
     * the customer's question when they wrote no title. The customer has the answer by then, so an entry that can't be
     * made never undoes it: the question is still answered, and the message says so, with `warning`. Once the question is
     * answered, its inquiries are marked replied. A made-up demo customer gets no message: everything else happens, and the
     * question and its inquiries record `demo`.
     * `now` is only for tests. It defaults to the current time.
     */
    async answer(reference: string, reply: Reply, staffName: string | null, now: Date = new Date()): Promise<ReplyOutcome> {
      const ready = await readyToSend(reference, false);
      if ('refusal' in ready) return ready.refusal;
      const { row, token } = ready;
      // A made-up demo customer gets no LINE message: everything else Answer does still happens, and the question records `demo`.
      const demo = isDemoCustomer(row.customer);

      if (!demo) {
        const text = answerText({
          language: row.language,
          staffName,
          question: row.question,
          productName: await productNameOf(row),
          answer: reply.text,
        });
        const failed = await deliver(row, text, token as string);
        if (failed) return failed;
      }

      let knowledgeDocumentId: string | undefined;
      let knowledgeProblem: string | undefined;
      if (reply.addToKnowledge) {
        try {
          knowledgeDocumentId = await createKnowledge(row, reply);
        } catch (error) {
          knowledgeProblem = reasonOf(error, token);
        }
      }

      const data = {
        status: 'answered',
        staffName,
        answeredAt: now,
        answer: reply.text,
        ...(knowledgeDocumentId ? { knowledgeDocumentId } : {}),
        ...lineFields(demo),
      };
      const sent = `Sent the answer to ${reference} on LINE`;
      try {
        await updateQuestion(row, data);
      } catch (error) {
        // Nothing went out for a demo customer, so there's nothing to warn about sending twice: the error is the answer.
        if (demo) throw error;
        return sentUnrecorded(reference, sent, error, token);
      }
      await markInquiriesReplied(row, reply.text, staffName, now, token, demo);
      const status: ReplyStatus = demo ? 'demo' : 'sent';
      // What happened, as a sentence without its full stop: "Sent the answer to Q-4821 on LINE", or for a demo customer "Answered Q-4821".
      const done = demo ? `Answered ${reference}` : sent;
      const noLine = demo ? ' Demo customer: no LINE message.' : '';
      if (knowledgeProblem !== undefined) {
        const message = `${done}.${noLine} It couldn't be added to product knowledge: ${knowledgeProblem}`;
        strapi.log.warn(`[maison] ${message}`);
        return { reference, status, message, warning: true };
      }
      let message = `${done}.${noLine}`;
      if (knowledgeDocumentId) message = demo ? `${done} and added it to product knowledge.${noLine}` : `${sent}. Added it to product knowledge.`;
      strapi.log.info(`[maison] ${message}`);
      return { reference, status, message, ...(knowledgeDocumentId ? { knowledgeDocumentId } : {}) };
    },
  };
};
