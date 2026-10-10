/**
 * How the customer's words and the concierge's reply are shown, in the table and in both dialogs: they keep their line
 * breaks, and a long one (a customer can send a thousand blank lines) scrolls in its box instead of stretching the row
 * or the dialog.
 */
export const CLAMPED_TEXT_STYLE = { whiteSpace: 'pre-wrap', overflowWrap: 'break-word', maxHeight: '12rem', overflowY: 'auto' } as const;
