import { describe, expect, it } from 'vitest';

import { SURFACE_HEADER, conciergeInstructions } from './instructions';

/** The last paragraph of the instructions on a piece's page, word for word. */
const pieceParagraph = (slug: string) =>
  `The customer is on the page of the piece with slug "${slug}". Unless they name another piece, "it" and "this" mean that piece: use that slug with view_product, as productSlugs for search_knowledge, and as productSlug for hand_off_to_staff.`;

describe('conciergeInstructions', () => {
  // 11:30 on Thursday 1 October in Tokyo, while it's still Wednesday evening in California.
  const now = new Date('2026-10-01T02:30:00Z');
  /** The calendar's lines: a date, a space, and the weekday. */
  const calendarOf = (instructions: string) => instructions.split('\n').filter((line) => /^\d{4}-\d{2}-\d{2} \S+$/.test(line));
  const datesOf = (instructions: string) => calendarOf(instructions).map((line) => line.slice(0, 10));

  it('gives the model a calendar of the next 14 days in Tokyo, today first, so it never works out a weekday', () => {
    const calendar = calendarOf(conciergeInstructions('en', now));
    expect(calendar).toHaveLength(14);
    expect(calendar[0]).toBe('2026-10-01 Thu');
    expect(calendar).toContain('2026-10-03 Sat');
    expect(calendar[13]).toBe('2026-10-14 Wed');
    // One line per day: none missing, none repeated.
    expect(datesOf(conciergeInstructions('en', now))).toEqual(Array.from({ length: 14 }, (_, day) => `2026-10-${String(day + 1).padStart(2, '0')}`));
  });

  it('writes the weekdays in the reply language', () => {
    const calendar = calendarOf(conciergeInstructions('ja', now));
    expect(calendar[0]).toBe('2026-10-01 木');
    expect(calendar).toContain('2026-10-03 土');
    expect(calendar).toHaveLength(14);
  });

  it("counts Tokyo's days, not UTC's", () => {
    // 00:30 on 1 October in Tokyo is still 30 September in UTC. 23:59 on 1 October in Tokyo is 1 October in UTC.
    expect(calendarOf(conciergeInstructions('en', new Date('2026-09-30T15:30:00Z')))[0]).toBe('2026-10-01 Thu');
    expect(calendarOf(conciergeInstructions('en', new Date('2026-10-01T14:59:00Z')))[0]).toBe('2026-10-01 Thu');
    expect(calendarOf(conciergeInstructions('en', new Date('2026-10-01T15:00:00Z')))[0]).toBe('2026-10-02 Fri');
  });

  it('runs on across the end of a month and a year, and a leap day', () => {
    const newYear = calendarOf(conciergeInstructions('en', new Date('2026-12-25T03:00:00Z')));
    expect(newYear[0]).toBe('2026-12-25 Fri');
    expect(newYear).toContain('2026-12-31 Thu');
    expect(newYear).toContain('2027-01-01 Fri');
    expect(newYear[13]).toBe('2027-01-07 Thu');
    expect(calendarOf(conciergeInstructions('en', new Date('2028-02-27T03:00:00Z')))).toContain('2028-02-29 Tue');
  });

  it('is the same wherever the server runs', () => {
    // The hour at 02:30Z in each zone shows that the zone really changed. Tokyo is the only one that agrees with Tokyo.
    const hourAtNow: Record<string, number> = { 'Asia/Tokyo': 11, 'America/Los_Angeles': 19, 'Pacific/Kiritimati': 16, 'Pacific/Pago_Pago': 15, UTC: 2 };
    const zone = process.env.TZ;
    try {
      const results = Object.entries(hourAtNow).map(([timeZone, hour]) => {
        process.env.TZ = timeZone;
        expect(new Date(now).getHours(), timeZone).toBe(hour);
        return conciergeInstructions('en', now);
      });
      for (const result of results) expect(result).toBe(results[0]);
      expect(calendarOf(results[0])[0]).toBe('2026-10-01 Thu');
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it('names no date of its own, so no example can be stale or copied for a wrong day', () => {
    for (const when of ['2026-10-01T02:30:00Z', '2027-03-15T10:00:00Z', '2028-02-27T20:00:00Z']) {
      const text = conciergeInstructions('en', new Date(when));
      const calendar = new Set(datesOf(text));
      for (const date of text.match(/\d{4}-\d{2}-\d{2}/g) ?? []) expect(calendar.has(date), `${date} is in the calendar for ${when}`).toBe(true);
    }
  });

  it('points the model at week "next" and day_after_tomorrow for 来週の… and 明後日, in both reply languages', () => {
    for (const locale of ['en', 'ja'] as const) {
      const text = conciergeInstructions(locale, now);
      expect(text, locale).toContain('"next week\'s Saturday", 来週の土曜日: week "next"');
      expect(text, locale).toContain('("the day after tomorrow", 明後日)');
    }
  });

  it('lets the model answer an opening-hours question without asking which day', () => {
    // Rule 1 says to use the tools for opening hours; rule 4 must not forbid the one call that answers it. Only when no
    // day is named: a booking turn names one, and checks it with find_boutiques and that date. With no day named, the
    // visit picker shows its own default: the model asks for none (rule 3).
    for (const locale of ['en', 'ja'] as const) {
      const text = conciergeInstructions(locale, now);
      expect(text, locale).toContain(
        "If the customer names no day, don't call it, don't pass a date to find_boutiques or choose_visit, and don't suggest a day yourself. Look up opening hours only when they ask about them, by calling find_boutiques without a date, which lists each boutique's weekly hours."
      );
      expect(text.match(/If the customer names no day/g), locale).toHaveLength(1); // one sentence, not two that start alike
      expect(text, locale).not.toMatch(/Don't look up opening hours unless/); // the old wording, which had no scope
      expect(text, locale).not.toMatch(/ask which day suits them/); // the picker shows a day: the model asks for none
      expect(text, locale).toMatch(/Use the tools for every fact about products, prices, stock and opening hours/);
      // The sentence after it names its tool: "it" would point at find_boutiques.
      expect(text, locale).toContain('Use the date resolve_date returns, and the weekday it returns when you speak of that day, never a weekday from the customer');
    }
  });

  it('says it once more, in Japanese, in the Japanese instructions only: no resolve_date when no day came up', () => {
    // On the local model a gift question in Japanese made a pointless call to resolve_date nearly every time.
    const line = '日付が出ていないご相談では resolve_date を呼ばないでください。';
    expect(conciergeInstructions('ja', now)).toContain(line);
    expect(conciergeInstructions('en', now)).not.toContain(line);
  });

  it('forbids saying a visit is confirmed, in both reply languages', () => {
    for (const locale of ['en', 'ja'] as const) {
      expect(conciergeInstructions(locale, now), locale).toContain('\n5. Never say a visit is confirmed.');
    }
  });

  // Rules 3 and 5, word for word: the visit picker. The model asks for nothing in words, and books nothing itself.
  const RULE_3 = `3. To request a visit, call choose_visit with the pieces the customer wants to see and, when they named them, the boutique slug, the day (the date resolve_date returned) and the time (HH:MM, 24-hour). Never ask for a boutique, day or time in words, never restate them for a yes, and never ask whether to request a visit ("Shall I request a visit?"): call choose_visit instead. The app shows the visit filled in, and the customer sends the request there: until choose_visit answers requested, nothing is requested, so never say you requested or booked it. If the customer asks to visit before choosing a piece, call choose_visit in the same reply with the pieces you suggest in that reply or suggested just before, at most three; ask which piece only when you have none to suggest.`;
  const RULE_5 = `5. Never say a visit is confirmed. When choose_visit answers requested, say in one short sentence that the visit is requested and the boutique will confirm it on LINE; the app shows the details. When it answers closed, offer help without pushing.`;

  it('sends a visit to choose_visit and the reply after it to one short sentence, in both reply languages', () => {
    for (const locale of ['en', 'ja'] as const) {
      const text = conciergeInstructions(locale, now);
      expect(text, locale).toContain(`\n${RULE_3}\n4. Call resolve_date only when the customer names a day`);
      expect(text, locale).toContain(`\n${RULE_5}\n6. If a tool returns an error`);
    }
  });

  // The picker offers days from tomorrow up to two weeks ahead (bookingDays in lib/booking.ts), and puts another day
  // back to its default without a word. Saying a day can't be requested isn't asking for one (rule 3).
  const BOOKABLE_DAYS =
    'Visits can be requested from tomorrow up to two weeks ahead: when the customer wants today, or a later day than that, say so in one short sentence and call choose_visit without a date.';

  it('tells the model which days the picker offers, at the end of rule 4, and to say so for any other day, in both reply languages', () => {
    for (const locale of ['en', 'ja'] as const) {
      const text = conciergeInstructions(locale, now);
      expect(text, locale).toContain(`For a day the calendar doesn't show ("next month"), ask the customer which day they mean. ${BOOKABLE_DAYS}\n5. Never say a visit is confirmed.`);
      expect(text.match(/two weeks ahead/g), locale).toHaveLength(1);
    }
  });

  it('never names request_appointment, asks for no yes, and has the model write no requestedFor: the picker books', () => {
    for (const locale of ['en', 'ja'] as const) {
      const text = conciergeInstructions(locale, now);
      expect(text, locale).not.toContain('request_appointment');
      expect(text, locale).not.toMatch(/wait for the customer's yes/);
      expect(text, locale).not.toContain('requestedFor');
    }
  });

  // Rules 9 and 10, word for word: the policy question and what follows when no entry answers it, and the request for a person.
  const RULE_9 = `9. For a question about Maison's services and policies, such as care, materials, sizing, personalization, delivery, payment, returns, repairs, warranty or gift wrapping, call search_knowledge with the customer's own words, and with productSlugs when the question is about particular pieces. Answer only from the entries it returns, and never invent a policy, a price or a time. If no entry answers the question, call hand_off_to_staff next, before you write anything, with the customer's question in their own words, reason "no_answer", and productSlug when it is about one piece. Then thank the customer and say in one short sentence that one of Maison's client advisors will look into it and message them here on LINE with the answer: the app shows the details. Never say a question is with the advisors unless hand_off_to_staff, or search_knowledge's own hand-off, succeeded for it, in this reply or an earlier one, and never promise a time yourself.`;
  const RULE_10 = `10. If the customer asks to talk to a person, call hand_off_to_staff at once with their request, reason "asked_for_person". Hand off each question once: if it is already with the advisors, say so.`;

  it('sends questions about policies to search_knowledge, and the ones it has no answer to, or a request for a person, to hand_off_to_staff, in both reply languages', () => {
    for (const locale of ['en', 'ja'] as const) {
      const text = conciergeInstructions(locale, now);
      expect(text, locale).toContain(`\n${RULE_9}\n${RULE_10}`);
      // The reply leaves the details to the note, and says a question is with the advisors only once it is (by hand_off_to_staff, or search_knowledge's own hand-off): in this reply or an earlier one.
      expect(text, locale).not.toMatch(/answers questions like this in the LINE chat/);
      expect(text, locale).not.toMatch(/button below/);
      expect(text, locale).not.toMatch(/Don't mention the LINE chat yourself/);
      expect(text, locale).not.toMatch(/you don't have that information/);
    }
  });

  it("ends with the piece's paragraph on a piece's page, after the rules, which it leaves as they are, in both reply languages", () => {
    for (const locale of ['en', 'ja'] as const) {
      const text = conciergeInstructions(locale, now, 'jewelry-coffret');
      expect(text.endsWith(pieceParagraph('jewelry-coffret')), locale).toBe(true);
      expect(text, locale).toBe(`${conciergeInstructions(locale, now)}\n\n${pieceParagraph('jewelry-coffret')}`);
      expect(text, locale).toContain(`\n${RULE_9}\n${RULE_10}\n\nThe customer is on the page of the piece with slug "jewelry-coffret".`);
      // The paragraph carries the slug it was given, once.
      expect(conciergeInstructions(locale, now, 'weekender-50').endsWith(pieceParagraph('weekender-50')), locale).toBe(true);
      expect(text.match(/jewelry-coffret/g), locale).toHaveLength(1);
    }
  });

  it("says nothing of a piece's page without a piece, whether none is given, null or undefined: the rules end the instructions", () => {
    for (const locale of ['en', 'ja'] as const) {
      for (const text of [conciergeInstructions(locale, now), conciergeInstructions(locale, now, null), conciergeInstructions(locale, now, undefined)]) {
        expect(text, locale).not.toMatch(/page of the piece/);
        expect(text.endsWith(RULE_10), locale).toBe(true);
      }
    }
  });

  it('sends the model to resolve_date for every day a customer names, and never to a weekday from their words', () => {
    const text = conciergeInstructions('en', now);
    expect(text).toMatch(/Call resolve_date only when the customer names a day, never to find out today's date, which is given above/);
    expect(text).toMatch(/never work out or guess a date or weekday yourself/i);
    expect(text).toMatch(/call resolve_date for it first, on its own, before find_boutiques with a date and before choose_visit/);
    expect(text).toMatch(/weekday for a weekday name \("Saturday": week "this"; "next week's Saturday", 来週の土曜日: week "next"\)/);
    expect(text).toMatch(/relative for exactly "today", "tomorrow" or "day_after_tomorrow"/);
    expect(text).toMatch(/If the customer names no day, don't call it, don't pass a date to find_boutiques or choose_visit, and don't suggest a day yourself/);
    expect(text).toMatch(/never a weekday from the customer's words/i);
    expect(text).toMatch(/isPast is true/);
    expect(text).toMatch(/never say you will look something up and then stop/i);
    // What goes to the picker: the date resolve_date returned. The model writes no requestedFor and restates no booking.
    expect(text).toContain('the day (the date resolve_date returned)');
    expect(text).not.toContain('YYYY-MM-DDTHH:MM:00+09:00');
    expect(text).not.toMatch(/appointment\.requestedFor/);
    expect(text).toMatch(/no markdown/i);
  });
});

describe('SURFACE_HEADER', () => {
  it('is the header that tells the Maison plugin a call came from the concierge', () => {
    expect(SURFACE_HEADER).toBe('x-maison-surface');
  });
});
