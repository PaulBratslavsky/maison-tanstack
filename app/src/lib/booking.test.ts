import { describe, expect, it, vi } from 'vitest';

import { BOOKING_DAYS, bookingDays, bookingState, defaultVisit, hasStock, isBookableDate, requestVisit, shouldCloseOnKey, visitArguments } from './booking';
import { nextSaturday } from './format';
import { SessionError } from './session';
import type { BoutiqueInfo } from './types';

// 11:30 on Thursday 1 October 2026 in Tokyo. Tomorrow there is Friday 2 October.
const NOW = new Date('2026-10-01T02:30:00Z');
const TUESDAY = '2026-10-06';
const WEDNESDAY = '2026-10-07';

const week = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
/**
 * A boutique as find_boutiques returns it for one date and one product (the seed's hours: 11:00 to 20:00; Osaka has no
 * Tuesday). Its stock is the seed's for the Weekender 50, which Osaka doesn't have, and the Cabin Case 55, which it has.
 */
const boutique = (slug: string, name: string, openOnDate: boolean, hoursOnDate = openOnDate ? { opens: '11:00', closes: '20:00' } : null): BoutiqueInfo => ({
  slug,
  name,
  city: slug === 'osaka' ? 'Osaka' : 'Tokyo',
  address: `${name} (demo)`,
  hours: week.filter((day) => slug !== 'osaka' || day !== 'tue').map((weekday) => ({ weekday, opens: '11:00', closes: '20:00' })),
  openOnDate,
  hoursOnDate,
  stock: [
    { product: 'weekender-50', quantity: slug === 'osaka' ? 0 : 1 },
    { product: 'cabin-case-55', quantity: 1 },
  ],
});
const onTuesday = [boutique('ginza', 'Ginza Flagship', true), boutique('omotesando', 'Omotesando', true), boutique('osaka', 'Osaka Shinsaibashi', false)];
const onWednesday = [boutique('ginza', 'Ginza Flagship', true), boutique('omotesando', 'Omotesando', true), boutique('osaka', 'Osaka Shinsaibashi', true)];

const sheet = (overrides: Partial<Parameters<typeof bookingState>[0]> = {}) =>
  bookingState({ date: TUESDAY, boutique: 'ginza', time: '14:00', products: ['weekender-50'], boutiques: onTuesday, loading: false, now: NOW, ...overrides });

describe('bookingDays', () => {
  it("offers two weeks of days from tomorrow on Tokyo's calendar, each with its weekday", () => {
    const days = bookingDays(NOW);
    expect(BOOKING_DAYS).toBe(14);
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: '2026-10-02', weekday: 5 });
    expect(days.at(-1)).toEqual({ date: '2026-10-15', weekday: 4 });
    expect(days.every((day) => isBookableDate(day.date, NOW))).toBe(true);
  });

  it('always holds the default day, the next Saturday at least two days away, and every weekday', () => {
    // Every hour for a fortnight, so each weekday and both sides of Tokyo's midnight come round.
    for (let hour = 0; hour < 14 * 24; hour++) {
      const now = new Date(NOW.getTime() + hour * 3_600_000);
      const days = bookingDays(now);
      expect(days.map((day) => day.date), now.toISOString()).toContain(nextSaturday(now));
      expect(new Set(days.map((day) => day.weekday)).size).toBe(7);
    }
  });

  it("moves on at Tokyo's midnight, not the machine's", () => {
    expect(bookingDays(new Date('2026-10-01T14:59:00Z'))[0].date).toBe('2026-10-02');
    expect(bookingDays(new Date('2026-10-01T15:00:00Z'))[0].date).toBe('2026-10-03');
  });
});

describe('defaultVisit', () => {
  it("is the sheet's own start: Ginza, the next Saturday at least two days away, at 14:00", () => {
    expect(defaultVisit(NOW)).toEqual({ boutique: 'ginza', date: '2026-10-03', time: '14:00' });
    expect(defaultVisit(NOW).date).toBe(nextSaturday(NOW));
    // On Friday 2 October, Saturday the 3rd is one day away: the default is the 10th.
    expect(defaultVisit(new Date('2026-10-02T02:30:00Z')).date).toBe('2026-10-10');
  });
});

describe('hasStock', () => {
  it('is true only where the boutique has at least one of the piece', () => {
    const [ginza, , osaka] = onTuesday;
    expect(hasStock(ginza, ['weekender-50'])).toBe(true);
    expect(hasStock(osaka, ['weekender-50'])).toBe(false);
    expect(hasStock(osaka, ['cabin-case-55'])).toBe(true);
    expect(hasStock(ginza, ['passport-cover']), 'no stock line for the piece').toBe(false);
  });

  it('is true where the boutique has at least one of several pieces, and false where it has none of them', () => {
    const [ginza, , osaka] = onTuesday;
    expect(hasStock(osaka, ['weekender-50', 'cabin-case-55']), 'Osaka has the Cabin Case, not the Weekender').toBe(true);
    expect(hasStock(osaka, ['cabin-case-55', 'weekender-50'])).toBe(true);
    expect(hasStock(ginza, ['weekender-50', 'cabin-case-55'])).toBe(true);
    expect(hasStock(osaka, ['weekender-50', 'passport-cover']), 'none of them').toBe(false);
    expect(hasStock(ginza, []), 'no pieces at all').toBe(false);
  });
});

describe('isBookableDate', () => {
  it('takes real calendar dates from tomorrow in Tokyo', () => {
    expect(isBookableDate('2026-10-02', NOW)).toBe(true);
    expect(isBookableDate(TUESDAY, NOW)).toBe(true);
  });

  it('refuses today, the past, impossible dates and a cleared field', () => {
    for (const date of ['2026-10-01', '2026-09-30', '2026-02-30', '2026-11-31', '']) expect(isBookableDate(date, NOW)).toBe(false);
  });
});

describe('bookingState', () => {
  it('offers the picked time at an open boutique on a bookable date', () => {
    const state = sheet();
    expect(state).toMatchObject({ validDate: true, dateProblem: null, open: true, startTime: '14:00' });
    expect(state.chosen?.slug).toBe('ginza');
    expect(state.slots).toHaveLength(18);
    expect([state.slots[0], state.slots.at(-1)]).toEqual(['11:00', '19:30']);
  });

  it('asks for a date when there is none, and offers nothing', () => {
    expect(sheet({ date: '' })).toMatchObject({ validDate: false, dateProblem: 'chooseDate', open: false, slots: [], startTime: undefined });
  });

  it('asks for a date when the date is not on the calendar', () => {
    expect(sheet({ date: '2026-02-30' })).toMatchObject({ validDate: false, dateProblem: 'chooseDate', open: false, startTime: undefined });
  });

  it('asks for a later date for today or a day in the past', () => {
    expect(sheet({ date: '2026-10-01' })).toMatchObject({ validDate: false, dateProblem: 'dateTooSoon', open: false, startTime: undefined });
    expect(sheet({ date: '2026-09-15' })).toMatchObject({ validDate: false, dateProblem: 'dateTooSoon', startTime: undefined });
  });

  it('is closed for Osaka on a Tuesday, with no time to send', () => {
    const state = sheet({ boutique: 'osaka', products: ['cabin-case-55'] });
    expect(state.chosen?.slug).toBe('osaka');
    expect(state).toMatchObject({ validDate: true, dateProblem: null, open: false, slots: [], startTime: undefined });
  });

  it('is not open while the date is being checked, even with the last answer saying open', () => {
    expect(sheet({ loading: true })).toMatchObject({ open: false, slots: [], startTime: undefined });
  });

  it('has nothing to send when an open day leaves no half-hour slot', () => {
    const short = [boutique('ginza', 'Ginza Flagship', true, { opens: '11:00', closes: '11:20' })];
    expect(sheet({ boutiques: short })).toMatchObject({ open: true, slots: [], startTime: undefined });
    const noHours = [boutique('ginza', 'Ginza Flagship', true, null)];
    expect(sheet({ boutiques: noHours })).toMatchObject({ open: true, slots: [], startTime: undefined });
  });

  it("uses the first boutique listed when the picked one isn't there, as the radios show", () => {
    const withoutGinza = onTuesday.filter((candidate) => candidate.slug !== 'ginza');
    expect(sheet({ boutiques: withoutGinza }).chosen?.slug).toBe('omotesando');
    expect(sheet({ boutiques: [] })).toMatchObject({ chosen: undefined, open: false, startTime: undefined });
  });

  it("never uses a boutique that doesn't have the piece: the picked one falls back to the first that has it", () => {
    // Osaka has no Weekender 50: its radio is disabled, and a pick of it (or a stale one) can't be sent.
    expect(sheet({ boutique: 'osaka' }).chosen?.slug).toBe('ginza');
    const osakaFirst = [onTuesday[2], ...onTuesday.slice(0, 2)];
    expect(sheet({ boutique: 'osaka', boutiques: osakaFirst }).chosen?.slug).toBe('ginza');
    // Where it is, a pick of Osaka stands.
    expect(sheet({ boutique: 'osaka', products: ['cabin-case-55'] }).chosen?.slug).toBe('osaka');
  });

  it('has no boutique, and nothing to send, when no boutique has the piece', () => {
    expect(sheet({ products: ['passport-cover'] })).toMatchObject({ chosen: undefined, open: false, slots: [], startTime: undefined });
  });

  it('falls back to the first slot when the picked time is not offered', () => {
    expect(sheet({ time: '09:00' }).startTime).toBe('11:00');
  });
});

// The visit picker books several pieces at once: a boutique is offered when it has at least one of them.
describe('bookingState for several pieces', () => {
  const visit = (overrides: Partial<Parameters<typeof bookingState>[0]>) => sheet({ date: WEDNESDAY, boutiques: onWednesday, ...overrides });

  it('offers a boutique that has one of them: Osaka, for the Weekender and the Cabin Case', () => {
    const state = visit({ boutique: 'osaka', products: ['weekender-50', 'cabin-case-55'] });
    expect(state.chosen?.slug).toBe('osaka');
    expect(state).toMatchObject({ open: true, startTime: '14:00' });
  });

  it('falls back to the first boutique with one of them when the picked one has none', () => {
    expect(visit({ boutique: 'osaka', products: ['weekender-50', 'passport-cover'] }).chosen?.slug).toBe('ginza');
  });

  it('has nothing to send when no boutique has any of them', () => {
    expect(visit({ products: ['passport-cover', 'tote-soleil'] })).toMatchObject({ chosen: undefined, open: false, slots: [], startTime: undefined });
  });

  it('is the one-piece rule for one piece: Osaka, without the Weekender, falls back to Ginza on any day', () => {
    expect(visit({ boutique: 'osaka', products: ['weekender-50'] }).chosen?.slug).toBe('ginza');
  });
});

describe('requestVisit', () => {
  const appointment = {
    reference: 'APT-0042',
    status: 'requested',
    boutique: { slug: 'ginza', name: 'Ginza Flagship' },
    requestedFor: '2026-10-03T14:00:00+09:00',
    products: [{ slug: 'weekender-50', name: 'Weekender 50' }],
    note: '',
    confirmationSent: false,
  };
  /** What Maison answers to a request it stored, as the MCP client passes it on. */
  const stored = { content: [{ type: 'text', text: JSON.stringify({ appointment }) }], structuredContent: { appointment } };
  /** What Maison answers to a request it refuses (isError). */
  const refusal = (code: string) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code, message: 'Refused.', hint: 'Ask for another time.' } }) }] });
  const request = { boutique: 'ginza', products: ['weekender-50'], date: '2026-10-03', startTime: '14:00', note: '', locale: 'en' as const };

  it("sends request_appointment as the sheet always has: the pieces, the start in Tokyo time and the customer's language", async () => {
    const callTool = vi.fn(async (_name: string, _args: Record<string, unknown>) => stored as any);
    expect(await requestVisit(callTool, request)).toEqual({ ok: true, appointment });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith('request_appointment', { boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: '2026-10-03T14:00:00+09:00', locale: 'en' });
  });

  it("sends the note trimmed, and only when there's something in it", () => {
    expect(visitArguments({ ...request, note: '  For my father.\n' })).toMatchObject({ note: 'For my father.' });
    expect(visitArguments({ ...request, note: ' \n ' })).not.toHaveProperty('note');
  });

  it('sends every piece of a visit for several, and the language of a Japanese chat', () => {
    expect(visitArguments({ ...request, products: ['weekender-50', 'cabin-case-55'], locale: 'ja' })).toEqual({
      boutique: 'ginza',
      productSlugs: ['weekender-50', 'cabin-case-55'],
      requestedFor: '2026-10-03T14:00:00+09:00',
      locale: 'ja',
    });
  });

  it("gives Maison's refusal as the problem, and no visit", async () => {
    for (const code of ['too_many_open_requests', 'boutique_closed', 'in_the_past']) {
      const outcome = await requestVisit(async () => refusal(code) as any, request);
      expect(outcome, code).toEqual({ ok: false, problem: { code, message: 'Refused.', hint: 'Ask for another time.' } });
    }
  });

  it("gives a failure on the way as the screens show it, and keeps a sign-in problem's code", async () => {
    const offline = await requestVisit(async () => {
      throw new TypeError('Failed to fetch');
    }, request);
    expect(offline).toEqual({ ok: false, problem: { code: 'network', message: 'Failed to fetch', hint: '' } });
    const signIn = await requestVisit(async () => {
      throw new SessionError('invalid_grant', 'LINE refused the ID token.');
    }, request);
    expect(signIn).toMatchObject({ ok: false, problem: { code: 'invalid_grant' } });
  });

  it('never takes a success without an appointment for a visit', async () => {
    for (const answer of [{ content: [] }, { content: [], structuredContent: {} }, { content: [], structuredContent: { appointment: { reference: '' } } }]) {
      const outcome = await requestVisit(async () => answer as any, request);
      expect(outcome, JSON.stringify(answer)).toMatchObject({ ok: false, problem: { code: 'error' } });
    }
  });
});

describe('shouldCloseOnKey', () => {
  const key = (event: Partial<Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>>) => ({ key: '', isComposing: false, keyCode: 0, ...event });

  it('closes the sheet on Escape', () => {
    expect(shouldCloseOnKey(key({ key: 'Escape', keyCode: 27 }))).toBe(true);
  });

  it('leaves it open while an input method composes, as when typing the note in Japanese: Escape there cancels the composition', () => {
    expect(shouldCloseOnKey(key({ key: 'Escape', keyCode: 27, isComposing: true }))).toBe(false);
    // Safari ends a composition before its keydown, and reports that keydown as keyCode 229 instead.
    expect(shouldCloseOnKey(key({ key: 'Escape', keyCode: 229 }))).toBe(false);
  });

  it('ignores every other key', () => {
    for (const other of ['Enter', 'Tab', 'a', ' ']) expect(shouldCloseOnKey(key({ key: other })), other).toBe(false);
  });
});
