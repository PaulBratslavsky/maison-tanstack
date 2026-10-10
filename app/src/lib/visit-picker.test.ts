import type { UIMessage } from '@tanstack/ai';
import { describe, expect, it } from 'vitest';

import { bookingState, isBookableDate } from './booking';
import type { BoutiqueInfo } from './types';
import {
  CHOOSE_VISIT,
  composerLocked,
  followScroll,
  isPickerAwaitingAnswer,
  isRefusal,
  isWaitingPicker,
  livePickerOf,
  piecesOf,
  pickerPrefill,
  pickerViewOf,
  pickerWaitingOf,
  requestedVisitOf,
  visitPickerOutputOf,
  type PickerMessage,
  type PickerPart,
} from './visit-picker';

// 11:30 on Thursday 1 October 2026 in Tokyo. The form's chips run from Friday 2 to Thursday 15 October, and its default day
// is Saturday 3 October.
const NOW = new Date('2026-10-01T02:30:00Z');

const appointment = {
  reference: 'APT-0042',
  status: 'requested',
  boutique: { slug: 'ginza', name: 'Ginza Flagship' },
  requestedFor: '2026-10-10T14:00:00+09:00',
  products: [{ slug: 'weekender-50', name: 'Weekender 50' }],
  note: '',
  confirmationSent: false,
};
/**
 * A tool call as TanStack AI holds it in a message: a `tool-call` part with the tool's name, the call's id, its input once
 * the whole of it is in, its state, and its output once the result is in. A call that is waiting for the customer (a
 * client tool) is `input-complete`; one whose result is in is `complete`, or `error`.
 */
const call = (name: string, state: string, extra: Partial<PickerPart> = {}): PickerPart => ({ type: 'tool-call', id: 'call-1', name, state, ...extra });
/** A choose_visit call as the page holds it. */
const picker = (state: string, extra: Partial<PickerPart> = {}): PickerPart =>
  call(CHOOSE_VISIT, state, { input: { productSlugs: ['weekender-50'], boutique: 'ginza', date: '2026-10-10', time: '14:00' }, ...extra });
const requested = picker('complete', { output: { status: 'requested', appointment } });
const closed = picker('complete', { output: { status: 'closed' } });
const waiting = picker('input-complete');
const words = (content: string): PickerPart => ({ type: 'text', content } as PickerPart);
const user = (content: string): PickerMessage => ({ role: 'user', parts: [words(content)] });
const concierge = (...parts: PickerPart[]): PickerMessage => ({ role: 'assistant', parts });

describe('visitPickerOutputOf', () => {
  it('reads the two answers the picker gives: the visit it requested, or closed', () => {
    expect(visitPickerOutputOf({ status: 'requested', appointment })).toEqual({ status: 'requested', appointment });
    expect(visitPickerOutputOf({ status: 'closed' })).toEqual({ status: 'closed' });
  });

  it("reads nothing else: a request with no visit to show isn't one", () => {
    for (const output of [undefined, null, 'closed', [], {}, { status: 'requested' }, { status: 'requested', appointment: {} }, { status: 'requested', appointment: { reference: '' } }, { status: 'booked', appointment }]) {
      expect(visitPickerOutputOf(output), JSON.stringify(output)).toBeNull();
    }
  });
});

describe('requestedVisitOf and isWaitingPicker', () => {
  it("give an answered picker's visit, and tell a picker still waiting for the customer", () => {
    expect(requestedVisitOf(requested)).toEqual(appointment);
    expect(requestedVisitOf(closed)).toBeNull();
    expect(requestedVisitOf(waiting)).toBeNull();
    expect(isWaitingPicker(waiting)).toBe(true);
    expect(isWaitingPicker(picker('input-streaming'))).toBe(true);
    expect(isWaitingPicker(requested)).toBe(false);
  });

  it("tell the one state a picker's form shows for: its call came in whole, and it waits for the answer", () => {
    expect(isPickerAwaitingAnswer(waiting)).toBe(true);
    expect(isPickerAwaitingAnswer(picker('input-streaming'))).toBe(false);
    expect(isPickerAwaitingAnswer(requested)).toBe(false);
    expect(isPickerAwaitingAnswer(call('resolve_date', 'input-complete'))).toBe(false);
  });

  it('read only choose_visit: another tool with the same output is no picker', () => {
    const booking = call('request_appointment', 'complete', { output: { status: 'requested', appointment } });
    expect(requestedVisitOf(booking)).toBeNull();
    expect(isWaitingPicker(call('resolve_date', 'input-complete'))).toBe(false);
    // A call that ended in an error waits for nothing.
    expect(isWaitingPicker(picker('error', { output: { error: 'Invalid input' } }))).toBe(false);
  });
});

describe('isRefusal', () => {
  it("tells a refusal from a tool's answer: Maison's isError result, or the `{ error }` a failed call holds", () => {
    expect(isRefusal({ isError: true, content: [] })).toBe(true);
    expect(isRefusal({ error: 'Invalid input' })).toBe(true);
    for (const answer of [{ status: 'closed' }, { status: 'requested', appointment }, { content: [], structuredContent: {} }, { isError: false, content: [] }, null, undefined, 'error', []]) {
      expect(isRefusal(answer), JSON.stringify(answer)).toBe(false);
    }
  });
});

describe('piecesOf', () => {
  it("is the call's pieces, in order, each once, at most five", () => {
    expect(piecesOf({ productSlugs: ['weekender-50', 'cabin-case-55'] })).toEqual(['weekender-50', 'cabin-case-55']);
    expect(piecesOf({ productSlugs: ['weekender-50', 'weekender-50', 'cabin-case-55'] })).toEqual(['weekender-50', 'cabin-case-55']);
    expect(piecesOf({ productSlugs: ['a', 'b', 'c', 'd', 'e', 'f'] })).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps only slugs, and is empty when the call has none', () => {
    expect(piecesOf({ productSlugs: ['Weekender 50', 'weekender-50', 42, null] })).toEqual(['weekender-50']);
    for (const input of [undefined, null, 'weekender-50', {}, { productSlugs: 'weekender-50' }]) expect(piecesOf(input), JSON.stringify(input)).toEqual([]);
  });
});

describe('pickerPrefill', () => {
  it('fills the form in with what the call named', () => {
    expect(pickerPrefill({ productSlugs: ['weekender-50'], boutique: 'omotesando', date: '2026-10-10', time: '16:30' }, NOW)).toEqual({
      boutique: 'omotesando',
      date: '2026-10-10',
      time: '16:30',
    });
  });

  it("falls back to the sheet's start for what the call left out: Ginza, the next Saturday at least two days away, 14:00", () => {
    for (const input of [{ productSlugs: ['weekender-50'] }, {}, null, undefined, 'ginza', []]) {
      expect(pickerPrefill(input, NOW), JSON.stringify(input)).toEqual({ boutique: 'ginza', date: '2026-10-03', time: '14:00' });
    }
  });

  it("keeps a boutique slug it doesn't know, for the form to fall back from, and drops what is no slug", () => {
    expect(pickerPrefill({ boutique: 'kyoto' }, NOW).boutique).toBe('kyoto');
    for (const boutique of ['Ginza Flagship', 42, '']) expect(pickerPrefill({ boutique }, NOW).boutique, JSON.stringify(boutique)).toBe('ginza');
  });

  it("falls back to the next Saturday for a day that isn't one of the form's chips", () => {
    for (const date of ['2026-10-01', '2026-09-30', '2026-10-16', '2026-02-30', '10/10', '2026-10-1', 20261010]) {
      expect(pickerPrefill({ date }, NOW).date, String(date)).toBe('2026-10-03');
    }
    // The first chip and the last.
    expect(pickerPrefill({ date: '2026-10-02' }, NOW).date).toBe('2026-10-02');
    expect(pickerPrefill({ date: '2026-10-15' }, NOW).date).toBe('2026-10-15');
  });

  it('falls back to 14:00 for a time that is no HH:MM', () => {
    for (const time of ['2 pm', '24:00', '14:00:00', '1400', 1400, '']) expect(pickerPrefill({ time }, NOW).time, String(time)).toBe('14:00');
  });

  // Review focus: "2:15 pm" must not become the boutique's first slot, 11:00. The chips are half-hours.
  it('puts a time between the half-hours on the half-hour it falls in', () => {
    expect(pickerPrefill({ time: '14:15' }, NOW).time).toBe('14:00');
    expect(pickerPrefill({ time: '14:45' }, NOW).time).toBe('14:30');
    expect(pickerPrefill({ time: '14:30' }, NOW).time).toBe('14:30');
    expect(formFor({ time: '14:15' }).startTime).toBe('14:00');
  });
});

/**
 * The seed's boutiques as find_boutiques answers for `date` and the Weekender 50 and the Cabin Case 55, 11:00 to 20:00:
 * Osaka has no Weekender, and is closed on Tuesdays.
 */
const boutiquesOn = (date: string): BoutiqueInfo[] => {
  const tuesday = new Date(`${date}T00:00:00Z`).getUTCDay() === 2;
  const boutique = (slug: string, open: boolean, weekenders: number): BoutiqueInfo => ({
    slug,
    name: slug,
    city: 'Tokyo',
    address: '',
    hours: [],
    openOnDate: open,
    hoursOnDate: open ? { opens: '11:00', closes: '20:00' } : null,
    stock: [
      { product: 'weekender-50', quantity: weekenders },
      { product: 'cabin-case-55', quantity: 1 },
    ],
  });
  return [boutique('ginza', true, 1), boutique('omotesando', true, 1), boutique('osaka', !tuesday, 0)];
};
/** The form a call opens with, once find_boutiques has answered: what it shows, and what Send request would send. */
const formFor = (input: Record<string, unknown>, products = ['weekender-50']) => {
  const { boutique, date, time } = pickerPrefill({ productSlugs: products, ...input }, NOW);
  return { date, ...bookingState({ date, boutique, time, products, boutiques: boutiquesOn(date), loading: false, now: NOW }) };
};

// What the model passes is never trusted: whatever it names, Send request only ever sends a slot the form offers.
describe('the form a call opens with', () => {
  it('falls back to the first boutique with one of the pieces, for a boutique unknown or without them', () => {
    expect(formFor({ boutique: 'kyoto' }).chosen?.slug).toBe('ginza');
    expect(formFor({ boutique: 'osaka', date: '2026-10-07' }).chosen?.slug).toBe('ginza'); // no Weekender there
    expect(formFor({ boutique: 'osaka', date: '2026-10-07' }, ['weekender-50', 'cabin-case-55']).chosen?.slug).toBe('osaka'); // one of the two
  });

  it("falls back to the boutique's first slot for a time outside its hours", () => {
    expect(formFor({ time: '09:00' }).startTime).toBe('11:00');
    expect(formFor({ time: '20:00' }).startTime).toBe('11:00');
    expect(formFor({ time: '19:30' }).startTime).toBe('19:30');
  });

  it('says closed on a day the boutique is closed, and sends nothing, as the sheet does', () => {
    const osakaOnTuesday = formFor({ boutique: 'osaka', date: '2026-10-06' }, ['cabin-case-55']);
    expect(osakaOnTuesday).toMatchObject({ open: false, startTime: undefined });
    expect(osakaOnTuesday.chosen?.slug).toBe('osaka');
  });

  it('only ever offers a slot that can be sent: a bookable day, at a boutique with one of the pieces, inside its hours', () => {
    for (const boutique of [undefined, 'ginza', 'osaka', 'kyoto', 'Ginza']) {
      for (const date of [undefined, '2026-10-01', '2026-10-02', '2026-10-06', '2026-10-10', '2026-10-31']) {
        for (const time of [undefined, '09:00', '11:00', '14:15', '19:30', '20:00', '2 pm']) {
          const form = formFor({ boutique, date, time });
          if (form.startTime === undefined) continue;
          const label = JSON.stringify({ boutique, date, time });
          expect(isBookableDate(form.date, NOW), label).toBe(true);
          expect(form.chosen?.stock.some((line) => line.product === 'weekender-50' && line.quantity > 0), label).toBe(true);
          expect(form.chosen?.openOnDate, label).toBe(true);
          expect(form.slots, label).toContain(form.startTime);
        }
      }
    }
  });
});

describe('livePickerOf', () => {
  it("reads TanStack AI's own messages, as the chat holds them", () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', content: 'Can we schedule one?' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'tool-call', id: 'call-9', name: CHOOSE_VISIT, arguments: '{"productSlugs":["weekender-50"]}', input: { productSlugs: ['weekender-50'] }, state: 'input-complete' }] },
    ];
    expect(livePickerOf(messages)).toBe('call-9');
  });

  it("is the newest message's picker, while it waits for the customer", () => {
    expect(livePickerOf([user('Can we schedule one?'), concierge(waiting)])).toBe('call-1');
    expect(livePickerOf([user('Can we schedule one?'), concierge(picker('input-streaming'))])).toBe('call-1');
  });

  it('is none once the customer has written after it: they moved past it', () => {
    expect(livePickerOf([user('Can we schedule one?'), concierge(waiting), user('Which boutique has it?')])).toBeNull();
  });

  it('is none once it has its answer, and none in an older message', () => {
    expect(livePickerOf([user('Can we schedule one?'), concierge(requested, words('Requested.'))])).toBeNull();
    expect(livePickerOf([user('Can we schedule one?'), concierge(waiting), user('Hello'), concierge(words('Good afternoon.'))])).toBeNull();
    expect(livePickerOf([])).toBeNull();
  });

  it("looks past the tool-result parts TanStack AI keeps beside a call, and the thinking and text around it", () => {
    const result = { type: 'tool-result', toolCallId: 'call-0', content: '{}', state: 'complete' } as PickerPart;
    const thinking = { type: 'thinking', content: 'The customer wants to visit.' } as PickerPart;
    expect(livePickerOf([user('Can we schedule one?'), concierge(thinking, words('Here it is.'), result, waiting)])).toBe('call-1');
    expect(livePickerOf([user('Can we schedule one?'), concierge(waiting, result, thinking)])).toBe('call-1');
  });

  it('is none for a call with no id: an answer could not find it', () => {
    expect(livePickerOf([user('Can we schedule one?'), concierge({ ...waiting, id: undefined })])).toBeNull();
  });

  // Review focus: one live picker, even when the model called choose_visit twice in one reply.
  it('is the last waiting picker when the newest message has two: the other says no request was sent', () => {
    const second = picker('input-complete', { id: 'call-2' });
    const messages = [user('Can we schedule one?'), concierge(waiting, second)];
    expect(livePickerOf(messages)).toBe('call-2');
    expect(pickerViewOf(waiting, { live: livePickerOf(messages) === waiting.id, busy: false })).toEqual({ kind: 'unsent' });
    // A waiting picker is no longer live once a later one in the message has its answer: the customer answered that one.
    const asked = user('Can we schedule one?');
    expect(livePickerOf([asked, concierge({ ...waiting, id: 'call-0' }, requested)])).toBeNull();
    expect(livePickerOf([asked, concierge({ ...waiting, id: 'call-0' }, requested, words('Your visit is requested.'))])).toBeNull();
  });
});

describe('pickerViewOf', () => {
  it('shows the form for the live picker, which can send once no reply is coming in', () => {
    expect(pickerViewOf(waiting, { live: true, busy: false })).toEqual({ kind: 'form', canSend: true });
    expect(pickerViewOf(waiting, { live: true, busy: true })).toEqual({ kind: 'form', canSend: false });
  });

  it('shows nothing yet while the call is still coming in: the form opens with the whole of it', () => {
    expect(pickerViewOf(picker('input-streaming'), { live: true, busy: true })).toEqual({ kind: 'none' });
  });

  it('says no request was sent for a picker the customer moved past', () => {
    expect(pickerViewOf(waiting, { live: false, busy: false })).toEqual({ kind: 'unsent' });
    expect(pickerViewOf(picker('input-streaming'), { live: false, busy: false })).toEqual({ kind: 'unsent' });
  });

  it('shows the answer once there is one: the visit, or closed', () => {
    expect(pickerViewOf(requested, { live: false, busy: false })).toEqual({ kind: 'requested', appointment });
    expect(pickerViewOf(closed, { live: false, busy: true })).toEqual({ kind: 'closed' });
  });

  it("shows nothing for a call that ended in an error, and says nothing was sent for an answer it can't read", () => {
    expect(pickerViewOf({ state: 'error', output: { error: 'Invalid input' } }, { live: false, busy: false })).toEqual({ kind: 'none' });
    expect(pickerViewOf(picker('complete', { output: { status: 'maybe' } }), { live: false, busy: false })).toEqual({ kind: 'unsent' });
  });

  // The server's check of the pieces answers a choose_visit call with an error and no picker: the model reads it and calls again.
  it('shows nothing for a call the server answered with a refusal: no picker was shown, so none was moved past', () => {
    const refusals = [{ isError: true, content: [] }, { error: 'not_found: no such piece' }];
    for (const output of refusals) expect(pickerViewOf(picker('complete', { output }), { live: false, busy: false }), JSON.stringify(output)).toEqual({ kind: 'none' });
  });

  it("treats a call that hasn't started its input like one coming in", () => {
    expect(isWaitingPicker(picker('awaiting-input'))).toBe(true);
    expect(isPickerAwaitingAnswer(picker('awaiting-input'))).toBe(false);
    expect(pickerViewOf(picker('awaiting-input'), { live: true, busy: true })).toEqual({ kind: 'none' });
  });
});

describe('composerLocked', () => {
  it("holds the composer while a reply comes in or the picker's request is on its way, so no message moves past a visit being booked", () => {
    expect(composerLocked(false, false)).toBe(false);
    expect(composerLocked(true, false)).toBe(true);
    expect(composerLocked(false, true)).toBe(true);
    expect(composerLocked(true, true)).toBe(true);
  });

  it("holds the composer while a picker waits for its answer: ChatClient refuses a message then", () => {
    expect(composerLocked(false, false, true)).toBe(true);
    expect(composerLocked(false, false, false)).toBe(false);
  });
});

describe('pickerWaitingOf', () => {
  it("is true while the newest message's picker has come in whole and waits for the customer", () => {
    expect(pickerWaitingOf([user('Can we schedule one?'), concierge(words('Here it is.'), waiting)])).toBe(true);
  });

  it('is false with no picker, or one that has its answer', () => {
    expect(pickerWaitingOf([])).toBe(false);
    expect(pickerWaitingOf([user('Hello'), concierge(words('Good afternoon.'))])).toBe(false);
    expect(pickerWaitingOf([user('Can we schedule one?'), concierge(requested)])).toBe(false);
    expect(pickerWaitingOf([user('Can we schedule one?'), concierge(closed)])).toBe(false);
  });

  it('is false for a picker still coming in: a reply is streaming then, and a cut-off call is no form to wait for', () => {
    expect(pickerWaitingOf([user('Can we schedule one?'), concierge(picker('input-streaming'))])).toBe(false);
    expect(pickerWaitingOf([user('Can we schedule one?'), concierge(picker('awaiting-input'))])).toBe(false);
  });

  it('is false for a picker in an older message, or one the customer moved past', () => {
    expect(pickerWaitingOf([user('Can we schedule one?'), concierge(waiting), user('Which boutique has it?')])).toBe(false);
  });
});

describe('followScroll', () => {
  it("shows a live picker's top once, the first time its form is there, while the page follows the conversation", () => {
    expect(followScroll({ following: true, form: 'call-1', shown: null })).toEqual({ to: 'picker', shown: 'call-1' });
    // The reply's tail (busy ending, the inquiry log) changes the page again: the form stays where it is.
    expect(followScroll({ following: true, form: 'call-1', shown: 'call-1' })).toEqual({ to: 'stay', shown: 'call-1' });
    // A later picker shows its top in turn.
    expect(followScroll({ following: true, form: 'call-2', shown: 'call-1' })).toEqual({ to: 'picker', shown: 'call-2' });
  });

  it('follows the newest words as before once no form waits: the customer answered it, or wrote past it', () => {
    expect(followScroll({ following: true, form: null, shown: 'call-1' })).toEqual({ to: 'end', shown: 'call-1' });
    expect(followScroll({ following: true, form: null, shown: null })).toEqual({ to: 'end', shown: null });
  });

  it('moves nothing while the customer reads further up, and never jumps to a form they scrolled past later', () => {
    expect(followScroll({ following: false, form: null, shown: null })).toEqual({ to: 'stay', shown: null });
    expect(followScroll({ following: false, form: 'call-1', shown: null })).toEqual({ to: 'stay', shown: 'call-1' });
    // Back at the end of the conversation, with the same form still there.
    expect(followScroll({ following: true, form: 'call-1', shown: 'call-1' })).toEqual({ to: 'stay', shown: 'call-1' });
  });
});
