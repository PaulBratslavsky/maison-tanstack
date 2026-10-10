import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { PLUGIN_ID, UID } from '../constants';
import { isDemoCustomer } from '../domain/demo-activity';
import { DEMO_DETAIL } from '../domain/line-outcome';
import { pushMessages } from '../domain/line-push';
import { toZonedIso } from '../domain/time';
import { CONFIRMATION_POPULATE, confirmationFor, inVisitLanguage, type Outcome } from './confirmations';

type Doc = Record<string, any>;

/**
 * What became of a confirmation:
 * - `sent`: LINE took the message, and a `sent` notification records it.
 * - `sent_unrecorded`: LINE took the message, but recording it failed. The board still shows the visit as not sent,
 *   and sending again would deliver it twice.
 * - `failed`: LINE refused it or couldn't be reached, and a `failed` notification says why.
 * - `already_sent`: a `sent` notification already exists, so nothing was sent.
 * - `not_confirmed`: the visit has no published version, so nothing was sent.
 * - `past`: the visit is over, so nothing was sent, as pending_confirmations lists none.
 * - `not_found`: no appointment has this reference.
 * - `not_configured`: there's no channel access token, or no liffUrl for the message's link. Nothing was sent or recorded.
 * - `demo`: the visit is one of Load demo activity's made-up customers, whose LINE user ID is made up. Nothing was
 *   sent, and a `demo` notification records that, with or without a token.
 */
export type SendStatus =
  | 'sent'
  | 'demo'
  | 'sent_unrecorded'
  | 'failed'
  | 'already_sent'
  | 'not_confirmed'
  | 'past'
  | 'not_found'
  | 'not_configured';

export interface SendOutcome {
  reference: string;
  status: SendStatus;
  /** What happened, in words staff can read. Never the token. */
  message: string;
}

const NO_TOKEN = "LINE_CHANNEL_ACCESS_TOKEN isn't set: confirmations aren't sent from Strapi.";
const NO_LIFF_URL = "The maison plugin has no liffUrl, so the confirmation link would be broken: confirmations aren't sent from Strapi.";

export default ({ strapi }: { strapi: Core.Strapi }) => {
  /** Each missing setting is logged once per process: every publish would repeat it. */
  const warned = new Set<string>();
  const notConfigured = (reference: string, message: string): SendOutcome => {
    if (!warned.has(message)) {
      warned.add(message);
      strapi.log.warn(`[maison] ${message}`);
    }
    return { reference, status: 'not_configured', message };
  };

  /**
   * Records a delivery outcome as Strapi's and logs it, with the token taken out of whatever the text quotes. It never
   * throws: `sent` only once it's recorded, and `sent_unrecorded` when LINE took the message but recording it failed.
   */
  const finish = async (reference: string, status: Outcome, detail: string, token: string): Promise<SendOutcome> => {
    const redact = (text: string) => text.split(token).join('[token]');
    const safeDetail = redact(detail);
    let recordingFailed: string | null = null;
    try {
      const recorded = await strapi
        .plugin(PLUGIN_ID)
        .service('confirmations')
        .record({ reference, status, detail: safeDetail, recordedBy: 'strapi' });
      if (!recorded.ok) recordingFailed = redact(recorded.message);
    } catch (error) {
      recordingFailed = redact(String((error as Error | undefined)?.message ?? error));
    }
    if (status === 'sent' && recordingFailed !== null) {
      const message = `Sent the LINE confirmation for ${reference}, but recording it failed (${recordingFailed}), so the board still shows it as not sent. Don't send it again.`;
      strapi.log.error(`[maison] ${message}`);
      return { reference, status: 'sent_unrecorded', message };
    }
    if (status === 'sent') {
      strapi.log.info(`[maison] Sent the LINE confirmation for ${reference}.`);
      return { reference, status, message: `Sent the LINE confirmation for ${reference}.` };
    }
    if (recordingFailed !== null) strapi.log.error(`[maison] The failed LINE confirmation for ${reference} couldn't be recorded: ${recordingFailed}`);
    const message = `The LINE confirmation for ${reference} wasn't sent. ${safeDetail}`;
    strapi.log.warn(`[maison] ${message}`);
    return { reference, status, message };
  };

  /**
   * A made-up demo customer's visit: no LINE call, since LINE refuses a user ID nobody has, and a `demo` notification
   * that says so. It never throws: a record that fails is logged, and the answer is still `demo`.
   */
  const recordDemo = async (reference: string): Promise<SendOutcome> => {
    const message = `Demo customer: no LINE confirmation for ${reference}.`;
    try {
      const recorded = await strapi
        .plugin(PLUGIN_ID)
        .service('confirmations')
        .record({ reference, status: 'demo', detail: DEMO_DETAIL, recordedBy: 'strapi' });
      if (!recorded.ok) strapi.log.error(`[maison] The demo outcome for ${reference} couldn't be recorded: ${recorded.message}`);
    } catch (error) {
      strapi.log.error(`[maison] The demo outcome for ${reference} couldn't be recorded: ${String((error as Error | undefined)?.message ?? error)}`);
    }
    strapi.log.info(`[maison] ${message}`);
    return { reference, status: 'demo', message };
  };

  /** One confirmation, sent and recorded. sendConfirmation makes sure only one runs per reference. */
  const send = async (reference: string, now: Date): Promise<SendOutcome> => {
    const sent = await strapi.documents(UID.notification).findFirst({
      filters: { outcome: { $eq: 'sent' }, appointmentReference: { $eq: reference } },
      fields: ['appointmentReference'],
    });
    if (sent) return { reference, status: 'already_sent', message: `The LINE confirmation for ${reference} was already sent.` };

    const draft = (await strapi.documents(UID.appointment).findFirst({
      status: 'draft',
      filters: { reference: { $eq: reference } },
      fields: ['documentId'],
    })) as Doc | null;
    if (!draft) return { reference, status: 'not_found', message: `No appointment ${reference}.` };
    const published = (await strapi.documents(UID.appointment).findOne({
      documentId: draft.documentId,
      status: 'published',
      populate: CONFIRMATION_POPULATE,
    })) as Doc | null;
    if (!published) {
      return { reference, status: 'not_confirmed', message: `Appointment ${reference} hasn't been confirmed, so it gets no confirmation.` };
    }

    const { lineChannelAccessToken: token, lineApiBaseUrl, liffUrl, timezone, houseName } = getConfig(strapi);
    // pending_confirmations lists a visit until it starts, so a confirmation goes out until then too.
    const when = new Date(published.requestedFor);
    if (when.getTime() < now.getTime()) {
      return {
        reference,
        status: 'past',
        message: `The visit for ${reference} was at ${toZonedIso(when, timezone)}, which has passed, so it gets no confirmation.`,
      };
    }
    if (isDemoCustomer(published.customer)) return recordDemo(reference);
    if (!token) return notConfigured(reference, NO_TOKEN);
    if (!liffUrl) return notConfigured(reference, NO_LIFF_URL);

    // In the visit's language, with the names pending_confirmations uses too.
    const [visit] = await inVisitLanguage(strapi, [published]);
    const confirmation = confirmationFor(visit, { liffUrl, timezone, houseName });
    if (!confirmation) return finish(reference, 'failed', "The appointment has no valid LINE customer, so it can't be confirmed over LINE.", token);
    const { status, detail } = await pushMessages({ apiBaseUrl: lineApiBaseUrl, token }, confirmation.lineUserId, [
      { type: 'flex', altText: confirmation.message.altText, contents: confirmation.message.contents },
    ]);
    return finish(reference, status, detail, token);
  };

  /** The send under way for each reference. A second call for one joins it instead of pushing again. */
  const inFlight = new Map<string, Promise<SendOutcome>>();

  return {
    /**
     * Sends the LINE confirmation of a confirmed visit, the one pending_confirmations lists for it, and records the
     * outcome. A visit with a `sent` notification gets nothing more: that is the only send-once rule. Calls for a
     * visit that is being sent share that send, so this process never pushes one visit twice at once. Publishing an
     * appointment calls this, whichever way it was published, and so does the board's Send again. A made-up demo
     * customer's visit gets no push: it records `demo` instead.
     * `now` is only for tests. It defaults to the current time.
     */
    sendConfirmation(reference: string, now: Date = new Date()): Promise<SendOutcome> {
      const running = inFlight.get(reference);
      if (running) return running;
      const sending = send(reference, now).finally(() => inFlight.delete(reference));
      inFlight.set(reference, sending);
      return sending;
    },
  };
};
