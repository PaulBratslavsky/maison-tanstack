import type { UIMessage } from '@tanstack/ai';
import { describe, expect, it } from 'vitest';
import { needsRetry } from './chat-retry';

type Part = { type: string; content?: string; toolCallId?: string; id?: string; name?: string; state?: string; input?: unknown; output?: unknown };

const text = (value: string) => ({ type: 'text', content: value });
/** A tool call as TanStack AI holds it in a message: a `tool-call` part with the tool's name, its state and its output. */
const call = (name: string, state: string, output?: unknown): Part => ({
  type: 'tool-call',
  id: `call-${name}`,
  name,
  state,
  ...(output === undefined ? (state === 'error' ? { output: { error: 'fetch failed' } } : {}) : { output }),
});
/** The part TanStack AI keeps beside a finished call, which the screen doesn't show. */
const settled: Part = { type: 'tool-result', toolCallId: 'call-x', content: '{}', state: 'complete' };
const resolveDate = call('resolve_date', 'complete', { date: '2026-10-10', weekday: 'Saturday', isPast: false }); // the concierge's own tool
const searchProducts = call('search_products', 'complete', { content: [], structuredContent: { products: [] } }); // a Maison tool
const user = (value: string) => ({ role: 'user', parts: [text(value)] });
const assistant = (...parts: Part[]) => ({ role: 'assistant', parts });

/** A request_appointment call as the page holds it. */
const booking = (state: string, output?: unknown): Part => call('request_appointment', state, output);
/** What Maison answers, as the server's MCP wrapper passes it on: the visit it stored, or a refusal (isError). */
const appointment = { reference: 'MA-7Q2K', status: 'requested', requestedFor: '2026-10-03T14:00:00+09:00' };
const stored = { content: [{ type: 'text', text: JSON.stringify({ appointment }) }], structuredContent: { appointment } };
const refusal = {
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: { code: 'too_many_open_requests', message: 'You have 3 requests waiting.', hint: 'Wait for the boutique.' } }) }],
};
const booked = booking('complete', { ...stored, isError: false }); // the MCP result can carry isError: false
const refused = booking('complete', refusal);
/** The demo's two messages, up to the customer's yes. */
const askedToBook = [
  user('A travel gift, and a visit to Ginza on Saturday at 2 pm?'),
  assistant(text('Shall I request Saturday 3 October at 14:00 at Ginza?')),
  user('Yes, please.'),
];

/** A hand_off_to_staff call as the page holds it. */
const handOff = (state: string, output?: unknown): Part => call('hand_off_to_staff', state, output);
/** What Strapi answers to a hand-off it recorded: the question's reference. */
const recorded = { content: [{ type: 'text', text: '{}' }], structuredContent: { question: { reference: 'Q-4821', status: 'open', product: null } } };
const handedOff = handOff('complete', recorded);
/** A search_knowledge call, an MCP tool. Its result lists the entries it found. */
const knowledge = (state: string, output?: unknown): Part => call('search_knowledge', state, output);
const entries = (...titles: string[]) => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { locale: 'en', entries: titles.map((title) => ({ title })) } });
const foundNothing = knowledge('complete', entries());
const foundAnAnswer = knowledge('complete', entries('How do I care for the leather?'));
/** A search that found nothing, and the app's server handed the question to staff itself: its result carries what Strapi recorded. */
const handedOffBySearch = knowledge('complete', {
  content: [{ type: 'text', text: '{}' }],
  structuredContent: { locale: 'en', entries: [], handOff: { reference: 'Q-4821', question: 'Can I pay in bitcoin?', product: null } },
});
/** A question Maison has written nothing about, and one it has. */
const askedAboutBitcoin = [user('Can I pay in bitcoin?')];
const askedAboutCare = [user('How do I care for the leather?')];

describe('needsRetry', () => {
  it("reads TanStack AI's own messages, as the chat holds them", () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', content: 'Hello' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'tool-call', id: 'c1', name: 'search_products', arguments: '{}', state: 'complete', output: {} }] },
    ];
    expect(needsRetry(messages, false)).toBe(true);
    messages[1].parts.push({ type: 'text', content: 'Here are three options.' });
    expect(needsRetry(messages, false)).toBe(false);
  });

  it('is false for a reply that ends in something to read', () => {
    expect(needsRetry([user('Hello'), assistant(text('Good afternoon.'))], false)).toBe(false);
    expect(needsRetry([user('Hello'), assistant(resolveDate, searchProducts, text('Here are three options.'))], false)).toBe(false);
  });

  it('is true for a reply with no text at all', () => {
    expect(needsRetry([user('Hello'), assistant()], false)).toBe(true);
    expect(needsRetry([user('Hello'), assistant(settled)], false)).toBe(true);
    expect(needsRetry([user('Hello'), assistant(resolveDate, searchProducts)], false)).toBe(true); // tool calls, then nothing
    expect(needsRetry([user('Hello'), assistant(text(''))], false)).toBe(true);
    expect(needsRetry([user('Hello'), assistant(text('  \n '))], false)).toBe(true);
  });

  it('is true for a reply that ends in tool calls, whatever came before them', () => {
    expect(needsRetry([user('Hello'), assistant(text('Let me look.'), searchProducts)], false)).toBe(true);
    expect(needsRetry([user('Hello'), assistant(text('Let me look.'), resolveDate, settled)], false)).toBe(true);
  });

  it("doesn't count what the screen doesn't show: a blank text part after the answer, or its thinking", () => {
    expect(needsRetry([user('Hello'), assistant(text('Good afternoon.'), text(''))], false)).toBe(false);
    expect(needsRetry([user('Hello'), assistant(text('Good afternoon.'), { type: 'thinking', content: 'The customer greets me.' })], false)).toBe(false);
    expect(needsRetry([user('Hello'), assistant({ type: 'thinking', content: 'Hmm.' })], false)).toBe(true);
  });

  it("doesn't count the tool-result part that TanStack AI keeps beside a call: the call's line is what the screen shows", () => {
    expect(needsRetry([user('Hello'), assistant(text('Here are three options.'), searchProducts, settled)], false)).toBe(true); // ends in a call
    expect(needsRetry([user('Hello'), assistant(searchProducts, settled, text('Here are three options.'), settled)], false)).toBe(false); // ends in words
  });

  it('is false while a reply is still coming in', () => {
    expect(needsRetry([user('Hello'), assistant(resolveDate)], true)).toBe(false);
    expect(needsRetry([user('Hello'), assistant()], true)).toBe(false);
  });

  it("is false when the customer spoke last, or there is nothing yet, and looks at the last message only", () => {
    expect(needsRetry([], false)).toBe(false);
    expect(needsRetry([user('Hello')], false)).toBe(false);
    expect(needsRetry([user('Hello'), assistant(resolveDate), user('Yes, please.')], false)).toBe(false);
    expect(needsRetry([user('Hello'), assistant(resolveDate), user('Yes, please.'), assistant(text('Done.'))], false)).toBe(false);
  });

  // Asking again drops the last reply and sends the customer's yes again: after a booking, the model books it twice.
  it('is false after a booking went through, even with no words after it', () => {
    expect(needsRetry([...askedToBook, assistant(booked)], false)).toBe(false);
    expect(needsRetry([...askedToBook, assistant(resolveDate, settled, booked, settled)], false)).toBe(false);
    expect(needsRetry([...askedToBook, assistant(booking('complete', stored))], false)).toBe(false); // no isError at all
    expect(needsRetry([...askedToBook, assistant(booked, searchProducts)], false)).toBe(false); // another tool call after it
    expect(needsRetry([...askedToBook, assistant(refused, booked)], false)).toBe(false); // refused, then booked on a second try
    expect(needsRetry([...askedToBook, assistant(booked, refused)], false)).toBe(false); // booked, then a second one refused
  });

  it('allows it after a booking Maison refused (isError): nothing was booked', () => {
    expect(needsRetry([...askedToBook, assistant(refused)], false)).toBe(true);
    expect(needsRetry([...askedToBook, assistant(text('One moment.'), refused, refused)], false)).toBe(true);
  });

  it("is false when it can't tell whether the booking went through: no result yet, or the call failed on the way", () => {
    expect(needsRetry([...askedToBook, assistant(booking('input-streaming'))], false)).toBe(false);
    expect(needsRetry([...askedToBook, assistant(booking('input-complete'))], false)).toBe(false);
    expect(needsRetry([...askedToBook, assistant(booking('error'))], false)).toBe(false);
    expect(needsRetry([...askedToBook, assistant(booking('complete', null))], false)).toBe(false);
  });

  it('still allows it for an empty reply with no tool call, and when the booking was in an earlier reply', () => {
    expect(needsRetry([...askedToBook, assistant()], false)).toBe(true);
    expect(needsRetry([...askedToBook, assistant(settled)], false)).toBe(true);
    // Asking again keeps the earlier replies, so the model still sees that booking.
    expect(needsRetry([...askedToBook, assistant(booked, text('Requested.')), user('Anything else for him?'), assistant(searchProducts)], false)).toBe(true);
  });

  // Under the hand-off's line are the note and its LINE button: they are the answer, with words after them or none.
  it('is false after a hand-off went through, even with no words after it', () => {
    expect(needsRetry([...askedAboutBitcoin, assistant(foundNothing, handedOff)], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(foundNothing, settled, handedOff, settled)], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(handedOff, foundNothing)], false)).toBe(false); // another tool call after it
    expect(needsRetry([...askedAboutCare, assistant(foundAnAnswer, handedOff)], false)).toBe(false); // the call was made, whatever the search found
  });

  // A failed hand-off has the plain note and the LINE chat button under it, but they are no answer: the failure may be a
  // passing one, and "Try again" asks again.
  it('still allows it after a hand-off that failed, with no words after it, though the plain note shows under it', () => {
    expect(needsRetry([...askedAboutBitcoin, assistant(handOff('error'))], false)).toBe(true);
    expect(needsRetry([...askedAboutBitcoin, assistant(handOff('complete', refusal))], false)).toBe(true); // a result that is an error
    expect(needsRetry([...askedAboutBitcoin, assistant(handOff('complete', { content: [] }))], false)).toBe(true); // a result with no reference: nothing says it was recorded
    expect(needsRetry([...askedAboutCare, assistant(foundAnAnswer, handOff('error'))], false)).toBe(true);
    expect(needsRetry([...askedAboutBitcoin, assistant(handOff('error'), settled)], false)).toBe(true);
    expect(needsRetry([...askedAboutBitcoin, assistant(text('One moment.'), handOff('error'))], false)).toBe(true); // the words came before it
  });

  it('is false once words follow a failed hand-off: the customer has something to read', () => {
    expect(needsRetry([...askedAboutBitcoin, assistant(handOff('error'), text('I could not pass it on. Please use the LINE chat.'))], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(handOff('complete', refusal), text('You already have five questions with the advisors.'))], false)).toBe(false);
    expect(needsRetry([...askedAboutCare, assistant(foundAnAnswer, handOff('error'), text('Here is what I found.'))], false)).toBe(false);
  });

  it('still allows it while a hand-off has not finished, with no words after it: no note shows yet', () => {
    expect(needsRetry([...askedAboutBitcoin, assistant(handOff('input-complete'))], false)).toBe(true);
    expect(needsRetry([...askedAboutBitcoin, assistant(handOff('input-streaming'))], false)).toBe(true);
    expect(needsRetry([...askedAboutBitcoin, assistant(foundNothing, handOff('input-complete'))], false)).toBe(true); // the empty search's note waits for it
    expect(needsRetry([...askedAboutBitcoin, assistant(handOff('input-complete'))], true)).toBe(false); // but never while a reply is coming in
  });

  // The local model often skips the hand-off. The chat then shows the note under the search that found nothing (handOffAt).
  it('is false after a search that found nothing, though the model never handed off and wrote nothing', () => {
    expect(needsRetry([...askedAboutBitcoin, assistant(foundNothing)], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(foundNothing, settled)], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(foundNothing, foundNothing)], false)).toBe(false); // two searches, both empty
    expect(needsRetry([...askedAboutBitcoin, assistant(foundNothing, handOff('error'))], false)).toBe(false); // a failed hand-off doesn't take the note away: the search's note is the answer
    expect(needsRetry([...askedAboutBitcoin, assistant(handOff('error'), foundNothing)], false)).toBe(false);
    // A first search that was refused or broke, and a second that found nothing: rule 6 has the model call again, and the last one decides.
    expect(needsRetry([...askedAboutBitcoin, assistant(knowledge('complete', refusal), foundNothing)], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(knowledge('error'), foundNothing)], false)).toBe(false);
  });

  // The app records the question itself when a search finds nothing: the recorded note under that search is the answer.
  it('is false after a search the app handed the question to staff for, with no words after it, whatever the model did next', () => {
    expect(needsRetry([...askedAboutBitcoin, assistant(handedOffBySearch)], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(handedOffBySearch, settled)], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(handedOffBySearch, handedOff)], false)).toBe(false); // the model's call after it, answered with the same reference
    expect(needsRetry([...askedAboutBitcoin, assistant(handedOffBySearch, handOff('error'))], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(handedOffBySearch, handOff('input-complete'))], false)).toBe(false); // the note stays while a second call runs
    expect(needsRetry([...askedAboutBitcoin, assistant(handedOffBySearch, foundNothing)], false)).toBe(false); // a second search
    expect(needsRetry([...askedAboutBitcoin, assistant(foundNothing, handedOffBySearch)], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(handedOffBySearch, foundAnAnswer)], false)).toBe(false);
    expect(needsRetry([...askedAboutBitcoin, assistant(handedOffBySearch)], true)).toBe(false); // and never while a reply is coming in
  });

  it('still allows it after a search that found entries, failed or has not finished, with no words after it', () => {
    expect(needsRetry([...askedAboutCare, assistant(foundAnAnswer)], false)).toBe(true);
    expect(needsRetry([...askedAboutCare, assistant(foundNothing, foundAnAnswer)], false)).toBe(true);
    expect(needsRetry([...askedAboutBitcoin, assistant(knowledge('error'))], false)).toBe(true);
    expect(needsRetry([...askedAboutBitcoin, assistant(knowledge('complete', refusal))], false)).toBe(true);
    expect(needsRetry([...askedAboutBitcoin, assistant(knowledge('input-complete'))], false)).toBe(true);
    expect(needsRetry([...askedAboutBitcoin, assistant(foundNothing, knowledge('input-complete'))], false)).toBe(true); // a second search is under way
    expect(needsRetry([...askedAboutBitcoin, assistant(foundNothing, knowledge('complete', refusal))], false)).toBe(true); // the last search was refused
  });

  // The visit picker (lib/visit-picker.ts). Asking again drops the reply: a waiting picker with it, or, after a request,
  // the reply is asked for again, and the visit could be booked twice.
  describe('with a visit picker', () => {
    const picker = (state: string, output?: unknown): Part => call('choose_visit', state, output);
    const requestedVisit = picker('complete', { status: 'requested', appointment: { reference: 'APT-0042', status: 'requested' } });
    const closedPicker = picker('complete', { status: 'closed' });
    const askedToVisit = [user('Can we schedule one?')];
    

    it('is false while a picker waits for the customer, with no words after it', () => {
      expect(needsRetry([...askedToVisit, assistant(picker('input-complete'))], false)).toBe(false);
      expect(needsRetry([...askedToVisit, assistant(text('Here it is.'), picker('input-complete'))], false)).toBe(false);
      expect(needsRetry([...askedToVisit, assistant(resolveDate, settled, picker('input-complete'))], false)).toBe(false);
    });

    it('is false once the picker requested a visit, with no words after it, and after an empty reply to it', () => {
      expect(needsRetry([...askedToVisit, assistant(requestedVisit)], false)).toBe(false);
      expect(needsRetry([...askedToVisit, assistant(requestedVisit, settled)], false)).toBe(false);
      expect(needsRetry([...askedToVisit, assistant(requestedVisit, settled, text(' '))], false)).toBe(false);
    });

    // With no reply coming in, a call still at input-streaming is one the reply was cut off in: no form ever shows for it.
    it('allows it after a choose_visit call that was cut off while it came in, and not while the reply still comes in', () => {
      expect(needsRetry([...askedToVisit, assistant(picker('input-streaming'))], false)).toBe(true);
      expect(needsRetry([...askedToVisit, assistant(text('Here it is.'), picker('input-streaming'))], false)).toBe(true);
      expect(needsRetry([...askedToVisit, assistant(picker('input-streaming'))], true)).toBe(false);
    });

    it('still allows it after a picker the customer closed, when no words came after it: nothing was booked', () => {
      expect(needsRetry([...askedToVisit, assistant(closedPicker, settled)], false)).toBe(true);
      expect(needsRetry([...askedToVisit, assistant(closedPicker, settled, text('Happy to help with anything else.'))], false)).toBe(false);
    });

    // ai-client's reload() removes every message after the last user message. A reply after a picker answer is a new
    // assistant message with no user message between, so the booking sits in an earlier message than the last.
    it('is false when the booking is in an earlier message after the last user message, and the last one has tool calls only', () => {
      const bookedByPicker = assistant(text('Pick the details here.'), requestedVisit, booked);
      expect(needsRetry([...askedToVisit, bookedByPicker, assistant(searchProducts)], false)).toBe(false);
      expect(needsRetry([...askedToVisit, bookedByPicker, assistant(searchProducts, settled)], false)).toBe(false);
      expect(needsRetry([...askedToVisit, assistant(booked), assistant(searchProducts)], false)).toBe(false);
    });

    it('is false when a picker waits, or a recorded hand-off answered, in an earlier message after the last user message', () => {
      expect(needsRetry([...askedToVisit, assistant(picker('input-complete')), assistant(searchProducts)], false)).toBe(false);
      expect(needsRetry([...askedToVisit, assistant(handedOff), assistant(searchProducts)], false)).toBe(false);
    });

    it('still allows it when only an earlier message holds a failed hand-off, a refused booking or a closed picker', () => {
      expect(needsRetry([...askedToVisit, assistant(handOff('error')), assistant(searchProducts)], false)).toBe(true);
      expect(needsRetry([...askedToVisit, assistant(refused), assistant(searchProducts)], false)).toBe(true);
      expect(needsRetry([...askedToVisit, assistant(closedPicker), assistant(searchProducts)], false)).toBe(true);
    });

    it('ignores a booking from before the last user message', () => {
      expect(needsRetry([...askedToVisit, assistant(requestedVisit, booked), user('Anything else?'), assistant(searchProducts)], false)).toBe(true);
    });

    it('allows it on a later reply that is empty, when the visit was requested in an earlier one', () => {
      expect(needsRetry([...askedToVisit, assistant(requestedVisit, settled, text('Requested.')), user('Anything else for him?'), assistant(searchProducts)], false)).toBe(true);
    });
  });
});
