import { z } from '@strapi/utils';

import { ACTION } from '../../constants';
import { toolError, toolSuccess } from '../../domain/tool-result';
import { notSignedIn } from '../common';
import { defineTool } from '../define';
import { logInquiryInput } from '../schemas';

export const logInquiryTool = defineTool({
  name: 'log_inquiry',
  title: "Log a concierge turn for Maison's staff",
  description:
    "Records one concierge turn for Maison's staff: the customer's message, the reply, and whether knowledge was found or the question was handed off. The app's server calls it after each turn; it is not for the concierge to call. The customer comes from their LINE sign-in, never from an argument.",
  auth: { policies: [{ action: ACTION.inquiriesLog }] },
  resolveInputSchema: () => logInquiryInput,
  resolveOutputSchema: () => z.object({ logged: z.literal(true) }),
  createHandler: (strapi) => async ({ args, extra }) => {
    const subject = await strapi.plugin('maison').service('identity').getCustomerSubject(extra);
    if (!subject) return notSignedIn();
    // The subject goes last, so nothing in the arguments can stand in for the session's customer.
    const result = await strapi.plugin('maison').service('inquiries').log({ ...args, subject });
    if (!result.ok) return toolError(result.code, result.message, result.hint);
    return toolSuccess(result.value);
  },
});
