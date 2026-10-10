import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { notSignedIn } from '../domain/failures';
import { parseSubject } from '../domain/subject';
import { myAppointmentsInput, requestAppointmentInput } from '../mcp/schemas';
import { fromQuery } from '../rest/query';
import { parseOrReply, replyFailure, replyValue } from '../rest/reply';

/**
 * The signed-in LINE customer's own bookings over REST, at /api/maison, as request_appointment and my_appointments.
 * The customer-session policy puts the customer in ctx.state.maisonCustomer. Nothing here reads a customer from the
 * request, so a customer in the body or the query string is never used.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const appointments = () => strapi.plugin('maison').service('appointments');
  /** The customer the policy verified. A route without the policy has none, and answers 401 rather than act for nobody. */
  const customerOf = (ctx) => parseSubject(ctx.state?.maisonCustomer);

  return {
    /** POST /appointments, as request_appointment. The body is the tool's input. */
    async requestAppointment(ctx) {
      const subject = customerOf(ctx);
      if (!subject) return replyFailure(ctx, notSignedIn());
      const input = parseOrReply(ctx, requestAppointmentInput, ctx.request.body ?? {});
      if (!input) return;
      const result = await appointments().request({
        subject,
        boutique: input.boutique,
        productSlugs: input.productSlugs,
        requestedFor: input.requestedFor,
        note: input.note,
        locale: input.locale,
        createdVia: 'web',
      });
      if (!result.ok) return replyFailure(ctx, result);
      replyValue(ctx, { appointment: result.value }, 201);
    },

    /** GET /my-appointments, as my_appointments. */
    async myAppointments(ctx) {
      const subject = customerOf(ctx);
      if (!subject) return replyFailure(ctx, notSignedIn());
      const input = parseOrReply(ctx, myAppointmentsInput, fromQuery(ctx.query));
      if (!input) return;
      const locale = input.locale ?? getConfig(strapi).defaultLocale;
      replyValue(ctx, { appointments: await appointments().listForCustomer(subject, locale) });
    },
  };
};
