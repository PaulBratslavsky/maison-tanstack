import { z } from '@strapi/utils';

import { ACTION, SURFACE_HEADER } from '../../constants';
import { toolError, toolSuccess } from '../../domain/tool-result';
import { notSignedIn } from '../common';
import { defineTool } from '../define';
import { appointmentOutput, requestAppointmentInput } from '../schemas';

export const requestAppointmentTool = defineTool({
  name: 'request_appointment',
  title: 'Request a boutique appointment',
  description:
    'Requests a boutique visit for the signed-in customer. It creates a request that a boutique must confirm; never tell the customer it is confirmed. Check opening hours with find_boutiques first. The customer comes from their LINE sign-in, never from an argument.',
  auth: { policies: [{ action: ACTION.appointmentsRequest }] },
  resolveInputSchema: () => requestAppointmentInput,
  resolveOutputSchema: () => z.object({ appointment: appointmentOutput }),
  createHandler: (strapi) => async ({ args, extra }) => {
    const subject = await strapi.plugin('maison').service('identity').getCustomerSubject(extra);
    if (!subject) return notSignedIn();
    const surface = extra.requestInfo?.headers?.[SURFACE_HEADER];
    const result = await strapi.plugin('maison').service('appointments').request({
      subject,
      boutique: args.boutique,
      productSlugs: args.productSlugs,
      requestedFor: args.requestedFor,
      note: args.note,
      locale: args.locale,
      createdVia: surface === 'concierge' ? 'concierge' : 'app',
    });
    if (!result.ok) return toolError(result.code, result.message, result.hint);
    return toolSuccess({ appointment: result.value });
  },
});
