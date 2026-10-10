/** A row of the requests board, as far as these rules read it. */
export interface BoardRow {
  status: 'requested' | 'confirmed';
  /** The visit, in Tokyo time with its offset, e.g. "2026-10-10T14:00:00+09:00". */
  requestedFor: string;
  confirmationSent: boolean;
  /** One of Load demo activity's made-up customers, who gets no LINE message. A row that doesn't say is a real customer's. */
  demoCustomer?: boolean;
  /** The presenter's own LINE account: the board shows "Your LINE" beside it. A row that doesn't say is a customer's. */
  yourLine?: boolean;
}

/**
 * The LINE column, on the board and in the homepage widget: "LINE sent" in green once the confirmation went out,
 * "demo customer" in grey for a made-up customer, who gets no LINE message, and "not sent" in grey otherwise. Never red:
 * a demo customer's visit is not a failure.
 */
export const lineColumn = ({
  confirmationSent,
  demoCustomer,
}: Pick<BoardRow, 'confirmationSent' | 'demoCustomer'>): { label: string; variant: 'success' | 'neutral' } => {
  if (confirmationSent) return { label: 'LINE sent', variant: 'success' };
  return { label: demoCustomer === true ? 'demo customer' : 'not sent', variant: 'neutral' };
};

/** Confirm: a request staff haven't confirmed, until its visit starts. */
export const canStillConfirm = (row: BoardRow, now = Date.now()) => row.status === 'requested' && Date.parse(row.requestedFor) > now;

/**
 * Whether confirming sent the customer's LINE confirmation: confirm's answer says, or else the board's reloaded row.
 * undefined when neither does, such as when the row has left the view on screen.
 */
export const sentAfterConfirm = (
  answer: { appointment?: { confirmationSent?: unknown } } | undefined,
  rows: ReadonlyArray<{ reference: string; confirmationSent: boolean }> | null,
  reference: string
): boolean | undefined => {
  const fromAnswer = answer?.appointment?.confirmationSent;
  if (typeof fromAnswer === 'boolean') return fromAnswer;
  return rows?.find((row) => row.reference === reference)?.confirmationSent;
};

/**
 * Whether the visit just confirmed is a made-up demo customer's: confirm's answer says, or else the board's reloaded row.
 * False when neither does.
 */
export const demoCustomerAfterConfirm = (
  answer: { appointment?: { demoCustomer?: unknown } } | undefined,
  rows: ReadonlyArray<{ reference: string; demoCustomer?: boolean }> | null,
  reference: string
): boolean => {
  const fromAnswer = answer?.appointment?.demoCustomer;
  if (typeof fromAnswer === 'boolean') return fromAnswer;
  return rows?.find((row) => row.reference === reference)?.demoCustomer === true;
};

/**
 * The notice Confirm shows. Not knowing counts as not sent: Send again answers already_sent for a confirmation that
 * went out and was recorded. A made-up demo customer gets no LINE message, which an info notice says plainly: there is
 * nothing to send again.
 */
export const confirmedNotice = (
  reference: string,
  confirmationSent: boolean | undefined,
  demoCustomer = false
): { type: 'success' | 'warning' | 'info'; message: string } => {
  if (confirmationSent) return { type: 'success', message: `Confirmed ${reference}. The customer's LINE confirmation was sent.` };
  if (demoCustomer) return { type: 'info', message: `Confirmed ${reference}. Demo customer: no LINE message.` };
  return { type: 'warning', message: `Confirmed ${reference}. The LINE confirmation wasn't sent; use Send again.` };
};

/** What Send again's 200 answers say happened. `demo`: a made-up demo customer's visit, which gets no LINE message. */
export type SendAgainStatus = 'sent' | 'already_sent' | 'sent_unrecorded' | 'demo';

/**
 * The notice Send again shows for a 200. Any other answer is an error, shown in the server's words. The warning stays
 * until it is dismissed (`blockTransition`), as the reply notices do (`replyNotice`): it says "Don't send it again", which
 * has to be read, and a notice that fades after a few seconds can be missed.
 */
export const sendAgainNotice = (
  reference: string,
  status: SendAgainStatus
): { type: 'success' | 'warning' | 'info'; message: string; blockTransition?: true } => {
  if (status === 'already_sent') return { type: 'success', message: `The LINE confirmation for ${reference} had already been sent.` };
  if (status === 'demo') return { type: 'info', message: `Demo customer: no LINE confirmation for ${reference}.` };
  if (status === 'sent_unrecorded') {
    return {
      type: 'warning',
      message: `Sent the LINE confirmation for ${reference}, but it couldn't be recorded, so its row still says "not sent". Don't send it again.`,
      blockTransition: true,
    };
  }
  return { type: 'success', message: `Sent the LINE confirmation for ${reference}.` };
};

/**
 * Send again: a confirmed visit whose LINE column says "not sent", until the visit is over. Strapi sends no
 * confirmation for a visit that's over, as pending_confirmations lists none, nor for a made-up demo customer's, so
 * there is nothing to resend.
 */
export const canSendAgain = (row: BoardRow, now = Date.now()) =>
  row.status === 'confirmed' && !row.confirmationSent && row.demoCustomer !== true && Date.parse(row.requestedFor) >= now;
