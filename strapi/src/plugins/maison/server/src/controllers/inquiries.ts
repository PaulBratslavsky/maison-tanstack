import type { Core } from '@strapi/strapi';

import { CLOSE_REASONS, INQUIRY_KINDS, SENTIMENT_LABELS } from '../constants';
import type { ServiceFailure, ServiceResult } from '../domain/service-result';
import type { ErrorCode } from '../domain/tool-result';
import { changeLabelInput, closeInquiryInput, describeIssues, inquiryListInput, replyInquiryInput } from '../mcp/schemas';
import { fromQuery } from '../rest/query';
import type { InquiryReplyOutcome, InquiryReplyStatus, StaffInquiryView } from '../services/inquiries';
import { staffNameOf } from './staff-name';

const FILTERS_HINT = 'Fix the filters and try again.';
const REPLY_HINT = 'Write a reply of up to 2,000 characters.';
const CLOSE_HINT = `Use one of ${CLOSE_REASONS.join(', ')}.`;
const LABEL_HINT = `Give a kind (${INQUIRY_KINDS.join(', ')}), a sentiment (${SENTIMENT_LABELS.join(', ')}), or both.`;

/** Strapi's error helper for each outcome of Reply on LINE that isn't sent, or demo. */
const REPLY_ERRORS: Record<Exclude<InquiryReplyStatus, 'sent' | 'demo'>, string> = {
  not_found: 'notFound',
  already_closed: 'conflict',
  already_replied: 'conflict',
  use_question: 'conflict',
  failed: 'badGateway',
  not_configured: 'serviceUnavailable',
};

/**
 * Strapi's error helper for each failure the service gives: 404 for an inquiry that isn't there, 409 when the inquiry's
 * state refuses the action (closed, replied, or not failed), and 400 for the rest, which is a request the service can't
 * act on.
 */
const FAILURE_ERRORS: Partial<Record<ErrorCode, string>> = {
  not_found: 'notFound',
  already_closed: 'conflict',
  already_replied: 'conflict',
  not_failed: 'conflict',
};

/**
 * The Inquiries tab on the Maison page: the rows, the counts, the month's LINE usage, and what staff do about an
 * inquiry: Reply on LINE, Close, Change label and Label again. Whoever is signed in is who replies to the customer: the
 * staff name comes from their account, never from the request.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const inquiries = () => strapi.plugin('maison').service('inquiries');

  /** The service's failure in Strapi's error body, by its code, with the hint. */
  const fail = (ctx, { code, message, hint }: ServiceFailure) => ctx[FAILURE_ERRORS[code] ?? 'badRequest'](message, { code, hint });

  /** An action's answer: the inquiry as staff see it now, and a message for the page to show, or the service's failure. */
  const answerWith = (ctx, result: ServiceResult<StaffInquiryView>, message: string) => {
    // `=== false`, not `!result.ok`: this project doesn't compile in strict mode, where only a comparison narrows the union.
    if (result.ok === false) return fail(ctx, result);
    ctx.body = { inquiry: result.value, message };
  };

  /**
   * A 200 with the outcome when LINE took the reply, or when the customer is a made-up demo customer, who gets none.
   * Otherwise the error that says why not: 404, 409 when the inquiry is closed or replied to already, or is a hand-off
   * answered under Questions, 502 when LINE refused the message or couldn't be reached, and 503 when Strapi has no token
   * to send with. The message goes to staff as it is.
   */
  const replyWith = (ctx, outcome: InquiryReplyOutcome) => {
    if (outcome.status === 'sent' || outcome.status === 'demo') {
      ctx.body = outcome;
      return;
    }
    return ctx[REPLY_ERRORS[outcome.status]](outcome.message, { code: outcome.status });
  };

  return {
    /** GET /inquiries: the tab's rows, newest first. */
    async list(ctx) {
      // Query strings are text, so a limit arrives as "20".
      const filters = inquiryListInput.safeParse(fromQuery(ctx.query, { numbers: ['limit'] }));
      if (!filters.success) {
        return ctx.badRequest(describeIssues(filters.error), { code: 'invalid_input', hint: FILTERS_HINT });
      }
      const result = await inquiries().list(filters.data);
      if (!result.ok) return fail(ctx, result);
      ctx.body = { inquiries: result.value };
    },

    /** GET /inquiries/summary: the cards, and the Homepage widget: the open inquiries in each queue. */
    async summary(ctx) {
      ctx.body = await inquiries().summary();
    },

    /**
     * GET /inquiries/quota: whether there is a channel access token (`configured`), and the month's LINE messages sent and
     * the limit. Without a token, `configured` is false, and the other two are null, as they are when LINE gives no answer.
     */
    async quota(ctx) {
      ctx.body = await inquiries().quota();
    },

    /** POST /inquiries/:documentId/reply, with `{ text }`: the dialog's Send on LINE. */
    async reply(ctx) {
      const reply = replyInquiryInput.safeParse(ctx.request.body ?? {});
      if (!reply.success) {
        return ctx.badRequest(describeIssues(reply.error), { code: 'invalid_input', hint: REPLY_HINT });
      }
      return replyWith(ctx, await inquiries().reply(ctx.params.documentId, reply.data.text, staffNameOf(strapi, ctx)));
    },

    /** POST /inquiries/:documentId/close, with `{ reason }`. */
    async close(ctx) {
      const close = closeInquiryInput.safeParse(ctx.request.body ?? {});
      if (!close.success) {
        return ctx.badRequest(describeIssues(close.error), { code: 'invalid_input', hint: CLOSE_HINT });
      }
      return answerWith(ctx, await inquiries().close(ctx.params.documentId, close.data.reason), 'Closed the inquiry.');
    },

    /** POST /inquiries/:documentId/label, with `{ kind, sentimentLabel }`, one or both: Change label. */
    async label(ctx) {
      const labels = changeLabelInput.safeParse(ctx.request.body ?? {});
      if (!labels.success) {
        return ctx.badRequest(describeIssues(labels.error), { code: 'invalid_input', hint: LABEL_HINT });
      }
      return answerWith(ctx, await inquiries().changeLabel(ctx.params.documentId, labels.data), 'Changed the label.');
    },

    /** POST /inquiries/:documentId/label-again: puts an inquiry the model failed on back to the next sweep. */
    async labelAgain(ctx) {
      return answerWith(ctx, await inquiries().labelAgain(ctx.params.documentId), 'It will be labelled again within a minute.');
    },
  };
};
