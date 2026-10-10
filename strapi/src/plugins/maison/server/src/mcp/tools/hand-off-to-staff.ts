import { z } from '@strapi/utils';

import { ACTION } from '../../constants';
import { toolError, toolSuccess } from '../../domain/tool-result';
import { notSignedIn } from '../common';
import { defineTool } from '../define';
import { handOffToStaffInput, questionOutput } from '../schemas';

export const handOffToStaffTool = defineTool({
  name: 'hand_off_to_staff',
  title: "Hand a question to Maison's staff",
  description:
    "Hands the signed-in customer's question to Maison's client advisors, who reply in the customer's LINE chat with Maison. Call it when search_knowledge has no entry that answers the question (reason \"no_answer\"), or at once when the customer asks for a person (reason \"asked_for_person\"). Pass the question in the customer's own words, and productSlug when it is about one piece. Call it once per question. The customer comes from their LINE sign-in, never from an argument.",
  auth: { policies: [{ action: ACTION.questionsAsk }] },
  resolveInputSchema: () => handOffToStaffInput,
  resolveOutputSchema: () => z.object({ question: questionOutput }),
  createHandler: (strapi) => async ({ args, extra }) => {
    const subject = await strapi.plugin('maison').service('identity').getCustomerSubject(extra);
    if (!subject) return notSignedIn();
    const result = await strapi.plugin('maison').service('questions').ask({
      subject,
      question: args.question,
      reason: args.reason ?? 'no_answer',
      productSlug: args.productSlug,
      locale: args.locale,
    });
    if (!result.ok) return toolError(result.code, result.message, result.hint);
    return toolSuccess({ question: result.value });
  },
});
