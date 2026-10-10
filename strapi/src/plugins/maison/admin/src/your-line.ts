/**
 * The "Your LINE" label on the presenter's own rows, apart from React. The server marks a row `yourLine` when its
 * customer is the LINE account in the plugin's demoLineUserId. Replying, answering or confirming for that customer sends
 * real LINE messages to the presenter, so the label tells those rows from the made-up customers' on stage.
 */

export const YOUR_LINE_LABEL = 'Your LINE';
export const YOUR_LINE_TITLE = 'Replies and confirmations for this customer go to your own LINE account.';

/**
 * The label for a row, or null when it isn't the presenter's own. Only `true` shows it: a row from a server that doesn't
 * say, or anything else, is a customer's.
 */
export const yourLineBadge = (row: { yourLine?: boolean }): { label: string; title: string } | null =>
  row.yourLine === true ? { label: YOUR_LINE_LABEL, title: YOUR_LINE_TITLE } : null;
