/**
 * The concierge end to end: `handleConcierge` in process, a signed-in demo customer, and real MCP tool calls to the
 * running Strapi. Opt-in (`npm run test:live`). It skips, with one plain line saying why, when the app's client ID is
 * missing (`npm run setup` writes VITE_MAISON_CLIENT_ID to app/.env), or Strapi or the model does not answer. In LINE mode
 * it refuses to run (live/support.ts). Two modes:
 * - The local model, the default: Ollama, through `conciergeModel` without the Anthropic key even when one is set. It
 *   costs nothing and runs offline.
 * - Claude, opt-in: `LIVE_MODEL=claude npm run test:live` (or `npm run test:live:claude`) runs the same cases on Claude
 *   Sonnet 5.5 with ANTHROPIC_API_KEY from app/.env, plus the visit picker's Claude cases. It costs money. The key is
 *   never printed: the test only checks that one is set.
 *
 * The route's reply is TanStack AI's AG-UI events as server-sent events. `readTurn` (live/support.ts) feeds them to a
 * `StreamProcessor`, the same code `ChatClient` uses in the browser, so each check reads the messages the page would show.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { UIMessage } from '@tanstack/ai';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { resolveDate } from '../src/lib/concierge/resolve-date';
import { COPY } from '../src/lib/copy';
import { createSession } from '../src/lib/session';
import { CHOOSE_VISIT, livePickerOf } from '../src/lib/visit-picker';
import { assistantWith, chatBody, cleanup, converse as scriptedTurn, request, say, toolCall } from '../src/lib/concierge/handle-support';
import { answer } from '../src/lib/concierge/test-support';
import { handleConcierge } from '../src/lib/concierge/handle';
import { conciergeModel } from '../src/lib/concierge/model';
import { STRAPI_URL, datesIn, ensureVerifyMock, handOffOf, ollamaHost, ollamaUp, readTurn, saysConfirmed, saysRequested, sseEvents, strapiUp, weekdaysIn, type Turn } from './support';

/** Which model answers: Claude only when asked for by name, so a run costs nothing unless someone means it to. */
const claude = process.env.LIVE_MODEL === 'claude';
/** The environment `conciergeModel` reads: without the key unless Claude was asked for, so the default is Ollama. */
const modelEnv = claude ? process.env : { ...process.env, ANTHROPIC_API_KEY: undefined };

const clientId = process.env.VITE_MAISON_CLIENT_ID ?? '';

/** Why the live cases can't run, in a plain sentence, or null when they can. Checks in order, so a missing piece stops the rest. */
const whyNot = async (): Promise<string | null> => {
  if (!clientId) return 'VITE_MAISON_CLIENT_ID is not set in app/.env. Run `npm run setup` first.';
  if (!(await strapiUp())) return `Strapi does not answer at ${STRAPI_URL}. Start it with \`npm run dev:strapi\`.`;
  // Whether a key is set is checked, never read out.
  if (claude) return process.env.ANTHROPIC_API_KEY ? null : 'LIVE_MODEL=claude needs ANTHROPIC_API_KEY in app/.env.';
  if (!(await ollamaUp())) return `Ollama does not answer at ${ollamaHost()}. Start it, or run \`npm run test:live:claude\`.`;
  return null;
};
const skipReason = await whyNot();
if (skipReason) console.log(`The concierge live cases are skipped. ${skipReason}`);
const ready = skipReason === null;

/** A demo customer of its own, so the browser tests' customers never see these visits. */
const CUSTOMER = `U${'c'.repeat(32)}`;
const QUESTION = "I'm looking for a travel gift under ¥400,000 that I can see at the Ginza boutique. What would you suggest?";

type Product = { slug: string; name: string };

/** One request through `handleConcierge`, signed in with `token`, as the page sends it: the turn the stream holds, with no error among its events. */
const converse = async (token: string, messages: UIMessage[], { locale = 'en', product }: { locale?: string; product?: string } = {}): Promise<Turn> => {
  const response = await handleConcierge(request(`Bearer ${token}`, chatBody(messages, { locale, product })), { model: conciergeModel(modelEnv), strapiUrl: STRAPI_URL });
  expect(response.status).toBe(200);
  const events = sseEvents(await response.text());
  expect(
    events.filter((event) => event.type === 'RUN_ERROR').map((event) => event.message),
    'the run ended with an error'
  ).toEqual([]);
  return readTurn(events);
};

/**
 * The demo's first suggestion, as the stage sends it, ends in a visit picker: for the next Saturday in Tokyo (the date
 * resolve_date returned, which it asked first) at 14:00 in Ginza, for pieces a search in that turn returned. Nothing is
 * booked: the turn stops at the picker, which waits for the customer, and the reply says no visit is confirmed and names
 * no other day.
 */
const expectTheDemoPicker = async (token: string) => {
  const saturday = resolveDate({ weekday: 'saturday' }, 'en').date; // by the code the tool runs
  const [ask] = COPY.en.suggestions;
  const asked = [say(ask, 'u1')];
  const turn = await converse(token, asked);
  const { calls, trace } = turn;

  const resolved = calls.findIndex((call) => call.name === 'resolve_date');
  const shown = calls.findIndex((call) => call.name === CHOOSE_VISIT);
  expect(resolved, `it asks resolve_date. ${trace}`).toBeGreaterThanOrEqual(0);
  expect(shown, `it shows the picker. ${trace}`).toBeGreaterThanOrEqual(0);
  expect(resolved < shown, `it asks resolve_date before it shows the picker. ${trace}`).toBe(true);
  expect(
    calls.some((call) => call.name === 'resolve_date' && call.output?.date === saturday && call.output?.weekday === 'Saturday'),
    `resolve_date gave it ${saturday}, a Saturday. ${trace}`
  ).toBe(true);

  const picker = calls[shown];
  expect(picker.input, `the picker is for Ginza on ${saturday} at 14:00. ${trace}`).toMatchObject({ boutique: 'ginza', date: saturday, time: '14:00' });
  const found = new Set(
    calls
      .filter((call) => call.name === 'search_products')
      .flatMap((call) => (call.output?.structuredContent?.products as Product[] | undefined) ?? [])
      .map((product) => product.slug)
  );
  const pieces: string[] = picker.input.productSlugs ?? [];
  expect(pieces.length, `the picker has pieces. ${trace}`).toBeGreaterThan(0);
  for (const slug of pieces) expect(found.has(slug), `${slug} came from search_products in this turn. ${trace}`).toBe(true);

  // The customer books, in the picker: the model asks for no visit itself, and says none is confirmed.
  expect(
    calls.some((call) => call.name === 'request_appointment'),
    `the model called request_appointment. ${trace}`
  ).toBe(false);
  const reply = turn.words;
  expect(saysConfirmed(reply), `the reply says the visit is confirmed. ${trace}`).toBe(false);
  expect(saysRequested(reply), `the reply says the visit is requested before the customer sent it. ${trace}`).toBe(false);
  const year = Number(saturday.slice(0, 4));
  expect(
    datesIn(reply, year).filter((date) => date !== saturday),
    `the reply names another date. ${trace}`
  ).toEqual([]);
  expect(
    weekdaysIn(reply).filter((name) => name !== 'Saturday'),
    `the reply names another weekday. ${trace}`
  ).toEqual([]);

  // The page shows that picker, live: the reply's last message ends with it, waiting. No hand-off note: this is a gift and a visit.
  expect(livePickerOf([...asked, ...turn.messages]), `the picker waits for the customer. ${trace}`).toBe(picker.id);
  expect(handOffOf(turn), `a hand-off note shows. ${trace}`).toBeNull();
};

// Paul's conversation in production on 3 October, as Strapi Cloud logged it: what he asked and what the concierge
// replied. To the last message, the concierge replied in words with no picker, once. The "What do you have" reply goes
// back as the page sends it, with its search_products call before its words, so the Cabin Case 55 is a piece known from
// an earlier turn: the safety net's extra pass can run even when this turn searches for nothing. The replies' dashes are
// commas here: the words are no part of the case.
const PRODUCTION: Array<[string, string]> = [
  [
    'When is a good time to come into to the store',
    'Our boutiques in Ginza and Omotesando are open daily from 11:00 to 20:00, while Osaka Shinsaibashi keeps the same hours but is closed on Tuesdays. Any time in that window works well, so just let me know which boutique, day and time suit you and I can set up the visit.',
  ],
  ['Yes', "I'd love to set that up. Could you tell me which piece or pieces you'd like to see at the boutique?"],
  ['Can I book a visit?', 'Of course. Which piece or pieces would you like to see during your visit?'],
  [
    'What do you have',
    'Here are a few highlights: the Voyage Trunk 110, a grand travel trunk that can be personalized; the Cabin Case 55, a versatile personalizable trunk available at all our boutiques; and the Weekender 50, a stylish travel bag also open to personalization. Would you like to see any of these in person, or shall I narrow things down by budget or occasion?',
  ],
];
/** The search behind "What do you have", as search_products answers it (its structuredContent, and the same as text). */
const highlights = {
  products: [
    { slug: 'voyage-trunk-110', name: 'Voyage Trunk 110', category: 'trunk', priceJpy: 2800000, imageUrl: null, occasions: ['travel', 'wedding'], personalizable: true, inStockAt: ['ginza'] },
    { slug: 'cabin-case-55', name: 'Cabin Case 55', category: 'trunk', priceJpy: 690000, imageUrl: null, occasions: ['travel', 'new-job'], personalizable: true, inStockAt: ['ginza', 'omotesando', 'osaka'] },
    { slug: 'weekender-50', name: 'Weekender 50', category: 'travel', priceJpy: 385000, imageUrl: null, occasions: ['travel', 'birthday', 'anniversary'], personalizable: true, inStockAt: ['ginza', 'omotesando'] },
  ],
};
/** The conversation as the page holds it before the last message: the "What do you have" reply carries its search. */
const productionConversation = (): UIMessage[] => [
  ...PRODUCTION.flatMap(([asked, replied], index): UIMessage[] => {
    const searched = asked === 'What do you have' ? [toolCall('toolu_history_search', 'search_products', { locale: 'en' }, answer(highlights))] : [];
    return [say(asked, `u${index}`), assistantWith([...searched, { type: 'text', content: replied }], `a${index}`)];
  }),
  say('I would like to book a visit to see cabin case', 'ulast'),
];

afterEach(cleanup);

// These run without Ollama, Claude or Strapi: a scripted model and Strapi in memory, through the same route. They check
// that the readers below see what the page would, so a live failure is the model's, not the test's.
describe('the live test reads the route stream as the page does', () => {
  const picker = { id: 'p1', name: 'choose_visit', input: { productSlugs: ['weekender-50'], boutique: 'ginza', date: '2026-10-10', time: '14:00' } };

  it("gives the calls in order with their inputs and outputs, the words, and the picker that waits for the customer", async () => {
    const asked = [say('Something for a trip, to see at Ginza on Saturday?')];
    const { events } = await scriptedTurn({
      messages: asked,
      steps: [{ calls: [{ id: 'c1', name: 'search_products', input: { query: 'travel' } }] }, { calls: [{ id: 'c2', name: 'resolve_date', input: { weekday: 'saturday' } }] }, { words: 'Here is one piece for Saturday.', calls: [picker] }],
      strapi: { handlers: { search_products: () => answer({ products: [{ slug: 'weekender-50', name: 'Weekender 50' }] }) } },
    });
    const turn = readTurn(events);
    expect(turn.calls.map((call) => call.name)).toEqual(['search_products', 'resolve_date', 'choose_visit']);
    expect(turn.calls[0].input).toEqual({ query: 'travel' });
    expect(turn.calls[0].output?.structuredContent?.products).toEqual([{ slug: 'weekender-50', name: 'Weekender 50' }]);
    expect(turn.calls[1].output).toMatchObject({ date: '2026-10-10', weekday: 'Saturday' });
    expect(turn.calls[2].input).toEqual(picker.input);
    expect(turn.words).toBe('Here is one piece for Saturday.');
    expect(turn.trace).toContain('search_products({"query":"travel"})');
    expect(livePickerOf([...asked, ...turn.messages])).toBe('p1');
    expect(handOffOf(turn)).toBeNull();
  });

  it("finds the reference of a hand-off Strapi recorded, and none for a question the catalog answers", async () => {
    const handed = await scriptedTurn({
      messages: [say('Can I pay in bitcoin?')],
      steps: [{ calls: [{ id: 'c1', name: 'search_knowledge', input: { query: 'bitcoin' } }] }, { words: 'I have passed that on.' }],
      strapi: { handlers: { search_knowledge: () => answer({ entries: [] }), hand_off_to_staff: () => answer({ question: { reference: 'Q-0042', status: 'open', product: null } }) } },
    });
    const turn = readTurn(handed.events);
    expect(turn.calls.map((call) => call.name)).toContain('search_knowledge');
    expect(handOffOf(turn)).toMatchObject({ kind: 'recorded', recorded: { reference: 'Q-0042' } });
    expect(turn.calls.find((call) => call.name === 'search_knowledge')?.output?.structuredContent?.handOff?.reference).toBe('Q-0042');

    const answered = await scriptedTurn({
      messages: [say('How do I care for the leather?')],
      steps: [{ calls: [{ id: 'c1', name: 'search_knowledge', input: { query: 'leather care' } }] }, { words: 'Wipe it with a soft cloth.' }],
      strapi: { handlers: { search_knowledge: () => answer({ entries: [{ title: 'How do I care for the leather?' }] }) } },
    });
    expect(handOffOf(readTurn(answered.events))).toBeNull();
  });

  it("takes Paul's production conversation, with its search in the history, and ends in a picker for the Cabin Case 55", async () => {
    const messages = productionConversation();
    const { events, model } = await scriptedTurn({
      messages,
      steps: [{ calls: [{ id: 'p9', name: 'choose_visit', input: { productSlugs: ['cabin-case-55'] } }] }],
    });
    // The history reached the model with the search before the words of its reply.
    expect(JSON.stringify(model.requests[0].messages)).toContain('toolu_history_search');
    const turn = readTurn(events);
    expect(livePickerOf([...messages, ...turn.messages])).toBe('p9');
    expect(turn.calls.find((call) => call.id === 'p9')?.input.productSlugs).toContain('cabin-case-55');
  });

  it('reads a run that failed as an error event', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { events } = await scriptedTurn({ steps: [{ fail: 'The provider broke.' }] });
    quiet.mockRestore();
    expect(events.filter((event) => event.type === 'RUN_ERROR')).toHaveLength(1);
    expect(readTurn(events).calls).toEqual([]);
  });

  it("knows the model's address: the Ollama host as set, or the default, without a path", () => {
    expect(ollamaHost({ OLLAMA_BASE_URL: 'http://10.0.0.5:11434' })).toBe('http://10.0.0.5:11434');
    expect(ollamaHost({})).toBe('http://127.0.0.1:11434');
    expect(ollamaHost({ OLLAMA_BASE_URL: '' })).toBe('http://127.0.0.1:11434');
  });
});

// These run without Ollama or Strapi: they check the checks.
describe("the booking test's reply checks", () => {
  it('finds the dates an English reply mentions, and only dates', () => {
    expect(datesIn('Your visit on Saturday, October 3 at 2 pm is requested.', 2026)).toEqual(['2026-10-03']);
    expect(datesIn('Saturday, 3 October at 14:00', 2026)).toEqual(['2026-10-03']);
    expect(datesIn('on the 3rd of October, or Oct. 10th', 2026).sort()).toEqual(['2026-10-03', '2026-10-10']);
    expect(datesIn('That is 2026-10-03, a Saturday', 2026)).toEqual(['2026-10-03']);
    expect(datesIn('requestedFor 2026-10-03T14:00:00+09:00', 2026)).toEqual(['2026-10-03']);
    expect(datesIn('Saturday at 2 pm in Ginza: the Weekender 50 for ¥385,000 and 3 other pieces', 2026)).toEqual([]);
  });

  it('tells a visit that is confirmed from one that is only requested', () => {
    const confirmed = [
      'Your visit is confirmed.',
      'Your visit has been confirmed for Saturday.',
      'It is now confirmed.',
      'Both visits are already confirmed.',
      'The visit WAS confirmed.',
      'Your visit has already been confirmed.',
      // Contractions, and someone doing the confirming.
      "Great news, it's confirmed.",
      'It’s been confirmed.',
      "You're all confirmed for Saturday at 2 pm.",
      "I've confirmed your visit to the Ginza boutique.",
      'We have confirmed your appointment.',
      'The boutique has confirmed your visit.',
      // A clause before it, ended by a comma and a new subject, doesn't make it a confirmation still to come.
      'Once again, your visit is confirmed.',
      'After checking with Ginza, I’ve confirmed your visit.',
    ];
    const notConfirmed = [
      'Your visit has been requested. The boutique will confirm it on LINE.',
      'It is requested, and not yet confirmed.',
      "It isn't confirmed yet, and hasn't been confirmed by the boutique.",
      'Awaiting confirmation from the boutique.',
      'Please confirm the time.',
      // A confirmation still to come, whichever side of "confirmed" the condition is on.
      "You'll get a LINE message once it is confirmed.",
      'The boutique will message you on LINE when it is confirmed.',
      'You will hear from them as soon as the visit is confirmed by the boutique.',
      "After it's confirmed, you'll see it under Visits.",
      'It stays a request until it’s confirmed.',
      "I'll let you know when they've confirmed it.",
      'Once your visit on Saturday, October 3, is confirmed, the boutique will message you on LINE.',
      'Your visit is confirmed once the boutique accepts it on LINE.',
      'Nothing is confirmed until the boutique replies.',
      // The customer's yes.
      "Thank you, you've confirmed Saturday at 2 pm, so I've requested it.",
    ];
    // Soft, so a run names every reply it misjudges, not just the first.
    for (const reply of confirmed) expect.soft(saysConfirmed(reply), reply).toBe(true);
    for (const reply of notConfirmed) expect.soft(saysConfirmed(reply), reply).toBe(false);
  });

  it('reads a Japanese reply the same way', () => {
    for (const reply of ['確定しました。', 'ご予約が確定しました。', '土曜日14時のご予約が確定いたしました。', 'ご予約は確定です。']) {
      expect.soft(saysConfirmed(reply), reply).toBe(true);
    }
    // 確定しましたら is "once it is confirmed", 確定次第 "as soon as it is confirmed", and 未確定 "not confirmed".
    for (const reply of ['確定しましたらLINEでお知らせいたします。', 'ご予約が確定しましたら、LINEでお知らせいたします。', '予約が確定次第、LINEでご連絡いたします。', 'まだ確定しておりません。', 'ご予約はまだ未確定です。']) {
      expect.soft(saysConfirmed(reply), reply).toBe(false);
    }
  });

  it('tells a visit the model says it requested from one the customer still has to send', () => {
    const requested = [
      "I've requested a visit for Saturday, October 10 at 2pm in Ginza with these three pieces for you to see.",
      'I have booked Saturday at 2 pm at Ginza for you.',
      'I requested a visit to Ginza on Saturday.',
      'Your visit is requested, and the boutique will confirm it on LINE.',
      'The request has been sent to Ginza.',
      'ご来店のリクエストを送信しました。',
      '土曜日14時でご予約いたしました。',
      'ご予約を承りました。',
      "I've sent the request to Ginza.",
      "I've set up your visit for Saturday at 2 pm.",
      "You're booked for Saturday at 2 pm at Ginza.",
      'Your visit to Ginza on Saturday at 2 pm is requested.',
      'Your visit is all booked.',
      'リクエストをお送りしました。',
      'ご予約が完了しました。',
    ];
    const notRequested = [
      'Tap Send request to ask Ginza for Saturday at 2 pm.',
      "I've filled in Ginza, Saturday 10 October and 2 pm: send the request when you're ready.",
      'Once you send the request, the boutique will confirm it on LINE.',
      "I haven't requested anything yet.",
      'Here are three travel pieces in stock at Ginza.',
      "I've made a short list of three travel pieces, and I've sent the details to the form below.",
      'リクエストを送信してください。',
      'リクエストを送信しましたら、ブティックがLINEでお知らせします。',
      'The request is sent when you tap Send request.',
      'Your request is sent to Ginza once you tap Send.',
      'ご要望を承りました。フォームをご用意しました。',
      'ご来店のご希望を承ります。',
    ];
    for (const reply of requested) expect.soft(saysRequested(reply), reply).toBe(true);
    for (const reply of notRequested) expect.soft(saysRequested(reply), reply).toBe(false);
  });

  it('finds the weekday names an English reply mentions', () => {
    expect(weekdaysIn('Saturday, October 3, at 2 pm')).toEqual(['Saturday']);
    expect(weekdaysIn('Closed on Mondays; see you on friday')).toEqual(['Monday', 'Friday']);
    expect(weekdaysIn('Weekender 50 at the boutique')).toEqual([]);
  });
});

/** A demo customer signed in through the verify mock, and the mock itself, started when nothing answers on its port. */
const signedIn = () => {
  let stopMock = () => {};
  let token = '';
  beforeAll(async () => {
    stopMock = await ensureVerifyMock();
    token = await createSession({ strapiUrl: STRAPI_URL, clientId, getIdToken: () => `valid.${CUSTOMER}` }).getToken();
  });
  afterAll(() => stopMock());
  return () => token;
};

describe.skipIf(!ready)('the concierge on the chosen model', () => {
  const token = signedIn();
  /** One English turn through the route, as the page sends it. */
  const turn = (text: string) => converse(token(), [say(text, 'u1')]);

  it('answers the demo question from the catalog tools, and names only products they returned', async () => {
    const reply = await converse(token(), [say(QUESTION, 'u1')]);
    const { calls, words: answerText } = reply;
    const context = `Answer: ${answerText} ${reply.trace}`;
    expect(
      calls.some((call) => ['search_products', 'find_boutiques'].includes(call.name)),
      `it called a catalog tool. ${context}`
    ).toBe(true);

    // Every product a tool returned in this conversation, by slug.
    const returned = new Set(
      calls
        .flatMap((call) => {
          const data = call.output?.structuredContent ?? {};
          return [...((data.products as Product[]) ?? []), ...(data.product ? [data.product as Product] : [])];
        })
        .map((product) => product.slug)
    );

    // The whole catalog in both languages, and the demo question's own answer, straight from search_products.
    const mcp = new Client({ name: 'maison-live-test', version: '1.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${STRAPI_URL}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token()}` } } }));
    const search = async (args: Record<string, unknown>) => ((await mcp.callTool({ name: 'search_products', arguments: { limit: 20, ...args } })).structuredContent as { products: Product[] }).products;
    const catalog = [...(await search({ locale: 'en' })), ...(await search({ locale: 'ja' }))];
    const fits = new Set((await search({ locale: 'en', occasion: 'travel', maxPriceJpy: 400000, inStockAt: 'ginza' })).map((product) => product.slug));
    await mcp.close();

    const named = [...new Set(catalog.filter((product) => answerText.includes(product.name)).map((product) => product.slug))];
    expect(named.length, `the answer names a product. ${context}`).toBeGreaterThan(0);
    for (const slug of named) expect(returned.has(slug), `${slug} came from a tool call, not from the model. ${context}`).toBe(true);
    expect(
      named.some((slug) => fits.has(slug)),
      `a named product fits the question. ${context}`
    ).toBe(true);
    // A gift is no policy question: the chat shows no hand-off note under the answer.
    expect(handOffOf(reply), `a hand-off note shows on a gift question. ${context}`).toBeNull();
  });

  it("ends the demo's first suggestion in a visit picker for Ginza, the next Saturday in Tokyo and 14:00, with the date resolve_date returned", async () => {
    await expectTheDemoPicker(token());
  });

  it("answers a care question from Maison's product knowledge", async () => {
    const reply = await turn('How do I care for the leather?');
    const called = reply.calls.map((call) => call.name);
    const found = reply.calls.flatMap((call) => (call.output?.structuredContent?.entries as Array<{ title: string }> | undefined) ?? []);
    expect(called, reply.words).toContain('search_knowledge');
    expect(
      found.map((entry) => entry.title),
      reply.words
    ).toContain('How do I care for the leather?');
    expect(called, reply.words).not.toContain('hand_off_to_staff');
    expect(handOffOf(reply), `a hand-off note shows on a care question. ${reply.trace}`).toBeNull();
    expect(reply.words, 'the answer uses the entry').toMatch(/cloth|sunlight|balm/i);
  });

  it("shows the hand-off note for a question Maison hasn't written about, with Strapi's reference only when it recorded the question", async () => {
    const reply = await turn('Can I pay in bitcoin?');
    const { calls, words } = reply;
    const called = calls.map((call) => call.name);
    expect(called, words).toContain('search_knowledge');
    // The chat shows a note after a search that found nothing: the app records the question itself (the search's result carries it), or the plain note when that fails.
    const note = handOffOf(reply);
    expect(note, `the chat shows no hand-off note. Tools: ${called.join(', ')}. Answer: ${words}`).not.toBeNull();
    // The note says the question is with the advisors, under its reference, only when Strapi recorded it: its own reference, from the app's hand-off on the search or from the model's call, or none.
    const recorded = calls.find(
      (call) => (call.name === 'search_knowledge' && call.output?.structuredContent?.handOff?.reference) || (call.name === 'hand_off_to_staff' && call.output?.structuredContent?.question?.reference)
    );
    const reference = recorded?.output?.structuredContent.handOff?.reference ?? recorded?.output?.structuredContent.question?.reference;
    expect(note?.recorded?.reference, `the note's reference is the one Strapi gave. Tools: ${called.join(', ')}. Answer: ${words}`).toBe(reference);
    // With nothing recorded (the hand-off failed), the reply must not promise contact: nobody has the question.
    if (!note?.recorded) expect(words, `it promises contact though nothing was recorded. Tools: ${called.join(', ')}`).not.toMatch(/will (contact|reach out|get back)/i);
  });
});

describe.skipIf(!ready || !claude)('the visit picker on Claude', () => {
  const token = signedIn();

  it('shows the picker for the piece on whose page the customer asks "Can we schedule one?", with nothing they didn\'t name', async () => {
    const asked = [say('Can we schedule one?', 'u1')];
    const reply = await converse(token(), asked, { product: 'weekender-50' });
    const { trace } = reply;
    const pickers = reply.calls.filter((call) => call.name === CHOOSE_VISIT);
    expect(pickers, `it shows one picker. ${trace}`).toHaveLength(1);
    expect(pickers[0].input.productSlugs, `the picker is for the piece. ${trace}`).toEqual(['weekender-50']);
    // Nothing was named, so nothing is filled in: the picker starts as the sheet does.
    for (const key of ['boutique', 'date', 'time']) expect(pickers[0].input, `the model filled in ${key}. ${trace}`).not.toHaveProperty(key);
    expect(
      reply.calls.some((call) => call.name === 'resolve_date'),
      `it asked resolve_date, for no day. ${trace}`
    ).toBe(false);
    expect(saysConfirmed(reply.words), `the reply says a visit is confirmed. ${trace}`).toBe(false);
    expect(saysRequested(reply.words), `the reply says the visit is requested before the customer sent it. ${trace}`).toBe(false);
    expect(livePickerOf([...asked, ...reply.messages]), `the picker waits for the customer. ${trace}`).toBe(pickers[0].id);
  });

  it("ends the demo's first suggestion in a visit picker for Ginza, the next Saturday in Tokyo and 14:00", async () => {
    await expectTheDemoPicker(token());
  });

  // This case mostly checks the model's own choose_visit call: Claude rarely slips, so the extra pass seldom runs here.
  // The unit tests in src/lib/concierge/handle-picker.test.ts are what check the extra pass.
  it("ends Paul's production conversation in a visit picker for the Cabin Case 55, from the model's own call or the extra pass", async () => {
    const messages = productionConversation();
    const reply = await converse(token(), messages);
    const { trace } = reply;
    const live = livePickerOf([...messages, ...reply.messages]);
    expect(live, `the turn ends in a picker that waits for the customer. ${trace}`).not.toBeNull();
    const picker = reply.calls.find((call) => call.name === CHOOSE_VISIT && call.id === live);
    expect(picker?.input.productSlugs, `the picker is for the Cabin Case 55. ${trace}`).toContain('cabin-case-55');
    expect(saysRequested(reply.words), `the reply says the visit is requested before the customer sent it. ${trace}`).toBe(false);
  });
});
