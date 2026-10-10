import type { Core } from '@strapi/strapi';

import type { ServiceFailure } from '../domain/service-result';
import { appointmentRequestsInput, describeIssues, referenceInput } from '../mcp/schemas';
import type { SendOutcome, SendStatus } from '../services/line-confirmations';

/** Query strings are text, so a limit arrives as "20". */
const filtersFrom = (query: Record<string, unknown> = {}) =>
  query.limit === undefined ? query : { ...query, limit: Number(query.limit) };

/** The tools' codes and hints in Strapi's error body: 404 for not_found, 400 for the rest. */
const fail = (ctx, { code, message, hint }: ServiceFailure) =>
  code === 'not_found' ? ctx.notFound(message, { code, hint }) : ctx.badRequest(message, { code, hint });

/**
 * Strapi's error helper for each outcome of Send again that isn't a 200: 404, 409 for a visit that isn't confirmed,
 * 422 for one that's over, 502 when LINE refused or couldn't be reached, and 503 when Strapi has no token or liffUrl
 * to send with.
 */
const NOTIFY_ERRORS: Record<Exclude<SendStatus, 'sent' | 'sent_unrecorded' | 'already_sent' | 'demo'>, string> = {
  not_found: 'notFound',
  not_confirmed: 'conflict',
  past: 'unprocessableEntity',
  failed: 'badGateway',
  not_configured: 'serviceUnavailable',
};

/** The requests board in the admin. Same service, same filters and same answers as the staff MCP tools. */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async list(ctx) {
    const filters = appointmentRequestsInput.safeParse(filtersFrom(ctx.query));
    if (!filters.success) {
      return ctx.badRequest(describeIssues(filters.error), { code: 'invalid_input', hint: 'Fix the filters and try again.' });
    }
    const result = await strapi.plugin('maison').service('appointments').listRequests(filters.data);
    if (!result.ok) return fail(ctx, result);
    ctx.body = { appointments: result.value };
  },

  /** The admin homepage widget: the board's headline counts and its newest rows, counted at the current time. */
  async summary(ctx) {
    ctx.body = await strapi.plugin('maison').service('appointments').summarizeRequests();
  },

  async confirm(ctx) {
    const reference = referenceInput.safeParse(ctx.params.reference);
    if (!reference.success) {
      return ctx.badRequest(describeIssues(reference.error), { code: 'invalid_input', hint: 'Use a reference like APT-4821.' });
    }
    const result = await strapi.plugin('maison').service('appointments').confirm(reference.data);
    if (!result.ok) return fail(ctx, result);
    ctx.body = result.value;
  },

  /**
   * The board's Send again: a confirmed visit's LINE confirmation, if it hasn't gone out. Already sent is a 200 too, and
   * so is sent_unrecorded: LINE took the message, and the board must say so, not report an error. So is demo: a made-up
   * demo customer gets no LINE message, which is no error either.
   */
  async notify(ctx) {
    const reference = referenceInput.safeParse(ctx.params.reference);
    if (!reference.success) {
      return ctx.badRequest(describeIssues(reference.error), { code: 'invalid_input', hint: 'Use a reference like APT-4821.' });
    }
    const outcome: SendOutcome = await strapi.plugin('maison').service('line-confirmations').sendConfirmation(reference.data);
    if (outcome.status === 'sent' || outcome.status === 'sent_unrecorded' || outcome.status === 'already_sent' || outcome.status === 'demo') {
      ctx.body = outcome;
      return;
    }
    return ctx[NOTIFY_ERRORS[outcome.status]](outcome.message, { code: outcome.status });
  },
});
