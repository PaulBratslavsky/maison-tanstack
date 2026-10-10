import { z } from '@strapi/utils';

import { ACTION } from '../../constants';
import { toolError, toolSuccess } from '../../domain/tool-result';
import { defineTool } from '../define';
import { referenceInput, staffAppointmentOutput } from '../schemas';

export const confirmAppointmentTool = defineTool({
  name: 'confirm_appointment',
  title: 'Confirm an appointment request',
  description:
    "Confirms a customer's appointment request for the boutique, the same as publishing it in the admin. Confirm only a reference the staff member asked you to confirm. Confirming also sends the customer their LINE confirmation, once: confirmationSent in the answer says whether it went out. If it didn't, confirming again won't retry it: staff use Send again on the Maison board. Confirming twice is safe and returns alreadyConfirmed true. A visit whose time has passed can't be confirmed.",
  auth: { policies: [{ action: ACTION.appointmentsConfirm }] },
  resolveInputSchema: () => z.object({ reference: referenceInput.describe('Reference from appointment_requests, e.g. APT-4821.') }),
  resolveOutputSchema: () =>
    z.object({
      appointment: staffAppointmentOutput,
      alreadyConfirmed: z.boolean().describe('true if staff had already confirmed it; nothing changed.'),
    }),
  createHandler: (strapi) => async ({ args }) => {
    const result = await strapi.plugin('maison').service('appointments').confirm(args.reference);
    if (!result.ok) return toolError(result.code, result.message, result.hint);
    return toolSuccess(result.value);
  },
});
