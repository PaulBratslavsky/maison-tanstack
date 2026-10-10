import { describe, expect, it } from 'vitest';

import { handOffAt, toolPartOf, toolView } from './tool-view';

/**
 * What Strapi answers to a hand_off_to_staff it recorded, as the server's MCP wrapper passes it on: the question's reference, its
 * status, and its piece (null when it isn't about one).
 */
const recorded = (reference = 'Q-4821') => ({
  content: [{ type: 'text', text: JSON.stringify({ question: { reference, status: 'open', product: null } }) }],
  structuredContent: { question: { reference, status: 'open', product: null } },
});
/** What the model sent: a Maison tool's part holds it as `input`. */
const asked = { question: 'Can it hold a watch?', reason: 'no_answer', productSlug: 'jewelry-coffret', locale: 'en' };
/**
 * What search_knowledge answers when it found nothing and the app's server handed the question to staff itself
 * (withAutoHandOff in lib/concierge/): the entries, none, with what Strapi recorded in `handOff`, and a sentence for the
 * model after the entries' text.
 */
const searchedAndHandedOff = (reference = 'Q-4821', question = 'Can it hold a watch?', product: { slug: string; name: string } | null = null) => ({
  content: [
    { type: 'text', text: JSON.stringify({ locale: 'en', entries: [] }) },
    { type: 'text', text: `No entry answers this, so the question was passed to Maison's client advisors as ${reference}. Don't call hand_off_to_staff for it.` },
  ],
  structuredContent: { locale: 'en', entries: [], handOff: { reference, question, product } },
});

describe('toolView', () => {
  it('counts what search_knowledge found, on an MCP line, with no hand-off', () => {
    const output = { content: [{ type: 'text', text: '{}' }], structuredContent: { locale: 'en', entries: [{ title: 'A' }, { title: 'B' }] } };
    const view = toolView({ toolName: 'search_knowledge', state: 'complete', output }, 'en');
    expect(view.line).toBe('MCP · search_knowledge ✓ 2 results');
    expect(view.handOff).toBeNull();
  });

  it('still names the day resolve_date worked out', () => {
    const output = { date: '2026-10-10', weekday: 'Saturday', isPast: false };
    expect(toolView({ toolName: 'resolve_date', state: 'complete', output }, 'en').line).toBe('Local · resolve_date ✓ Saturday 2026-10-10');
  });

  it('hands the page the appointment a booking made, and nothing else', () => {
    const appointment = { reference: 'MA-7Q2K', status: 'requested', boutique: { slug: 'ginza', name: 'Ginza' }, requestedFor: '2026-10-03T14:00:00+09:00', products: [], note: '', confirmationSent: false };
    const output = { content: [{ type: 'text', text: '{}' }], structuredContent: { appointment } };
    const view = toolView({ toolName: 'request_appointment', state: 'complete', output }, 'en');
    expect(view.appointment).toEqual(appointment);
    expect(view.line).toBe('MCP · request_appointment ✓');
    expect(view.requestLine).toBeNull(); // its own line says it: only the picker's call needs one more
    expect(view.products).toBeNull();
    expect(view.handOff).toBeNull();
  });

  it('hands the page the products a search found, and counts them in the reply language', () => {
    const products = [{ slug: 'weekender-50', name: 'Weekender 50' }, { slug: 'voyage-trunk', name: 'Voyage Trunk' }];
    const found = (list: unknown[]) => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { products: list } });
    const view = toolView({ toolName: 'search_products', state: 'complete', output: found(products) }, 'en');
    expect(view.products).toEqual(products);
    expect(view.line).toBe('MCP · search_products ✓ 2 results');
    expect(view.appointment).toBeNull();
    expect(toolView({ toolName: 'search_products', state: 'complete', output: found(products.slice(0, 1)) }, 'en').line).toBe('MCP · search_products ✓ 1 result');
    expect(toolView({ toolName: 'search_products', state: 'complete', output: found(products) }, 'ja').line).toBe('MCP · search_products ✓ 2件');
  });

  it('shows a failed call as ✕ and its code, and hands the page nothing', () => {
    const refusal = { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'boutique_closed', message: 'The boutique is closed.', hint: 'Pick an hour it is open.' } }) }] };
    const closed = toolView({ toolName: 'request_appointment', state: 'complete', output: refusal }, 'en');
    expect(closed.line).toBe('MCP · request_appointment ✕ boutique_closed');
    expect(closed.failed).toBe(true);
    expect(closed.appointment).toBeNull();
    // A call that broke on the way has no code of its own, and a local tool's line says so the same way.
    const broken = toolView({ toolName: 'search_products', state: 'error', errorText: 'fetch failed' }, 'en');
    expect(broken.line).toBe('MCP · search_products ✕ error');
    expect(broken.failed).toBe(true);
    expect(broken.products).toBeNull();
    expect(toolView({ toolName: 'resolve_date', state: 'error', errorText: 'x' }, 'en').line).toBe('Local · resolve_date ✕ error');
  });

  it('shows a call that has not finished as …, on its own kind of line', () => {
    for (const state of ['awaiting-input', 'input-streaming', 'input-complete']) {
      const view = toolView({ toolName: 'search_products', state }, 'en');
      expect(view.line, state).toBe('MCP · search_products …');
      expect(view.failed, state).toBe(false);
      expect(view.products, state).toBeNull();
    }
    expect(toolView({ toolName: 'resolve_date', state: 'input-complete' }, 'en').line).toBe('Local · resolve_date …');
  });
});

// hand_off_to_staff is a Maison tool: Strapi records the question and answers its reference.
describe('toolView: hand_off_to_staff', () => {
  const call = { toolName: 'hand_off_to_staff', input: asked };

  it('shows it as a Maison tool, and hands the page the reference Strapi gave and the question the model sent', () => {
    const view = toolView({ ...call, state: 'complete', output: recorded('Q-4821') }, 'en');
    expect(view.line).toBe('MCP · hand_off_to_staff ✓');
    expect(view.failed).toBe(false);
    expect(view.handOff).toEqual({ reference: 'Q-4821', question: 'Can it hold a watch?' });
    expect(view.products).toBeNull();
    expect(view.appointment).toBeNull();
    // The same in Japanese: the line has no words in it.
    expect(toolView({ ...call, state: 'complete', output: recorded('Q-4821') }, 'ja').line).toBe('MCP · hand_off_to_staff ✓');
  });

  it("reads the reference from the result's structuredContent, and the question from the call's input, nowhere else", () => {
    const view = toolView({ toolName: 'hand_off_to_staff', state: 'complete', input: { question: 'Is it waterproof?' }, output: recorded('Q-0007') }, 'en');
    expect(view.handOff).toEqual({ reference: 'Q-0007', question: 'Is it waterproof?' });
    // A reference that is only in the result's text is not read.
    const textOnly = { content: [{ type: 'text', text: JSON.stringify({ question: { reference: 'Q-4821' } }) }] };
    expect(toolView({ ...call, state: 'complete', output: textOnly }, 'en').handOff).toBeNull();
  });

  it('trims the question, which is typed into the LINE chat: the spaces and line breaks around it are not the customer’s', () => {
    const handOffOf = (question: unknown) => toolView({ toolName: 'hand_off_to_staff', state: 'complete', input: { question }, output: recorded('Q-4821') }, 'en').handOff;
    expect(handOffOf('  Can it hold a watch?  \n')).toEqual({ reference: 'Q-4821', question: 'Can it hold a watch?' });
    expect(handOffOf('Can it hold\na watch?')?.question).toBe('Can it hold\na watch?'); // inside it, as it is
    expect(handOffOf(' \n ')).toEqual({ reference: 'Q-4821', question: '' });
  });

  it('is still a recorded hand-off when the call has no readable question: the reference is what says Strapi has it', () => {
    for (const input of [undefined, null, {}, { question: 42 }]) {
      expect(toolView({ toolName: 'hand_off_to_staff', state: 'complete', input, output: recorded('Q-4821') }, 'en').handOff, JSON.stringify(input)).toEqual({ reference: 'Q-4821', question: '' });
    }
  });

  it('hands the page nothing while it runs, and shows a line with …', () => {
    for (const state of ['input-streaming', 'input-complete']) {
      const view = toolView({ ...call, state }, 'en');
      expect(view.line, state).toBe('MCP · hand_off_to_staff …');
      expect(view.handOff, state).toBeNull();
      expect(view.failed, state).toBe(false);
    }
  });

  it("shows a call that broke on the way as a red ✕ error, and hands the page nothing: the question isn't recorded", () => {
    const view = toolView({ ...call, state: 'error', errorText: 'fetch failed' }, 'en');
    expect(view.line).toBe('MCP · hand_off_to_staff ✕ error');
    expect(view.failed).toBe(true);
    expect(view.handOff).toBeNull();
  });

  it("shows one Maison refused as a red ✕ with the error's code, and hands the page nothing", () => {
    const refusal = {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: { code: 'too_many_open_questions', message: 'You have 5 questions with the advisors.', hint: 'Tell the customer their earlier questions are with the advisors.' } }) }],
    };
    const view = toolView({ ...call, state: 'complete', output: refusal }, 'en');
    expect(view.line).toBe('MCP · hand_off_to_staff ✕ too_many_open_questions');
    expect(view.failed).toBe(true);
    expect(view.handOff).toBeNull();
    // Input Strapi's schema refused comes back as plain text.
    const invalid = { isError: true, content: [{ type: 'text', text: 'Input validation error: question: Too small' }] };
    const refused = toolView({ ...call, state: 'complete', output: invalid }, 'en');
    expect(refused.line).toBe('MCP · hand_off_to_staff ✕ invalid_input');
    expect(refused.failed).toBe(true);
    expect(refused.handOff).toBeNull();
  });

  it('hands the page nothing when the result has no reference to show: nothing says the question is recorded', () => {
    const results = [
      null,
      {},
      { content: [] },
      { content: [], structuredContent: {} },
      { content: [], structuredContent: { question: null } },
      { content: [], structuredContent: { question: {} } },
      { content: [], structuredContent: { question: { reference: '' } } },
      { content: [], structuredContent: { question: { reference: 4821 } } },
      { content: [], structuredContent: { question: 'Q-4821' } },
    ];
    for (const output of results) {
      const view = toolView({ ...call, state: 'complete', output }, 'en');
      expect(view.handOff, JSON.stringify(output)).toBeNull();
      expect(view.line, JSON.stringify(output)).toBe('MCP · hand_off_to_staff ✓'); // it didn't fail: it just can't be shown as recorded
    }
  });

  it("reads a hand-off from a hand_off_to_staff result's question only (a search carries its own, in handOff), and resolve_date is the only local tool", () => {
    // Nothing but hand_off_to_staff, even with a result shaped like its own.
    expect(toolView({ toolName: 'search_knowledge', state: 'complete', input: asked, output: recorded() }, 'en').handOff).toBeNull();
    expect(toolView({ toolName: 'request_appointment', state: 'complete', input: asked, output: recorded() }, 'en').handOff).toBeNull();
    expect(toolView({ toolName: 'resolve_date', state: 'complete', input: asked, output: recorded() }, 'en').line).toMatch(/^Local · resolve_date ✓/);
    expect(toolView({ toolName: 'hand_off_to_staff', state: 'complete', output: recorded() }, 'en').line).toMatch(/^MCP · /);
  });
});

// A search that found nothing may carry the hand-off the app made for it: the question is with the advisors, as if the
// model had called hand_off_to_staff, and the page treats it the same way.
describe('toolView: search_knowledge that handed the question to staff', () => {
  const call = { toolName: 'search_knowledge', input: { query: 'watch' } };

  it('keeps its line, with the count of what it found, and hands the page the reference Strapi gave and the question the app sent', () => {
    const view = toolView({ ...call, state: 'complete', output: searchedAndHandedOff('Q-4821', 'Can it hold a watch?') }, 'en');
    expect(view.line).toBe('MCP · search_knowledge ✓ 0 results');
    expect(view.failed).toBe(false);
    expect(view.handOff).toEqual({ reference: 'Q-4821', question: 'Can it hold a watch?' });
    expect(view.products).toBeNull();
    expect(view.appointment).toBeNull();
    // The same in Japanese: only the count's words change.
    const ja = toolView({ ...call, state: 'complete', output: searchedAndHandedOff('Q-4821', 'これは腕時計を入れられますか？') }, 'ja');
    expect(ja.line).toBe('MCP · search_knowledge ✓ 0件');
    expect(ja.handOff).toEqual({ reference: 'Q-4821', question: 'これは腕時計を入れられますか？' });
  });

  it('leaves the piece out of what it hands the page: the reference and the question only', () => {
    const view = toolView({ ...call, state: 'complete', output: searchedAndHandedOff('Q-4821', 'Can it hold a watch?', { slug: 'jewelry-coffret', name: 'Jewelry Coffret' }) }, 'en');
    expect(view.handOff).toStrictEqual({ reference: 'Q-4821', question: 'Can it hold a watch?' });
  });

  it("reads the question from the result's handOff, not from what the model sent the search, and trims it like a hand-off's", () => {
    const handOffOf = (question: unknown) => {
      const output = searchedAndHandedOff();
      return toolView({ ...call, state: 'complete', output: { ...output, structuredContent: { ...output.structuredContent, handOff: { reference: 'Q-4821', question } } } }, 'en').handOff;
    };
    expect(handOffOf('  Can it hold a watch?\n')).toEqual({ reference: 'Q-4821', question: 'Can it hold a watch?' });
    expect(handOffOf('Can it hold\na watch?')?.question).toBe('Can it hold\na watch?');
    // Still recorded when the question can't be read: the reference is what says Strapi has it.
    for (const question of [undefined, null, 42, {}]) expect(handOffOf(question), JSON.stringify(question)).toEqual({ reference: 'Q-4821', question: '' });
    expect(toolView({ ...call, input: { query: 'something else' }, state: 'complete', output: searchedAndHandedOff('Q-4821', 'Can it hold a watch?') }, 'en').handOff?.question).toBe('Can it hold a watch?');
  });

  it("hands the page nothing when the result's handOff has no reference to show", () => {
    const withHandOff = (handOff: unknown) => ({ content: [], structuredContent: { locale: 'en', entries: [], handOff } });
    const results = [
      searchedAndHandedOff('', 'Can it hold a watch?'),
      withHandOff({ question: 'Can it hold a watch?' }),
      withHandOff({ reference: 4821, question: 'Can it hold a watch?' }),
      withHandOff({ reference: null }),
      withHandOff({}),
      withHandOff(null),
      withHandOff('Q-4821'),
      withHandOff(['Q-4821']),
      withHandOff(4821),
      { content: [], structuredContent: { locale: 'en', entries: [] } }, // a search that found nothing, and no hand-off
      null,
    ];
    for (const output of results) {
      const view = toolView({ ...call, state: 'complete', output }, 'en');
      expect(view.handOff, JSON.stringify(output)).toBeNull();
      expect(view.failed, JSON.stringify(output)).toBe(false);
    }
  });

  it("hands the page nothing while the search runs, when it broke on the way, or when Maison refused it, whatever its result says", () => {
    for (const state of ['input-streaming', 'input-complete']) {
      expect(toolView({ ...call, state, output: searchedAndHandedOff() }, 'en').handOff, state).toBeNull();
    }
    expect(toolView({ ...call, state: 'error', errorText: 'fetch failed', output: searchedAndHandedOff() }, 'en').handOff).toBeNull();
    const refused = { ...searchedAndHandedOff(), isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'invalid_input', message: 'Check the query.', hint: 'Use 1 to 300 characters.' } }) }] };
    const view = toolView({ ...call, state: 'complete', output: refused }, 'en');
    expect(view.handOff).toBeNull();
    expect(view.failed).toBe(true);
    expect(view.line).toBe('MCP · search_knowledge ✕ invalid_input');
  });

  it('reads a hand-off from a search only: another tool with the same field has none', () => {
    const output = searchedAndHandedOff();
    for (const toolName of ['search_products', 'request_appointment', 'view_product', 'my_appointments']) {
      expect(toolView({ toolName, state: 'complete', output }, 'en').handOff, toolName).toBeNull();
    }
    // hand_off_to_staff has its own result, read as before: question.reference, whatever else the result holds.
    expect(toolView({ toolName: 'hand_off_to_staff', state: 'complete', input: asked, output }, 'en').handOff).toBeNull();
    const both = { content: [], structuredContent: { ...recorded('Q-0007').structuredContent, handOff: { reference: 'Q-9999', question: 'No.' } } };
    expect(toolView({ toolName: 'hand_off_to_staff', state: 'complete', input: asked, output: both }, 'en').handOff).toEqual({ reference: 'Q-0007', question: 'Can it hold a watch?' });
    // And a search reads its handOff, not a question of the kind a hand-off has.
    const mixed = { content: [], structuredContent: { entries: [], ...recorded('Q-0007').structuredContent } };
    expect(toolView({ ...call, state: 'complete', output: mixed }, 'en').handOff).toBeNull();
  });
});

// The visit picker's call (lib/visit-picker.ts): the concierge's own tool, answered by the customer in the chat. Its
// request_appointment call is made in the browser, outside the conversation, so its line comes from the picker's answer.
describe('toolView: choose_visit', () => {
  const appointment = { reference: 'APT-0042', status: 'requested', boutique: { slug: 'ginza', name: 'Ginza Flagship' }, requestedFor: '2026-10-10T14:00:00+09:00', products: [], note: '', confirmationSent: false };
  const call = { toolName: 'choose_visit', toolCallId: 'call-1', input: { productSlugs: ['weekender-50'], boutique: 'ginza', date: '2026-10-10', time: '14:00' } };

  // A waiting picker isn't a running call: "…" read as loading, and stayed above "No request sent." once the customer moved on.
  it('shows a picker waiting for the customer as its local line with no mark, a call still coming in with …, and hands the page nothing', () => {
    for (const [state, line] of [
      ['input-complete', 'Local · choose_visit'],
      ['input-streaming', 'Local · choose_visit …'],
      ['awaiting-input', 'Local · choose_visit …'],
    ]) {
      const view = toolView({ ...call, state }, 'en');
      expect(view.line, state).toBe(line);
      expect(view.failed, state).toBe(false);
      expect(view.appointment, state).toBeNull();
      expect(view.requestLine, state).toBeNull();
    }
    expect(toolView({ ...call, state: 'input-complete' }, 'ja').line).toBe('Local · choose_visit');
  });

  it('keeps … for any other call that waits for its result', () => {
    expect(toolView({ toolName: 'resolve_date', state: 'input-complete' }, 'en').line).toBe('Local · resolve_date …');
    expect(toolView({ toolName: 'find_boutiques', state: 'input-complete' }, 'en').line).toBe('MCP · find_boutiques …');
  });

  it("shows a requested visit as ✓ requested, with the line of the request_appointment call the picker made, and hands the page the visit's card", () => {
    const view = toolView({ ...call, state: 'complete', output: { status: 'requested', appointment } }, 'en');
    expect(view.line).toBe('Local · choose_visit ✓ requested');
    expect(view.requestLine).toBe('MCP · request_appointment ✓');
    expect(view.appointment).toEqual(appointment);
    expect(view.failed).toBe(false);
    // The same in Japanese: the lines have no words of the copy in them.
    expect(toolView({ ...call, state: 'complete', output: { status: 'requested', appointment } }, 'ja').line).toBe('Local · choose_visit ✓ requested');
  });

  it('shows a closed picker as ✓ closed, with no request line and no card', () => {
    const view = toolView({ ...call, state: 'complete', output: { status: 'closed' } }, 'en');
    expect(view.line).toBe('Local · choose_visit ✓ closed');
    expect(view.requestLine).toBeNull();
    expect(view.appointment).toBeNull();
  });

  it("hands the page no card for an answer it can't read, and shows a refused call as a red ✕", () => {
    for (const output of [{ status: 'requested' }, { status: 'requested', appointment: {} }, null, 'requested']) {
      const view = toolView({ ...call, state: 'complete', output }, 'en');
      expect(view.appointment, JSON.stringify(output)).toBeNull();
      expect(view.requestLine, JSON.stringify(output)).toBeNull();
      expect(view.line, JSON.stringify(output)).toBe('Local · choose_visit ✓');
    }
    // The server's check of the pieces refused it with Strapi's own error (not_found): the model reads it and calls again.
    const notFound = { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'not_found', message: 'No such product.', hint: 'Call search_products.' } }) }] };
    const unknown = toolView({ ...call, state: 'complete', output: notFound }, 'en');
    expect(unknown.line).toBe('Local · choose_visit ✕ not_found');
    expect(unknown.failed).toBe(true);
    expect(unknown.appointment).toBeNull();
    // Input the schema refused: the call ends in an error, and the model calls again.
    const refused = toolView({ toolName: 'choose_visit', state: 'error', errorText: 'Invalid input' }, 'en');
    expect(refused.line).toBe('Local · choose_visit ✕ error');
    expect(refused.failed).toBe(true);
  });

  it('keeps the call id the picker answers by', () => {
    expect(toolPartOf({ type: 'tool-call', id: 'call-1', name: 'choose_visit', state: 'input-complete' } as { type: string })).toMatchObject({ toolName: 'choose_visit', toolCallId: 'call-1' });
  });
});

describe('toolPartOf', () => {
  it("reads a tool-call part: its tool's name, call id, state, what the call was sent, and its output", () => {
    const part = { type: 'tool-call', id: 'call-1', name: 'hand_off_to_staff', arguments: JSON.stringify(asked), input: asked, state: 'complete', output: recorded('Q-4821') };
    expect(toolPartOf(part)).toEqual({ toolName: 'hand_off_to_staff', toolCallId: 'call-1', state: 'complete', input: asked, output: recorded('Q-4821') });
  });

  it("reads a local tool's name from the part too, and skips text, thinking and tool-result parts", () => {
    expect(toolPartOf({ type: 'tool-call', id: 'call-2', name: 'resolve_date', state: 'input-complete' } as { type: string })?.toolName).toBe('resolve_date');
    expect(toolPartOf({ type: 'text' })).toBeNull();
    expect(toolPartOf({ type: 'thinking' })).toBeNull();
    // TanStack AI keeps a tool-result part beside the call: it is not a second call.
    expect(toolPartOf({ type: 'tool-result' })).toBeNull();
    // The old AI SDK shapes are not read.
    expect(toolPartOf({ type: 'tool-resolve_date' })).toBeNull();
    expect(toolPartOf({ type: 'dynamic-tool' })).toBeNull();
  });

  it("gives a call that ended in an error its text, from the output `{ error }`", () => {
    const failed = toolPartOf({ type: 'tool-call', id: 'call-3', name: 'search_products', state: 'error', output: { error: 'fetch failed' } } as { type: string });
    expect(failed).toMatchObject({ toolName: 'search_products', state: 'error', errorText: 'fetch failed' });
    // Any other call has none, whatever it holds.
    expect(toolPartOf({ type: 'tool-call', id: 'call-4', name: 'search_products', state: 'complete', output: { error: 'x' } } as { type: string })?.errorText).toBeUndefined();
  });

  it("reads a call that has no name or id as it is: the name is empty and the id is missing, and nothing throws", () => {
    expect(toolPartOf({ type: 'tool-call' })).toMatchObject({ toolName: '' });
    expect(toolPartOf({ type: 'tool-call' })?.toolCallId).toBeUndefined();
  });
});

// Where the hand-off note goes in a message, and which note (`kind`): the index of the part it goes under, with what
// Strapi recorded, or null for no note. A hand-off that went through gets the recorded note: the model's call, or the
// one the app made itself for a search that found nothing (its result's `handOff`). When nothing was recorded the plain
// one shows, so a customer can always reach a person: under a search that found nothing (the app's own hand-off failed,
// or Strapi has no such tool for this token), or under a hand-off that failed.
describe('handOffAt', () => {
  type Part = { type: string; [key: string]: unknown };
  /** A hand_off_to_staff call as the page holds it: a tool-call part, whose output is the MCP result (or `{ error }` for a call that broke on the way). */
  const handOff = (state: string, output?: unknown, question = 'Can it hold a watch?'): Part => ({
    type: 'tool-call',
    id: 'call-hand-off',
    name: 'hand_off_to_staff',
    state,
    input: { question, reason: 'no_answer' },
    ...(output === undefined ? {} : { output }),
  });
  const handedOff = handOff('complete', recorded('Q-4821'));
  /** The note under a hand-off Strapi recorded, as handOffAt answers it. */
  const recordedAt = (index: number, reference = 'Q-4821', question = 'Can it hold a watch?') => ({ index, kind: 'recorded', recorded: { reference, question } });
  /** The plain note under a search that found nothing, when the model made no hand-off: nothing is recorded. */
  const emptySearchAt = (index: number) => ({ index, kind: 'empty_search', recorded: null });
  /** The same plain note under a hand-off that failed, so a customer can always reach a person: nothing is recorded. */
  const failedHandOffAt = (index: number) => ({ index, kind: 'failed_hand_off', recorded: null });
  /** A search_knowledge call, an MCP tool: a tool-call part, whose output is the MCP result. */
  const search = (state: string, output?: unknown): Part => ({ type: 'tool-call', id: 'call-search', name: 'search_knowledge', state, ...(output === undefined ? {} : { output }) });
  const found = (...titles: string[]) => search('complete', { content: [{ type: 'text', text: '{}' }], structuredContent: { locale: 'en', entries: titles.map((title) => ({ title })) } });
  const foundNothing = found();
  const foundAnAnswer = found('How do I care for the leather?');
  /** A search that found nothing, and the app handed the question to staff itself: it carries what Strapi recorded. */
  const handedOffBySearch = (reference = 'Q-4821', question = 'Can it hold a watch?') => search('complete', searchedAndHandedOff(reference, question));
  /** A result Maison refused (isError), as the server's MCP wrapper passes it on. */
  const refusal = { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'invalid_input', message: 'Check the query.', hint: 'Use 1 to 300 characters.' } }) }] };
  const words: Part = { type: 'text', content: 'I could not find a reliable answer, so I have passed your question to the advisors.' };
  /** Any other part, which counts toward the index and is no call: TanStack AI's thinking part, a tool-result part, or text. */
  const aside: Part = { type: 'thinking', content: 'The customer asks about a watch.' };

  it('puts the note under a hand-off that went through, and under the first of several', () => {
    expect(handOffAt([foundNothing, handedOff])).toEqual(recordedAt(1));
    expect(handOffAt([aside, handedOff, words])).toEqual(recordedAt(1));
    const another = handOff('complete', recorded('Q-4822'), 'And a ring?');
    expect(handOffAt([handedOff, foundNothing, another])).toEqual(recordedAt(0));
    expect(handOffAt([another, handedOff])).toEqual(recordedAt(0, 'Q-4822', 'And a ring?'));
    expect(handOffAt([handOff('error'), handedOff])).toEqual(recordedAt(1)); // a first one that failed doesn't count
    expect(handOffAt([handOff('complete', refusal), handedOff])).toEqual(recordedAt(1)); // nor one that was refused
  });

  it('answers what Strapi recorded: the reference it gave and the question the model sent', () => {
    expect(handOffAt([handOff('complete', recorded('Q-0007'), 'Is it waterproof?')])).toEqual({ index: 0, kind: 'recorded', recorded: { reference: 'Q-0007', question: 'Is it waterproof?' } });
    // The question is trimmed, as toolView's is: it is typed into the LINE chat.
    expect(handOffAt([handOff('complete', recorded('Q-0007'), '  Is it waterproof?\n')])).toEqual(recordedAt(0, 'Q-0007', 'Is it waterproof?'));
  });

  it('puts it under a hand-off whatever the searches found: the model made the call', () => {
    expect(handOffAt([foundAnAnswer, handedOff])).toEqual(recordedAt(1));
    expect(handOffAt([search('input-complete'), handedOff])).toEqual(recordedAt(1));
    expect(handOffAt([search('error'), handedOff])).toEqual(recordedAt(1));
  });

  it('puts the plain note under a hand-off that failed or was refused, so a customer can always reach a person', () => {
    expect(handOffAt([handOff('error')])).toEqual(failedHandOffAt(0));
    expect(handOffAt([handOff('complete', refusal)])).toEqual(failedHandOffAt(0));
    expect(handOffAt([aside, handOff('error'), words])).toEqual(failedHandOffAt(1)); // under it, above the model's words
    // Whatever the searches found, or none at all: a customer who asks for a person gets a hand-off with no search.
    expect(handOffAt([foundAnAnswer, handOff('error')])).toEqual(failedHandOffAt(1));
    expect(handOffAt([foundAnAnswer, handOff('complete', refusal)])).toEqual(failedHandOffAt(1));
    expect(handOffAt([search('error'), handOff('error')])).toEqual(failedHandOffAt(1));
    // A last search that failed or was refused has no note of its own, so the failed hand-off gets one.
    expect(handOffAt([foundNothing, search('error'), handOff('error')])).toEqual(failedHandOffAt(2));
    expect(handOffAt([foundNothing, search('complete', refusal), handOff('complete', refusal)])).toEqual(failedHandOffAt(2));
    // Several that failed: under the last, as the last search decides.
    expect(handOffAt([handOff('error'), aside, handOff('complete', refusal)])).toEqual(failedHandOffAt(2));
    // One that went through wins over one that failed, whichever came first.
    expect(handOffAt([handOff('error'), handedOff])).toEqual(recordedAt(1));
    expect(handOffAt([handedOff, handOff('error')])).toEqual(recordedAt(0));
  });

  it("puts an empty search's note first, so a failed hand-off after one is placed where it always was", () => {
    expect(handOffAt([foundNothing, handOff('error')])).toEqual(emptySearchAt(0));
    expect(handOffAt([foundNothing, handOff('complete', refusal)])).toEqual(emptySearchAt(0));
    expect(handOffAt([handOff('error'), foundNothing])).toEqual(emptySearchAt(1));
    expect(handOffAt([foundNothing, aside, handOff('error'), aside, foundNothing])).toEqual(emptySearchAt(4));
  });

  // The plain note would show under the search or the failure, and then be replaced by the recorded one under the call.
  it('places no fallback while a hand-off is still running, so the plain note never flashes before the recorded one', () => {
    for (const state of ['input-streaming', 'input-complete']) {
      expect(handOffAt([handOff(state)]), state).toBeNull();
      expect(handOffAt([foundNothing, handOff(state)]), state).toBeNull(); // the empty search's note waits too
      expect(handOffAt([foundAnAnswer, handOff(state)]), state).toBeNull();
      expect(handOffAt([handOff('error'), aside, handOff(state)]), state).toBeNull(); // a second try is under way
      expect(handOffAt([foundNothing, handOff('error'), aside, handOff(state)]), state).toBeNull();
      expect(handOffAt([handOff(state), foundNothing]), state).toBeNull(); // whichever came first
    }
    // Once it finishes, the note is there at once: recorded under the call, or the plain one if it failed.
    expect(handOffAt([foundNothing, handOff('input-complete')])).toBeNull();
    expect(handOffAt([foundNothing, handedOff])).toEqual(recordedAt(1));
    expect(handOffAt([handOff('input-complete')])).toBeNull();
    expect(handOffAt([handOff('error')])).toEqual(failedHandOffAt(0));
    // A hand-off that went through keeps its note while a second one runs.
    expect(handOffAt([handedOff, handOff('input-complete')])).toEqual(recordedAt(0));
  });

  it('treats a hand-off whose result has no reference as one that recorded nothing: the plain note, never the advisors', () => {
    for (const output of [{ content: [] }, { content: [], structuredContent: { question: { reference: '' } } }, null]) {
      expect(handOffAt([handOff('complete', output)]), JSON.stringify(output)).toEqual(failedHandOffAt(0));
      expect(handOffAt([foundAnAnswer, handOff('complete', output)]), JSON.stringify(output)).toEqual(failedHandOffAt(1));
      expect(handOffAt([foundNothing, handOff('complete', output)]), JSON.stringify(output)).toEqual(emptySearchAt(0));
    }
  });

  it('falls back to the last search that found nothing, when the model made no hand-off: the plain note, with nothing recorded', () => {
    expect(handOffAt([foundNothing])).toEqual(emptySearchAt(0));
    expect(handOffAt([aside, foundNothing, aside, words])).toEqual(emptySearchAt(1)); // under the search, above the model's words
    expect(handOffAt([foundNothing, aside, foundNothing])).toEqual(emptySearchAt(2)); // two searches, both empty: under the last
    expect(handOffAt([foundNothing, handOff('error')])).toEqual(emptySearchAt(0)); // a hand-off that failed doesn't take the note away
    expect(handOffAt([foundNothing, handOff('complete', refusal)])).toEqual(emptySearchAt(0));
  });

  it('shows no fallback note when any search found entries', () => {
    expect(handOffAt([foundAnAnswer])).toBeNull();
    expect(handOffAt([foundNothing, foundAnAnswer])).toBeNull();
    expect(handOffAt([foundAnAnswer, foundNothing])).toBeNull();
    expect(handOffAt([foundAnAnswer, words])).toBeNull();
  });

  it('shows no fallback note while a search is running, or when the last one failed or was refused', () => {
    expect(handOffAt([search('input-streaming')])).toBeNull();
    expect(handOffAt([search('input-complete')])).toBeNull();
    // Held back while a second search is under way, so the note doesn't show and then vanish when that one finds an answer.
    expect(handOffAt([foundNothing, search('input-complete')])).toBeNull();
    expect(handOffAt([search('input-complete'), foundNothing])).toBeNull();
    expect(handOffAt([search('error')])).toBeNull();
    expect(handOffAt([search('complete', refusal)])).toBeNull();
    // The last search decides, and it failed: the question wasn't answered, and nothing says the knowledge is empty.
    expect(handOffAt([foundNothing, search('error')])).toBeNull();
    expect(handOffAt([foundNothing, search('complete', refusal)])).toBeNull();
  });

  // Rule 6 has the model fix a refused call and call again, and the local model makes bad first calls.
  it('lets the last search decide: an earlier one that failed, was refused or could not be read does not cancel the note', () => {
    expect(handOffAt([search('complete', refusal), foundNothing])).toEqual(emptySearchAt(1));
    expect(handOffAt([search('error'), foundNothing])).toEqual(emptySearchAt(1));
    expect(handOffAt([search('complete', refusal), aside, search('error'), aside, foundNothing])).toEqual(emptySearchAt(4)); // two bad ones, then an empty one
    expect(handOffAt([search('complete', { content: [] }), foundNothing])).toEqual(emptySearchAt(1)); // a result with nothing to read
    // A guessed slug is not_found; the model looks it up with search_products, then searches again.
    const notFound = search('complete', { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'not_found', message: 'No such product.', hint: 'Call search_products to find valid product slugs.' } }) }] });
    const products: Part = { type: 'tool-call', id: 'call-products', name: 'search_products', state: 'complete', output: { content: [], structuredContent: { products: [{ slug: 'weekender-50' }] } } };
    expect(handOffAt([notFound, products, foundNothing])).toEqual(emptySearchAt(2));
    // The last one still has to be the empty one, and no search may have found entries or be running.
    expect(handOffAt([search('complete', refusal), foundAnAnswer, foundNothing])).toBeNull();
    expect(handOffAt([search('error'), foundAnAnswer])).toBeNull();
    expect(handOffAt([search('complete', refusal), search('input-complete')])).toBeNull(); // the retry is still running
  });

  it("shows no fallback note when it can't tell that the search found nothing, or nothing was searched", () => {
    expect(handOffAt([search('complete', { content: [] })])).toBeNull(); // no structuredContent
    expect(handOffAt([search('complete', { content: [], structuredContent: { locale: 'en' } })])).toBeNull(); // no entries list
    expect(handOffAt([search('complete', null)])).toBeNull();
    expect(handOffAt([])).toBeNull();
    expect(handOffAt([words, aside])).toBeNull();
    // Another tool's empty list isn't knowledge.
    const products: Part = { type: 'tool-call', id: 'call-products', name: 'search_products', state: 'complete', output: { content: [], structuredContent: { products: [] } } };
    expect(handOffAt([products])).toBeNull();
    expect(handOffAt([{ type: 'tool-call' }])).toBeNull(); // a call with no name
  });

  it('reads tool-call parts only, and counts every part toward the index', () => {
    // A tool-result part beside a call holds the same result, and is not a call.
    const result: Part = { type: 'tool-result', toolCallId: 'call-search', content: '{}', state: 'complete' };
    expect(handOffAt([aside, words, foundNothing, result])).toEqual(emptySearchAt(2));
    expect(handOffAt([aside, words, { ...foundNothing, output: { content: [], structuredContent: { entries: [{ title: 'A' }] } } }])).toBeNull();
    expect(handOffAt([aside, foundNothing, words, handedOff, result])).toEqual(recordedAt(3));
    // A part that is not a tool-call, whatever its fields say, is no call.
    const oldShapes: Part[] = [
      { type: 'tool-search_knowledge', state: 'complete', output: { content: [], structuredContent: { entries: [] } } },
      { type: 'dynamic-tool', toolName: 'search_knowledge', state: 'complete', output: { content: [], structuredContent: { entries: [] } } },
    ];
    for (const old of oldShapes) expect(handOffAt([old]), old.type).toBeNull();
  });

  // The app records the question itself when a search finds nothing: the note is under that search, with what the result says.
  describe('a search that the app handed the question to staff for', () => {
    it('puts the recorded note under the search, with the reference and the question its result carries', () => {
      expect(handOffAt([handedOffBySearch()])).toEqual(recordedAt(0));
      expect(handOffAt([handedOffBySearch('Q-0007', 'Is it waterproof?')])).toEqual(recordedAt(0, 'Q-0007', 'Is it waterproof?'));
      expect(handOffAt([aside, handedOffBySearch(), words])).toEqual(recordedAt(1)); // under the search, above the model's words
      // The question is trimmed, as a hand-off's is: it is typed into the LINE chat.
      expect(handOffAt([handedOffBySearch('Q-0007', '  Is it waterproof?\n')])).toEqual(recordedAt(0, 'Q-0007', 'Is it waterproof?'));
    });

    it("is a recorded note, not the empty search's plain one: the plain note is only for a search nothing was recorded for", () => {
      const place = handOffAt([handedOffBySearch()]);
      expect(place?.kind).toBe('recorded');
      expect(place?.recorded).not.toBeNull();
      expect(handOffAt([foundNothing])?.kind).toBe('empty_search'); // the same search without the hand-off
    });

    it('counts every part toward the index', () => {
      expect(handOffAt([aside, words, handedOffBySearch()])).toEqual(recordedAt(2));
    });

    it('wins over the empty-search fallback, whichever search came first: one note, under the first hand-off that went through', () => {
      expect(handOffAt([handedOffBySearch(), foundNothing])).toEqual(recordedAt(0));
      expect(handOffAt([foundNothing, handedOffBySearch()])).toEqual(recordedAt(1));
      expect(handOffAt([foundNothing, aside, handedOffBySearch('Q-0002'), aside, foundNothing])).toEqual(recordedAt(2, 'Q-0002'));
      // The first one of several, like a hand-off the model made.
      expect(handOffAt([handedOffBySearch('Q-0001'), aside, handedOffBySearch('Q-0002')])).toEqual(recordedAt(0, 'Q-0001'));
    });

    it("goes with the first hand-off that went through, the search's or the model's, whatever the searches found", () => {
      expect(handOffAt([handedOffBySearch('Q-0001'), handOff('complete', recorded('Q-0002'))])).toEqual(recordedAt(0, 'Q-0001'));
      expect(handOffAt([handOff('complete', recorded('Q-0002')), handedOffBySearch('Q-0001')])).toEqual(recordedAt(0, 'Q-0002'));
      expect(handOffAt([handedOffBySearch(), foundAnAnswer])).toEqual(recordedAt(0)); // a later search found entries: the question is recorded all the same
      expect(handOffAt([foundAnAnswer, handedOffBySearch()])).toEqual(recordedAt(1));
    });

    it("keeps the note when the model's own hand-off after it is running, failed or was refused, and when searches before it failed", () => {
      for (const state of ['input-streaming', 'input-complete']) expect(handOffAt([handedOffBySearch(), handOff(state)]), state).toEqual(recordedAt(0)); // no flicker, no second note
      expect(handOffAt([handedOffBySearch(), handOff('error')])).toEqual(recordedAt(0));
      expect(handOffAt([handedOffBySearch(), handOff('complete', refusal)])).toEqual(recordedAt(0));
      expect(handOffAt([search('error'), search('complete', refusal), handedOffBySearch()])).toEqual(recordedAt(2));
    });

    it('shows no note of this kind while the search runs, when it broke on the way or was refused, or when its hand-off has no reference', () => {
      expect(handOffAt([search('input-complete', searchedAndHandedOff())])).toBeNull();
      expect(handOffAt([search('error', searchedAndHandedOff())])).toBeNull();
      expect(handOffAt([search('complete', { ...searchedAndHandedOff(), isError: true })])).toBeNull();
      // Without a reference nothing says Strapi has the question, so it is the plain search: the fallback, as for any empty one.
      expect(handOffAt([handedOffBySearch('')])).toEqual(emptySearchAt(0));
      expect(handOffAt([search('complete', { content: [], structuredContent: { locale: 'en', entries: [], handOff: { reference: 4821 } } })])).toEqual(emptySearchAt(0));
    });

    it("takes nothing from a hand-off of the same kind on another tool's result", () => {
      const products: Part = { type: 'tool-call', id: 'call-products', name: 'search_products', state: 'complete', output: { content: [], structuredContent: { products: [], handOff: { reference: 'Q-4821', question: 'x' } } } };
      expect(handOffAt([products])).toBeNull();
      expect(handOffAt([products, foundNothing])).toEqual(emptySearchAt(1));
    });
  });
});
