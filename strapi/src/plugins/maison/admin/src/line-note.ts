/**
 * What a question's or an inquiry's status line says about the last LINE message to the customer: that it failed, in
 * LINE's own words and in red, or that a made-up demo customer gets no LINE message, in grey. Nothing once a message
 * went out, or before there was one. A demo customer is never shown as a failure.
 */
export type LineOutcome = 'sent' | 'failed' | 'demo';

export const lineNote = (
  line: { outcome: LineOutcome; detail: string | null } | null | undefined
): { text: string; tone: 'danger' | 'neutral' } | null => {
  if (line?.outcome === 'failed') return { text: line.detail ? `LINE message failed: ${line.detail}` : 'LINE message failed.', tone: 'danger' };
  if (line?.outcome === 'demo') return { text: 'Demo customer: no LINE message.', tone: 'neutral' };
  return null;
};

/** The text colour of each tone, from Strapi's design system. */
export const LINE_NOTE_COLORS = { danger: 'danger600', neutral: 'neutral600' } as const;
