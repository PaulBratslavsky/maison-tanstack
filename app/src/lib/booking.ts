import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { isRealDate, nextSaturday, timeSlots, tokyoDays, tomorrow } from './format';
import { toolErrorOf } from './mcp';
import { errorOf, type ScreenError } from './status';
import type { Appointment, BoutiqueInfo, Locale } from './types';

/** Why a date can't be booked: the COPY key the form shows under the days. */
export type DateProblem = 'chooseDate' | 'dateTooSoon';

/** How many days the form offers, from tomorrow: two weeks. The concierge's calendar covers 14 days from today, so the form reaches one day further. */
export const BOOKING_DAYS = 14;

/** The boutique, day and time a booking form shows: a slug, YYYY-MM-DD and HH:MM. */
export interface VisitChoice {
  boutique: string;
  date: string;
  time: string;
}

/** What the form starts with when nothing else is asked for: Ginza, the next Saturday at least two days away, at 14:00. */
export const defaultVisit = (now: Date = new Date()): VisitChoice => ({ boutique: 'ginza', date: nextSaturday(now), time: '14:00' });

/**
 * The days the form offers, as chips: the next two weeks on Tokyo's calendar, from tomorrow. Each weekday comes up
 * twice, and the default day, the next Saturday at least two days away, is always among them.
 */
export const bookingDays = (now: Date = new Date()): Array<{ date: string; weekday: number }> => tokyoDays(BOOKING_DAYS + 1, now).slice(1);

/** A date the tools take and a visit can be on: a real calendar date, from tomorrow on Tokyo's calendar. */
export const isBookableDate = (date: string, now: Date = new Date()): boolean => isRealDate(date) && date >= tomorrow(now);

/**
 * No date, or an impossible one, asks for one; a real date today or in the past asks for a later one. The chips offer only
 * days from tomorrow, so a chosen day becomes too soon when Tokyo's midnight passes with the form open.
 */
export const dateProblem = (date: string, now: Date = new Date()): DateProblem | null =>
  isBookableDate(date, now) ? null : isRealDate(date) ? 'dateTooSoon' : 'chooseDate';

/**
 * Whether a boutique has something to see: at least one of the pieces in its stock, in find_boutiques' answer for them.
 * For one piece, whether it has that piece.
 */
export const hasStock = (boutique: BoutiqueInfo, products: readonly string[]): boolean =>
  boutique.stock.some((line) => products.includes(line.product) && line.quantity > 0);

/**
 * The boutique the form uses: the one picked, or else the first listed, as the radios show. Only a boutique that has one
 * of the pieces: one without any is a disabled radio, and is never chosen, even when picked before.
 */
export const chooseBoutique = (boutiques: BoutiqueInfo[], slug: string, products: readonly string[]): BoutiqueInfo | undefined => {
  const withPiece = boutiques.filter((candidate) => hasStock(candidate, products));
  return withPiece.find((candidate) => candidate.slug === slug) ?? withPiece[0];
};

/** Open on a bookable date. Never while that date's answer is loading: the boutiques held are the last date's. */
export const isOpen = (validDate: boolean, loading: boolean, boutique: BoutiqueInfo | undefined): boolean =>
  validDate && !loading && boutique?.openOnDate === true;

/** Half-hour start times on an open day, none otherwise. */
export const slotsFor = (open: boolean, boutique: BoutiqueInfo | undefined): string[] =>
  open && boutique?.hoursOnDate ? timeSlots(boutique.hoursOnDate.opens, boutique.hoursOnDate.closes) : [];

/** The time to send: the one picked when it's offered, else the first offered. Undefined when none is: nothing to send. */
export const startTimeFrom = (slots: string[], picked: string): string | undefined => (slots.includes(picked) ? picked : slots[0]);

/**
 * Whether a key closes the sheet: Escape, but not while an input method is composing text, as when the note is typed in
 * Japanese, where Escape cancels the composition. Safari reports that keydown as keyCode 229, without isComposing.
 */
export const shouldCloseOnKey = (event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>): boolean =>
  event.key === 'Escape' && !event.isComposing && event.keyCode !== 229;

/**
 * The booking form's rules in one place: what it may send, and what it says when it may not. `boutiques` and `loading`
 * are find_boutiques' answer for the date and the `products`. The form may send only when `startTime` is set.
 */
export const bookingState = ({
  date,
  boutique,
  time,
  products,
  boutiques,
  loading,
  now = new Date(),
}: {
  date: string;
  boutique: string;
  time: string;
  products: readonly string[];
  boutiques: BoutiqueInfo[];
  loading: boolean;
  now?: Date;
}) => {
  const validDate = isBookableDate(date, now);
  const chosen = chooseBoutique(boutiques, boutique, products);
  const open = isOpen(validDate, loading, chosen);
  const slots = slotsFor(open, chosen);
  return { validDate, dateProblem: dateProblem(date, now), chosen, open, slots, startTime: startTimeFrom(slots, time) };
};

/** What a booking form sends: the boutique, day and start it shows, the pieces, the customer's note, and the screen's language. */
export interface VisitRequest {
  boutique: string;
  products: readonly string[];
  date: string;
  startTime: string;
  note: string;
  locale: Locale;
}

/** How a request went: the visit Strapi stored, or the problem the form shows (Maison's refusal, or a failure on the way). */
export type VisitOutcome = { ok: true; appointment: Appointment } | { ok: false; problem: ScreenError };

/**
 * request_appointment's arguments, as the sheet has always sent them: the pieces, the start in Tokyo time, the note only
 * when there's something in it (trimmed), and the customer's language, so the answer names the boutique and the pieces in it.
 */
export const visitArguments = (request: VisitRequest): Record<string, unknown> => ({
  boutique: request.boutique,
  productSlugs: [...request.products],
  requestedFor: `${request.date}T${request.startTime}:00+09:00`,
  ...(request.note.trim() ? { note: request.note.trim() } : {}),
  locale: request.locale,
});

/**
 * Sends a visit request with `callTool` (Maison's, for the form's screen) and says how it went. It never throws: a refusal
 * is Maison's own error, and a failure on the way is the screens' (errorOf), which keeps a sign-in problem's OAuth code
 * so the copy can say what to do. A success without an appointment is a problem too: there's no visit to show.
 */
export const requestVisit = async (
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>,
  request: VisitRequest
): Promise<VisitOutcome> => {
  let result: CallToolResult;
  try {
    result = await callTool('request_appointment', visitArguments(request));
  } catch (error) {
    return { ok: false, problem: errorOf(error) };
  }
  const refusal = toolErrorOf(result);
  if (refusal) return { ok: false, problem: refusal };
  const appointment = (result.structuredContent as { appointment?: Appointment } | undefined)?.appointment;
  if (typeof appointment?.reference !== 'string' || appointment.reference === '') {
    return { ok: false, problem: { code: 'error', message: 'request_appointment answered without an appointment.', hint: '' } };
  }
  return { ok: true, appointment };
};
