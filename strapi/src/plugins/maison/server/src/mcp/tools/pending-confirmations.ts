import { z } from '@strapi/utils';

import { ACTION } from '../../constants';
import { toolError, toolSuccess } from '../../domain/tool-result';
import { defineTool } from '../define';

const pendingOutput = z.object({
  reference: z.string(),
  lineUserId: z.string().describe('Pass as userId to LINE Bot MCP get_profile and push_flex_message.'),
  boutique: z.object({ name: z.string(), address: z.string() }),
  requestedFor: z.string(),
  requestedForText: z.string(),
  products: z.array(z.object({ name: z.string() })),
  previousAttempts: z.number().describe('Failed delivery attempts already recorded.'),
  appLink: z.string(),
  message: z
    .object({ altText: z.string(), contents: z.record(z.string(), z.any()) })
    .describe("Pass unchanged as push_flex_message's message."),
});

export const pendingConfirmationsTool = defineTool({
  name: 'pending_confirmations',
  title: 'List pending confirmations',
  description:
    'Lists appointments that staff have confirmed (published) but whose LINE confirmation has not been sent, each with the LINE user ID and a ready-made LINE flex message. Requests still waiting for staff are never listed. Deliver with LINE Bot MCP, then call record_confirmation.',
  auth: { policies: [{ action: ACTION.confirmationsSend }] },
  resolveInputSchema: () =>
    z.object({ limit: z.number().int().min(1).max(20).optional().describe('Maximum appointments, default 10.') }),
  resolveOutputSchema: () => z.object({ appointments: z.array(pendingOutput) }),
  createHandler: (strapi) => async ({ args }) => {
    const result = await strapi.plugin('maison').service('confirmations').listPending(args.limit ?? 10);
    if (!result.ok) return toolError(result.code, result.message, result.hint);
    return toolSuccess({ appointments: result.value });
  },
});
