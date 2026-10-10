import type { UIMessage } from '@tanstack/ai';
import { describe, expect, it } from 'vitest';

import { CHOOSE_VISIT } from '../visit-picker';
import {
  PICKER_NOTE,
  TURN_BUDGET_MS,
  callsMyAppointments,
  callsPicker,
  cutTo,
  earlierResultsOf,
  foundNothing,
  lastQuestionOf,
  loggedReplyOf,
  needsPickerPass,
  notFoundOf,
  pickerPassBudget,
  pieceOfSearch,
  piecesFoundBy,
  recordedQuestionOf,
  refusalTextOf,
  secondsOf,
  showsPicker,
  toolResultsOf,
  turnFactsOf,
  turnReplyOf,
  visitRequestedIn,
  type TurnPart,
} from './turn';

/**
 * A tool call as TanStack AI holds it in the turn's message: a `tool-call` part with the tool's name, its state, and its
 * output once the result is in (for a Maison tool, the MCP result, in `structuredContent` and `isError`).
 */
const call = (name: string, state: string, output?: unknown, input?: unknown): TurnPart => ({
  type: 'tool-call',
  id: `call-${name}`,
  name,
  state,
  ...(input === undefined ? {} : { input }),
  ...(output === undefined ? {} : { output }),
});
/** A call that came back whole. */
const done = (name: string, output: unknown, input?: unknown) => call(name, 'complete', output, input);
const text = (content: string): TurnPart => ({ type: 'text', content });
/** The part TanStack AI keeps beside a finished call. */
const resultPart: TurnPart = { type: 'tool-result' };

describe('turnFactsOf', () => {
  /** A search_knowledge result as Strapi gives it, with the entries it found. */
  const searchOf = (...entries: unknown[]) => done('search_knowledge', { content: [], structuredContent: { locale: 'en', entries } });
  /** A search that found nothing and whose question the app handed to staff itself: its result carries what Strapi recorded (withAutoHandOff). */
  const searchHandedOff = (reference: string) =>
    done('search_knowledge', { content: [], structuredContent: { locale: 'en', entries: [], handOff: { reference, question: 'Can it hold a watch?', product: null } } });
  /** A hand_off_to_staff result as Strapi gives it when it recorded the question. */
  const handOffOf = (reference: string) => done('hand_off_to_staff', { content: [], structuredContent: { question: { reference, status: 'open', product: null } } });
  /** Any tool's result when Strapi refuses the call. */
  const refusedBy = (name: string) => done(name, { isError: true, content: [{ type: 'text', text: '{"error":{"code":"too_many_open_questions"}}' }] });
  const nothing = { knowledgeFound: false, handedOff: false, questionReference: null };

  it("says knowledge answered when a search_knowledge result has an entry, in any of the turn's searches", () => {
    expect(turnFactsOf([searchOf({ title: 'How do I care for the leather?' })])).toStrictEqual({ ...nothing, knowledgeFound: true });
    expect(turnFactsOf([searchOf(), searchOf({ title: 'Delivery' }), searchOf()])).toStrictEqual({ ...nothing, knowledgeFound: true });
  });

  it('says it did not when there was no search, or every search found nothing', () => {
    expect(turnFactsOf([])).toStrictEqual(nothing);
    expect(turnFactsOf([searchOf(), searchOf()])).toStrictEqual(nothing);
  });

  it('takes the question a hand-off recorded: handed off, with its reference', () => {
    expect(turnFactsOf([handOffOf('Q-1234')])).toStrictEqual({ knowledgeFound: false, handedOff: true, questionReference: 'Q-1234' });
    // It was after an empty search, as the model makes it in a turn that follows rule 9.
    expect(turnFactsOf([searchOf(), handOffOf('Q-1234')])).toStrictEqual({ knowledgeFound: false, handedOff: true, questionReference: 'Q-1234' });
  });

  it("takes the question the app's own hand-off recorded, which the search's result carries: the same", () => {
    expect(turnFactsOf([searchHandedOff('Q-1234')])).toStrictEqual({ knowledgeFound: false, handedOff: true, questionReference: 'Q-1234' });
    // And with the model's own call after it, which Strapi's tool answers with the recorded question.
    expect(turnFactsOf([searchHandedOff('Q-1234'), handOffOf('Q-1234')])).toStrictEqual({ knowledgeFound: false, handedOff: true, questionReference: 'Q-1234' });
  });

  it('keeps the first question recorded when a turn names two', () => {
    expect(turnFactsOf([handOffOf('Q-0001'), handOffOf('Q-0002')]).questionReference).toBe('Q-0001');
    expect(turnFactsOf([searchHandedOff('Q-0003'), handOffOf('Q-0004')]).questionReference).toBe('Q-0003');
  });

  it('says nothing was handed off for a hand-off Strapi refused, with no question', () => {
    expect(turnFactsOf([refusedBy('hand_off_to_staff')])).toStrictEqual(nothing);
    // Even a refusal that carries a question: it was refused, so it is not recorded.
    const refusedWithQuestion = done('hand_off_to_staff', { ...(handOffOf('Q-1234').output as object), isError: true });
    expect(turnFactsOf([refusedWithQuestion])).toStrictEqual(nothing);
    // A refusal doesn't take away what the turn did before it.
    expect(turnFactsOf([searchOf({ title: 'Delivery' }), refusedBy('hand_off_to_staff')])).toStrictEqual({ ...nothing, knowledgeFound: true });
  });

  it("counts only a whole search_knowledge result's entries, and takes a reference only from a search's hand-off or hand_off_to_staff", () => {
    const refusedWithEntries = done('search_knowledge', { isError: true, content: [], structuredContent: { entries: [{ title: 'Care' }], handOff: { reference: 'Q-1234' } } });
    const unreadable: Array<[string, TurnPart]> = [
      ['a refused search, whatever it carries', refusedWithEntries],
      ['a search with no structuredContent', done('search_knowledge', { content: [{ type: 'text', text: '{"entries":[{}]}' }] })],
      ['a search with entries that is no list', done('search_knowledge', { content: [], structuredContent: { entries: { title: 'Care' } } })],
      ['a search whose hand-off has no reference', done('search_knowledge', { content: [], structuredContent: { entries: [], handOff: { question: 'Can it hold a watch?' } } })],
      ['a search whose hand-off reference is empty', done('search_knowledge', { content: [], structuredContent: { entries: [], handOff: { reference: '' } } })],
      ['a search whose hand-off reference is no string', done('search_knowledge', { content: [], structuredContent: { entries: [], handOff: { reference: 1234 } } })],
      ['a hand-off with no reference', done('hand_off_to_staff', { content: [], structuredContent: { question: { status: 'open', product: null } } })],
      ["another tool's entries", done('search_products', { content: [], structuredContent: { entries: [{ title: 'Care' }] } })],
      ["another tool's question", done('request_appointment', { content: [], structuredContent: { question: { reference: 'Q-1234' }, handOff: { reference: 'Q-1234' } } })],
      ['a search that answered null', done('search_knowledge', null)],
      ['a hand-off that answered text', done('hand_off_to_staff', 'Q-1234')],
    ];
    for (const [what, part] of unreadable) expect(turnFactsOf([part]), what).toStrictEqual(nothing);
  });

  it('reads calls that came back whole, and skips the rest: a call still running, one that broke on the way, and parts that are no call', () => {
    const entries = { content: [], structuredContent: { locale: 'en', entries: [{ title: 'Care' }], handOff: { reference: 'Q-1234' } } };
    for (const state of ['awaiting-input', 'input-streaming', 'input-complete', 'error']) {
      expect(turnFactsOf([call('search_knowledge', state, entries)]), state).toStrictEqual(nothing);
    }
    // TanStack AI keeps a tool-result part beside a call, and a text part holds words: neither is read.
    expect(turnFactsOf([text('Q-1234'), { type: 'tool-result', content: JSON.stringify(entries) }, { type: 'thinking', content: 'x' }])).toStrictEqual(nothing);
    expect(turnFactsOf([searchOf({ title: 'Delivery' }), resultPart, text('It takes two days.')])).toStrictEqual({ ...nothing, knowledgeFound: true });
  });
});

describe('turnReplyOf', () => {
  it("is the turn's text parts in order, joined with a blank line: the words of every step, as the customer read them", () => {
    expect(turnReplyOf([text('Let me check.'), call('search_knowledge', 'complete'), resultPart, text('It holds one watch.')])).toBe('Let me check.\n\nIt holds one watch.');
    expect(turnReplyOf([text('One.'), text('Two.'), text('Three.')])).toBe('One.\n\nTwo.\n\nThree.');
  });

  it('trims the whole of it, at both ends', () => {
    expect(turnReplyOf([text('  Hello.'), text('Goodbye.  \n')])).toBe('Hello.\n\nGoodbye.');
    expect(turnReplyOf([text('  \n Noted. \n')])).toBe('Noted.');
  });

  it("is '' when there are no text parts: tool calls and thinking aren't words the customer read", () => {
    expect(turnReplyOf([])).toBe('');
    expect(turnReplyOf([call('resolve_date', 'complete'), resultPart, { type: 'thinking', content: 'Let me think.' }])).toBe('');
    expect(turnReplyOf([text('  \n')])).toBe('');
  });

  it('skips a text part that has no text', () => {
    expect(turnReplyOf([{ type: 'text' }, text('Noted.')])).toBe('Noted.');
  });
});

describe('cutTo', () => {
  it('leaves text that fits as it is, and cuts the rest to the limit, by UTF-16 units as Strapi counts', () => {
    expect(cutTo('x'.repeat(8000), 8000)).toBe('x'.repeat(8000));
    expect(cutTo('x'.repeat(8001), 8000)).toBe('x'.repeat(8000));
    expect(cutTo('あ'.repeat(9000), 8000)).toBe('あ'.repeat(8000));
  });

  it('never cuts through half of an emoji, and leaves no blanks at the end of the cut', () => {
    expect(cutTo(`${'a'.repeat(7999)}😀${'b'.repeat(50)}`, 8000)).toBe('a'.repeat(7999));
    expect(cutTo(`${'a'.repeat(7998)}😀${'b'.repeat(50)}`, 8000)).toBe(`${'a'.repeat(7998)}😀`);
    for (const cut of [cutTo(`${'a'.repeat(7999)}😀`, 8000), cutTo(`${'a'.repeat(7998)}😀😀`, 8000)]) expect(cut.isWellFormed()).toBe(true);
    expect(cutTo('ab   cd', 4)).toBe('ab');
  });
});

describe('lastQuestionOf', () => {
  const part = (content: string) => ({ type: 'text' as const, content });
  const user = (parts: Array<{ type: 'text'; content: string }>): UIMessage => ({ id: 'u1', role: 'user', parts });
  const say = (content: string, id = 'u1'): UIMessage => ({ id, role: 'user', parts: [part(content)] });
  const assistant = (content: string): UIMessage => ({ id: 'a1', role: 'assistant', parts: [part(content)] });

  it("is the customer's last message: its text parts, trimmed, and cut to the 1000 characters the tool takes, never through half an emoji", () => {
    const cases: Array<[string, UIMessage[], string]> = [
      ['trimmed', [say('  Can it hold a watch? \n\n')], 'Can it hold a watch?'],
      ['the last of the customer’s messages', [say('Hello'), say('Is it waterproof?', 'u2'), assistant('Let me look.')], 'Is it waterproof?'],
      ['a message of several parts', [user([part('Can it hold'), part('a watch?')])], 'Can it hold\na watch?'],
      ['cut at 1000', [user([part('a'.repeat(600)), part('b'.repeat(600))])], `${'a'.repeat(600)}\n${'b'.repeat(399)}`],
      ['cut at 1000 in Japanese', [user([part('あ'.repeat(1000)), part('い')])], 'あ'.repeat(1000)],
      ['not through half an emoji', [user([part('a'.repeat(998)), part('😀😀')])], 'a'.repeat(998)],
      ['with the emoji whole when it fits', [user([part('a'.repeat(997)), part('😀')])], `${'a'.repeat(997)}\n😀`],
    ];
    for (const [what, messages, question] of cases) {
      expect(lastQuestionOf(messages), what).toBe(question);
      expect(lastQuestionOf(messages).length, what).toBeLessThanOrEqual(1000);
    }
  });

  it('is empty when there is nothing in it: no message of the customer, no text, or only blanks', () => {
    expect(lastQuestionOf([])).toBe('');
    expect(lastQuestionOf([assistant('Hello.')])).toBe('');
    expect(lastQuestionOf([say(' \n ')])).toBe('');
    const thinkingOnly: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'thinking', content: 'x' }] };
    expect(lastQuestionOf([thinkingOnly])).toBe('');
  });
});

describe('pieceOfSearch', () => {
  // Which piece the app records is the piece the search was about, which is not always the page's: the one piece the search
  // names; else the page's piece when the search names none or includes it; else none.
  it('is the piece the search names when it names exactly one, whatever page the customer is on', () => {
    const cases: Array<[string, string | null, unknown, string]> = [
      ["on another piece's page", 'jewelry-coffret', ['weekender-50'], 'weekender-50'],
      ['on no page', null, ['weekender-50'], 'weekender-50'],
      ["on that piece's own page", 'jewelry-coffret', ['jewelry-coffret'], 'jewelry-coffret'],
      ['named twice, which is one piece', 'jewelry-coffret', ['weekender-50', 'weekender-50'], 'weekender-50'],
      ['beside a value that is no slug', 'jewelry-coffret', ['weekender-50', '../etc'], 'weekender-50'],
    ];
    for (const [what, page, productSlugs, slug] of cases) expect(pieceOfSearch({ query: 'watch', productSlugs }, page), what).toBe(slug);
  });

  it("is the page's piece when the search names no piece, or its slugs include the page's piece", () => {
    const cases: Array<[string, unknown]> = [
      ['no productSlugs', undefined],
      ['an empty list', []],
      ["null, which the local model sends for what it isn't using", null],
      ['a value that is no slug, which names no piece', ['../etc']],
      ["several pieces, the page's first", ['jewelry-coffret', 'weekender-50']],
      ["several pieces, the page's last", ['weekender-50', 'voyage-trunk', 'jewelry-coffret']],
    ];
    for (const [what, productSlugs] of cases) expect(pieceOfSearch({ query: 'watch', productSlugs }, 'jewelry-coffret'), what).toBe('jewelry-coffret');
  });

  it("is none when the search names several and none is the page's, or it names none and there is no page", () => {
    const cases: Array<[string, string | null, unknown]> = [
      ["several pieces, none the page's", 'jewelry-coffret', ['weekender-50', 'voyage-trunk']],
      ['several pieces, on no page', null, ['weekender-50', 'voyage-trunk']],
      ['an empty list, on no page', null, []],
      ['no productSlugs, on no page', null, undefined],
    ];
    for (const [what, page, productSlugs] of cases) expect(pieceOfSearch({ query: 'watch', productSlugs }, page), what).toBeNull();
  });

  it('reads input that is no object as one that names no piece', () => {
    for (const input of [undefined, null, 'weekender-50', ['weekender-50'], 42]) {
      expect(pieceOfSearch(input, 'jewelry-coffret'), JSON.stringify(input)).toBe('jewelry-coffret');
      expect(pieceOfSearch(input, null), JSON.stringify(input)).toBeNull();
    }
  });
});

describe("Strapi's answers", () => {
  const text = (value: string) => ({ type: 'text', text: value });
  const error = (code: string, message = 'No such product.', hint = 'Call search_products.') => ({ isError: true, content: [text(JSON.stringify({ error: { code, message, hint } }))] });
  const recorded = (reference: string, product: unknown = null) => ({ content: [], structuredContent: { question: { reference, status: 'open', product } } });

  it('reads the question a hand-off recorded: its reference and its piece, and nothing from a refusal or an answer with no reference', () => {
    expect(recordedQuestionOf(recorded('Q-1234'))).toEqual({ reference: 'Q-1234', status: 'open', product: null });
    expect(recordedQuestionOf(recorded('Q-1234', { slug: 'jewelry-coffret', name: 'Jewelry Coffret' }))?.product).toEqual({ slug: 'jewelry-coffret', name: 'Jewelry Coffret' });
    expect(recordedQuestionOf(recorded('Q-1234', { slug: 'jewelry-coffret' }))?.product).toBeNull(); // a piece with no name is none
    for (const answer of [null, undefined, 'Q-1234', {}, error('too_many_open_questions'), { ...recorded('Q-1234'), isError: true }, { content: [], structuredContent: { question: { reference: '' } } }, recorded('')]) {
      expect(recordedQuestionOf(answer), JSON.stringify(answer)).toBeNull();
    }
  });

  it("gives Strapi's refusal as it gave it, cut to 300, for the log: none for any other answer", () => {
    expect(refusalTextOf(error('too_many_open_questions'))).toBe(JSON.stringify({ error: { code: 'too_many_open_questions', message: 'No such product.', hint: 'Call search_products.' } }));
    expect(refusalTextOf({ isError: true, content: [text('x'.repeat(400))] })).toBe('x'.repeat(300));
    for (const answer of [null, 'no', {}, recorded('Q-1234'), { isError: true }, { isError: true, content: [] }, { isError: true, content: [{ type: 'image' }] }]) {
      expect(refusalTextOf(answer), JSON.stringify(answer)).toBeUndefined();
    }
  });

  it("gives Strapi's words for a not_found refusal, its message and its hint, and none for any other answer", () => {
    expect(notFoundOf(error('not_found'))).toBe('No such product. Call search_products.');
    expect(notFoundOf(error('not_found', 'No such product.', ''))).toBe('No such product.');
    for (const answer of [error('invalid_input'), { isError: true, content: [text('not json')] }, { isError: true, content: [text('null')] }, { ...error('not_found'), isError: false }, { content: [] }, null, 'not_found']) {
      expect(notFoundOf(answer), JSON.stringify(answer)).toBeNull();
    }
    expect(notFoundOf({ isError: true, content: [text(JSON.stringify({ error: { code: 'not_found' } }))] })).toBeNull(); // no message to give
  });

  it('knows a search_knowledge result that came back whole and found nothing', () => {
    expect(foundNothing({ content: [], structuredContent: { entries: [] } })).toBe(true);
    for (const answer of [{ content: [], structuredContent: { entries: [{}] } }, { content: [], structuredContent: {} }, { content: [] }, { isError: true, content: [], structuredContent: { entries: [] } }, null]) {
      expect(foundNothing(answer), JSON.stringify(answer)).toBe(false);
    }
  });
});

describe("the picker's safety net", () => {
  const picker = (state: string, output?: unknown) => call(CHOOSE_VISIT, state, output, { productSlugs: ['cabin-case-55'] });
  const found = (...products: unknown[]) => done('search_products', { content: [], structuredContent: { products } });
  const viewed = (product: unknown) => done('view_product', { content: [], structuredContent: { product } });
  const cabinCase = { slug: 'cabin-case-55', name: 'Cabin Case 55' };
  const requested = picker('complete', { status: 'requested', appointment: { reference: 'APT-0042' } });
  const assistant = (...parts: TurnPart[]) => ({ role: 'assistant', parts });
  const user = (content: string) => ({ role: 'user', parts: [text(content)] });

  describe('showsPicker and callsPicker', () => {
    it('say a turn showed a picker for a choose_visit call that waits or was answered', () => {
      for (const part of [picker('input-streaming'), picker('input-complete'), picker('complete', { status: 'closed' }), requested]) {
        expect(showsPicker([text('Here it is.'), part]), part.state).toBe(true);
        expect(callsPicker([part]), part.state).toBe(true);
      }
    });

    it('say a call the server refused showed none, though it was called: a call that ended in an error, or one answered with a refusal', () => {
      const refused = [picker('error', { error: 'Invalid input' }), picker('complete', { isError: true, content: [] }), picker('complete', { error: 'not_found' })];
      for (const part of refused) {
        expect(showsPicker([part]), JSON.stringify(part)).toBe(false);
        expect(callsPicker([part]), JSON.stringify(part)).toBe(true);
      }
    });

    it('say neither for any other tool, or for parts that are no call', () => {
      const parts = [text('choose_visit'), call('search_products', 'complete'), { type: 'tool-result', content: 'choose_visit' }, { type: 'thinking', content: 'choose_visit' }];
      expect(showsPicker(parts)).toBe(false);
      expect(callsPicker(parts)).toBe(false);
      expect(showsPicker([])).toBe(false);
    });
  });

  describe('loggedReplyOf', () => {
    it("is the turn's words, and, when the turn shows a picker, the note on a paragraph of its own, or alone when no words came before it", () => {
      expect(loggedReplyOf([text('Here are two pieces.')])).toBe('Here are two pieces.');
      expect(loggedReplyOf([text('Here it is.'), picker('input-complete')])).toBe(`Here it is.\n\n${PICKER_NOTE}`);
      expect(loggedReplyOf([picker('input-complete')])).toBe(PICKER_NOTE);
      expect(loggedReplyOf([text('One.'), picker('input-complete'), text('Two.')])).toBe(`One.\n\nTwo.\n\n${PICKER_NOTE}`);
    });

    it('adds no note for a call the server refused: no picker was shown', () => {
      expect(loggedReplyOf([text('Let me try again.'), picker('error', { error: 'Invalid input' })])).toBe('Let me try again.');
      expect(PICKER_NOTE).toBe('(The concierge showed a visit picker so the customer can request a visit.)');
    });
  });

  describe('callsMyAppointments', () => {
    it('says the turn asked about the visits the customer has, in any state', () => {
      expect(callsMyAppointments([call('my_appointments', 'complete')])).toBe(true);
      expect(callsMyAppointments([text('Let me check.'), call('my_appointments', 'input-complete')])).toBe(true);
      expect(callsMyAppointments([call('search_products', 'complete'), text('my_appointments')])).toBe(false);
    });
  });

  describe('piecesFoundBy', () => {
    it("names the pieces a search_products result's products or a view_product result's product have, by slug", () => {
      expect(piecesFoundBy({ toolName: 'search_products', output: { structuredContent: { products: [cabinCase, { slug: 'weekender-50' }] } } })).toEqual(['cabin-case-55', 'weekender-50']);
      expect(piecesFoundBy({ toolName: 'view_product', output: { structuredContent: { product: cabinCase } } })).toEqual(['cabin-case-55']);
    });

    it("names none for a refusal, a result with no structuredContent, any other tool, and a value that isn't a slug", () => {
      const none: Array<{ toolName: string; output: unknown }> = [
        { toolName: 'search_products', output: { isError: true, structuredContent: { products: [cabinCase] } } },
        { toolName: 'search_products', output: { content: [] } },
        { toolName: 'search_products', output: null },
        { toolName: 'find_boutiques', output: { structuredContent: { products: [cabinCase] } } },
        { toolName: 'search_products', output: { structuredContent: { products: [{ slug: 'Cabin Case' }, { slug: 42 }, null, 'cabin-case-55'] } } },
        { toolName: 'view_product', output: { structuredContent: { product: { slug: '../etc' } } } },
        { toolName: 'view_product', output: { structuredContent: { products: [cabinCase] } } },
        { toolName: 'search_products', output: { structuredContent: { product: cabinCase } } },
      ];
      for (const result of none) expect(piecesFoundBy(result), JSON.stringify(result)).toEqual([]);
    });
  });

  describe('toolResultsOf and earlierResultsOf', () => {
    it("give each call that came back whole: its tool's name and its result", () => {
      const parts = [text('x'), found(cabinCase), call('view_product', 'input-complete'), call('search_products', 'error', { error: 'x' }), resultPart, viewed(cabinCase)];
      expect(toolResultsOf(parts)).toEqual([
        { toolName: 'search_products', output: { content: [], structuredContent: { products: [cabinCase] } } },
        { toolName: 'view_product', output: { content: [], structuredContent: { product: cabinCase } } },
      ]);
    });

    it("give the tool calls in the conversation's earlier replies that came back whole, and none of the customer's messages", () => {
      const messages = [
        { role: 'user', parts: [found(cabinCase)] },
        assistant(found(cabinCase), call('view_product', 'input-complete')),
        user('And a bag?'),
        assistant(viewed({ slug: 'weekender-50' })),
      ];
      expect(earlierResultsOf(messages).map((result) => result.toolName)).toEqual(['search_products', 'view_product']);
      expect(earlierResultsOf([])).toEqual([]);
    });
  });

  describe('visitRequestedIn', () => {
    it('says a visit was requested in this chat when a choose_visit call has the answer requested, whatever the visit it carries', () => {
      expect(visitRequestedIn([user('Can I book a visit?'), assistant(requested)])).toBe(true);
      expect(visitRequestedIn([assistant(picker('complete', { status: 'requested' }))])).toBe(true); // the status is enough
      expect(visitRequestedIn([assistant(requested, text('Requested.')), user('Anything else?'), assistant(text('No.'))])).toBe(true);
    });

    it("says it wasn't for a picker that is closed, waiting, refused or unanswerable, and for another tool with the same answer", () => {
      const parts = [
        picker('complete', { status: 'closed' }),
        picker('input-complete'),
        picker('complete', { status: 'maybe' }),
        picker('error', { error: 'Invalid input' }),
        picker('complete', null),
        call('request_appointment', 'complete', { status: 'requested' }),
        text('requested'),
      ];
      for (const part of parts) expect(visitRequestedIn([assistant(part)]), JSON.stringify(part)).toBe(false);
      expect(visitRequestedIn([])).toBe(false);
    });

    it("reads a customer's own message the same way: a part there is no answer", () => {
      expect(visitRequestedIn([{ role: 'user', parts: [text('requested')] }])).toBe(false);
    });
  });

  describe('needsPickerPass', () => {
    const ASKED = 'I would like to book a visit to see cabin case';
    /** A turn that asked for a visit, with a piece known from the page, and ended in words: the safety net runs. */
    const base = { resumed: false, question: ASKED, piece: 'cabin-case-55', messages: [user(ASKED)], turnParts: [text('Which boutique, day and time would you like?')] };

    it('runs for a booking request with a known piece that ended in words', () => {
      expect(needsPickerPass(base)).toBe(true);
    });

    it("knows a piece search_products or view_product found in this turn, or in an earlier reply of the conversation, with no page's piece", () => {
      expect(needsPickerPass({ ...base, piece: null })).toBe(false);
      expect(needsPickerPass({ ...base, piece: null, turnParts: [found(cabinCase), text('Which boutique?')] })).toBe(true);
      expect(needsPickerPass({ ...base, piece: null, turnParts: [viewed(cabinCase), text('Which boutique?')] })).toBe(true);
      const earlier = [user('Show me cases'), assistant(found(cabinCase), text('Here it is.')), user(ASKED)];
      expect(needsPickerPass({ ...base, piece: null, messages: earlier })).toBe(true);
      // A search that found nothing, or was refused, names no piece.
      expect(needsPickerPass({ ...base, piece: null, turnParts: [found(), done('search_products', { isError: true, content: [] })] })).toBe(false);
      expect(needsPickerPass({ ...base, piece: null, turnParts: [call('search_products', 'error', { error: 'x' })] })).toBe(false);
    });

    it("doesn't run for a message that isn't a booking request", () => {
      for (const question of ['What do you have', 'Yes', 'Can I cancel my appointment?', '', '予約を確認したいです']) {
        expect(needsPickerPass({ ...base, question }), question).toBe(false);
      }
      expect(needsPickerPass({ ...base, question: '予約したいです。' })).toBe(true);
    });

    it("doesn't run on a resume: the picker's answer continues a turn that was the customer's", () => {
      expect(needsPickerPass({ ...base, resumed: true })).toBe(false);
    });

    it("doesn't run once the turn called choose_visit, in any state, a refused one included", () => {
      for (const part of [picker('input-complete'), picker('complete', { status: 'closed' }), picker('error', { error: 'Invalid input' }), picker('complete', { isError: true, content: [] })]) {
        expect(needsPickerPass({ ...base, turnParts: [text('Here it is.'), part] }), part.state).toBe(false);
      }
    });

    it("doesn't run once a visit was requested in this chat: after that, the model alone decides", () => {
      expect(needsPickerPass({ ...base, messages: [user('Can we schedule one?'), assistant(requested, text('Requested.')), user(ASKED)] })).toBe(false);
      // A picker that was only closed doesn't stop it.
      expect(needsPickerPass({ ...base, messages: [assistant(picker('complete', { status: 'closed' })), user(ASKED)] })).toBe(true);
    });

    it('does not run when the turn called my_appointments: the customer asked about the visits they have', () => {
      expect(needsPickerPass({ ...base, turnParts: [call('my_appointments', 'complete'), text('You have none.')] })).toBe(false);
    });
  });

  describe('pickerPassBudget and secondsOf', () => {
    it("is what is left of the turn's 55 seconds, 20 at most", () => {
      expect(TURN_BUDGET_MS).toBe(55_000);
      expect(pickerPassBudget(0)).toEqual({ ms: 20_000 });
      expect(pickerPassBudget(30_000)).toEqual({ ms: 20_000 }); // 25 are left: 20 at most
      expect(pickerPassBudget(35_000)).toEqual({ ms: 20_000 });
      expect(pickerPassBudget(40_000)).toEqual({ ms: 15_000 });
      expect(pickerPassBudget(50_000)).toEqual({ ms: 5_000 }); // the least the pass is worth starting with
    });

    it('says what is left when under 5 seconds would be, for the pass to be skipped with a warning', () => {
      expect(pickerPassBudget(50_001)).toEqual({ left: 4_999 });
      expect(pickerPassBudget(51_000)).toEqual({ left: 4_000 });
      expect(pickerPassBudget(56_000)).toEqual({ left: -1_000 });
    });

    it('takes other limits when it is given them, for a test or a host with another route time', () => {
      const limits = { budgetMs: 1_000, maxMs: 300, minMs: 100 };
      expect(pickerPassBudget(0, limits)).toEqual({ ms: 300 });
      expect(pickerPassBudget(800, limits)).toEqual({ ms: 200 });
      expect(pickerPassBudget(950, limits)).toEqual({ left: 50 });
      expect(pickerPassBudget(0, { maxMs: 4_000 })).toEqual({ ms: 4_000 }); // a limit it is not given stays as it was
    });

    it('writes seconds for the log: 15 for 15000, 4.2 for 4200', () => {
      expect(secondsOf(15_000)).toBe(15);
      expect(secondsOf(4_200)).toBe(4.2);
      expect(secondsOf(4_999)).toBe(5);
      expect(secondsOf(0)).toBe(0);
    });
  });
});
