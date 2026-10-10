import type { Core } from '@strapi/strapi';

import { answerInput, describeIssues, questionReferenceInput, questionsListInput } from '../mcp/schemas';
import { fromQuery } from '../rest/query';
import type { ReplyOutcome, ReplyStatus } from '../services/questions';
import { staffNameOf } from './staff-name';

const REFERENCE_HINT = 'Use a reference like Q-4821.';
const ANSWER_HINT = 'Write an answer of up to 2,000 characters, and pick a category to add it to product knowledge.';

/** Strapi's error helper for each outcome that isn't sent, or demo. */
const REPLY_ERRORS: Record<Exclude<ReplyStatus, 'sent' | 'demo'>, string> = {
  not_found: 'notFound',
  already_taken: 'conflict',
  already_answered: 'conflict',
  failed: 'badGateway',
  not_configured: 'serviceUnavailable',
};

/**
 * The Customer questions section on the Maison page: the rows, Let them know, and Answer. Whoever is signed in is who
 * writes to the customer: the staff name comes from their account, never from the request.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const questions = () => strapi.plugin('maison').service('questions');

  /**
   * A 200 with the outcome when LINE took the message, or when the customer is a made-up demo customer, who gets none.
   * Otherwise the error that says why not: 404, 409 when the question is taken or answered already, 502 when LINE
   * refused it or couldn't be reached, and 503 when Strapi has no token to send with. The message goes to the admin as it is.
   */
  const answerWith = (ctx, outcome: ReplyOutcome) => {
    if (outcome.status === 'sent' || outcome.status === 'demo') {
      ctx.body = outcome;
      return;
    }
    return ctx[REPLY_ERRORS[outcome.status]](outcome.message, { code: outcome.status });
  };

  return {
    /** GET /questions: the section's rows, newest first. */
    async list(ctx) {
      // Query strings are text, so a limit arrives as "20".
      const filters = questionsListInput.safeParse(fromQuery(ctx.query, { numbers: ['limit'] }));
      if (!filters.success) {
        return ctx.badRequest(describeIssues(filters.error), { code: 'invalid_input', hint: 'Fix the filters and try again.' });
      }
      const result = await questions().list(filters.data);
      if (!result.ok) return ctx.badRequest(result.message, { code: result.code, hint: result.hint });
      ctx.body = { questions: result.value };
    },

    /** POST /questions/:reference/notify: the section's Let them know. */
    async notify(ctx) {
      const reference = questionReferenceInput.safeParse(ctx.params.reference);
      if (!reference.success) {
        return ctx.badRequest(describeIssues(reference.error), { code: 'invalid_input', hint: REFERENCE_HINT });
      }
      return answerWith(ctx, await questions().notify(reference.data, staffNameOf(strapi, ctx)));
    },

    /** POST /questions/:reference/answer, with `{ text, addToKnowledge, category }`: the dialog's Send on LINE. */
    async answer(ctx) {
      const reference = questionReferenceInput.safeParse(ctx.params.reference);
      if (!reference.success) {
        return ctx.badRequest(describeIssues(reference.error), { code: 'invalid_input', hint: REFERENCE_HINT });
      }
      const reply = answerInput.safeParse(ctx.request.body ?? {});
      if (!reply.success) {
        return ctx.badRequest(describeIssues(reply.error), { code: 'invalid_input', hint: ANSWER_HINT });
      }
      return answerWith(ctx, await questions().answer(reference.data, reply.data, staffNameOf(strapi, ctx)));
    },
  };
};
