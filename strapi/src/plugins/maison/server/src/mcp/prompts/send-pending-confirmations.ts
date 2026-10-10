import { ACTION } from '../../constants';
import { definePrompt } from '../define';

export const SEND_PENDING_CONFIRMATIONS_TEXT = `Send LINE confirmations for boutique appointments that staff have confirmed.

You have two MCP servers: this Strapi server and the LINE Bot MCP server. The tools you use are pending_confirmations (Strapi), get_profile (LINE Bot MCP), push_flex_message (LINE Bot MCP) and record_confirmation (Strapi).

1. Call pending_confirmations.
2. For each appointment, in order:
   a. Call get_profile with userId set to its lineUserId.
   b. If get_profile fails, do not push. Call record_confirmation with status "failed" and detail "not reachable: not a friend or blocked".
   c. Otherwise call push_flex_message with userId set to lineUserId and message set to the appointment's message, exactly as returned.
   d. If the push succeeded, call record_confirmation with status "sent" and push_flex_message's response as detail. If it failed, call record_confirmation with status "failed" and push_flex_message's error as detail. Never put get_profile output in detail: a profile holds the customer's display name, picture and status message, and detail is visible in the Content Manager.
   e. If recording "sent" fails, retry it up to 3 times (repeating it is safe) and never push that appointment again; if it still fails, report its reference as pushed but not recorded. If a record_confirmation result has alreadyRecorded true, report that reference as a possible duplicate.
3. Report how many confirmations were sent and how many failed, with their references, and list any possible duplicates.

Why check first: LINE's push API returns 200 even when a message can't be delivered (the customer isn't a friend of the account, or blocked it). get_profile fails for those customers, so it is the reachability check. Never report a confirmation as sent unless get_profile and push_flex_message both succeeded.
Always pass userId explicitly; LINE Bot MCP otherwise sends to its default user.
If pending_confirmations returns not_configured, stop and report its hint.`;

export const sendPendingConfirmationsPrompt = definePrompt({
  name: 'send_pending_confirmations',
  title: 'Send pending appointment confirmations',
  description: 'Step-by-step instructions to deliver LINE confirmations for staff-confirmed appointments, using this server and LINE Bot MCP.',
  auth: { policies: [{ action: ACTION.confirmationsSend }] },
  createHandler: () => async () => ({
    messages: [{ role: 'user', content: { type: 'text', text: SEND_PENDING_CONFIRMATIONS_TEXT } }],
  }),
});
