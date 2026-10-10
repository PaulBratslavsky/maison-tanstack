import { EventType, chat, maxIterations, toolDefinition, type JSONSchema, type StreamChunk } from '@tanstack/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openMcp } from './mcp-tools';
import { answer, fakeStrapi, refusal, scriptedModel, toolContext, type Handler } from './test-support';
import { withAutoHandOff, withConversationLocale } from './tool-wrappers';

/** A tool that records what it is asked, with the JSON Schema `properties` its input has. */
const stub = (name: string, run: (input: any) => unknown, properties: Record<string, unknown> = {}) =>
  toolDefinition({ name, description: `The ${name} tool.`, inputSchema: { type: 'object', properties } as JSONSchema }).server(async (input) => run(input));

const run = (tools: ReadonlyArray<{ name: string; execute?: (input: any, context?: any) => unknown }>, name: string, input: unknown, signal?: AbortSignal) =>
  tools.find((tool) => tool.name === name)!.execute!(input, toolContext(signal)) as Promise<any>;

describe('withConversationLocale', () => {
  const properties = { query: { type: 'string' }, locale: { type: 'string', enum: ['ja', 'en'] } };

  it('sends the conversation locale to a tool that takes one when the model leaves it out, or sends null or an empty string', async () => {
    const received: unknown[] = [];
    const tools = withConversationLocale([stub('search_products', (input) => received.push(input), properties)], 'en');
    for (const input of [{ query: 'bag' }, { query: 'bag', locale: null }, { query: 'bag', locale: '' }]) await run(tools, 'search_products', input);
    expect(received).toEqual([
      { query: 'bag', locale: 'en' },
      { query: 'bag', locale: 'en' },
      { query: 'bag', locale: 'en' },
    ]);
  });

  it('keeps the locale the model gives', async () => {
    const received: unknown[] = [];
    const tools = withConversationLocale([stub('search_products', (input) => received.push(input), properties)], 'en');
    await run(tools, 'search_products', { query: 'bag', locale: 'ja' });
    expect(received).toEqual([{ query: 'bag', locale: 'ja' }]);
  });

  it("adds none to a tool that doesn't take one, and passes input that is not an object on as it is", async () => {
    const received: unknown[] = [];
    const tools = withConversationLocale([stub('my_appointments', (input) => received.push(input), { status: { type: 'string' } }), stub('search_products', (input) => received.push(input), properties)], 'ja');
    await run(tools, 'my_appointments', { status: 'open' });
    await run(tools, 'search_products', 'bag');
    expect(received).toEqual([{ status: 'open' }, 'bag']);
  });

  it('returns the tools that need nothing as they are, and the others as new tools that keep their name, description and schema', () => {
    const plain = stub('my_appointments', () => ({}), { status: { type: 'string' } });
    const local = stub('search_products', () => ({}), properties);
    const noRun = toolDefinition({ name: 'resolve', description: 'x', inputSchema: { type: 'object', properties } as JSONSchema }).client();
    const wrapped = withConversationLocale([plain, local, noRun], 'en');
    expect(wrapped[0]).toBe(plain);
    expect(wrapped[2]).toBe(noRun);
    expect(wrapped[1]).not.toBe(local);
    expect(wrapped[1].execute).not.toBe(local.execute);
    expect(wrapped[1].name).toBe('search_products');
    expect(wrapped[1].description).toBe(local.description);
    expect(wrapped[1].inputSchema).toBe(local.inputSchema);
  });

  it("passes the run's abort signal on to the tool", async () => {
    let seen: AbortSignal | undefined;
    const tools = withConversationLocale([toolDefinition({ name: 'search_products', description: 'x', inputSchema: { type: 'object', properties } as JSONSchema }).server(async (_input, context) => ((seen = context?.abortSignal), {}))], 'en');
    const controller = new AbortController();
    await run(tools, 'search_products', {}, controller.signal);
    expect(seen).toBe(controller.signal);
  });

  it("works on Strapi's own tools in a real run: the call that reaches Strapi has the chat's locale", async () => {
    const strapi = await fakeStrapi();
    const mcp = await openMcp({ strapiUrl: 'http://strapi.test', authorization: 'Bearer x', createTransport: () => strapi.clientTransport });
    const model = scriptedModel([{ calls: [{ id: 'c1', name: 'search_products', input: { query: 'bag' } }, { id: 'c2', name: 'search_products', input: { query: 'case', locale: 'ja' } }] }, { words: 'Done.' }]);
    for await (const _ of chat({ adapter: model.adapter as never, messages: [{ role: 'user', content: 'Bags' }], tools: withConversationLocale(mcp.tools, 'en'), agentLoopStrategy: maxIterations(8), debug: false }) as AsyncIterable<StreamChunk>) void _;
    expect(strapi.calls).toEqual([
      { name: 'search_products', args: { query: 'bag', locale: 'en' } },
      { name: 'search_products', args: { query: 'case', locale: 'ja' } },
    ]);
    await mcp.close();
    await strapi.close();
  });
});

describe('withAutoHandOff', () => {
  const QUESTION = 'Can it hold a watch?';
  const context = { question: QUESTION, piece: null, locale: 'en' } as const;
  /** The sentence the model is given with the search's result, word for word. */
  const told = (reference: string) => `No entry answers this, so the question was passed to Maison's client advisors as ${reference}. Don't call hand_off_to_staff for it.`;
  const searchResult = answer({ locale: 'en', entries: [] });
  const recorded = (reference: string, product: { slug: string; name: string } | null = null) => answer({ question: { reference, status: 'open', product } });
  const searchProps = { query: { type: 'string' }, productSlugs: { type: 'array' }, locale: { type: 'string' } };
  const handOffProps = { question: { type: 'string' }, reason: { type: 'string' }, productSlug: { type: 'string' }, locale: { type: 'string' } };

  afterEach(() => vi.restoreAllMocks());

  it('is the tools it was given when search_knowledge or hand_off_to_staff is missing, or has nothing to run', () => {
    const search = stub('search_knowledge', () => searchResult);
    const handOff = stub('hand_off_to_staff', () => recorded('Q-1'));
    const other = stub('search_products', () => ({}));
    const noRun = toolDefinition({ name: 'hand_off_to_staff', description: 'x' }).client();
    for (const tools of [[], [search], [handOff], [other, handOff], [search, noRun]]) expect(withAutoHandOff(tools, context)).toBe(tools);
  });

  it('wraps the two tools in new ones that keep their name, description and schema, and leaves the other tools and the originals as they were', () => {
    const search = stub('search_knowledge', () => searchResult, searchProps);
    const handOff = stub('hand_off_to_staff', () => recorded('Q-1'), handOffProps);
    const other = stub('search_products', () => ({}));
    const searchRun = search.execute;
    const wrapped = withAutoHandOff([search, handOff, other], context);
    expect(wrapped.map((tool) => tool.name)).toEqual(['search_knowledge', 'hand_off_to_staff', 'search_products']);
    expect(wrapped[2]).toBe(other);
    expect(search.execute).toBe(searchRun);
    for (const [index, original] of [search, handOff].entries()) {
      expect(wrapped[index]).not.toBe(original);
      expect(wrapped[index].execute).not.toBe(original.execute);
      expect(wrapped[index].description).toBe(original.description);
      expect(wrapped[index].inputSchema).toBe(original.inputSchema);
    }
  });

  /** The two tools on a Strapi stand-in that records what reaches it. A search finds nothing unless `search` says otherwise. */
  const strapi = ({ search, handOff }: { search?: (input: any) => unknown; handOff?: (input: any, reference: string) => unknown } = {}) => {
    const received: Array<{ name: string; input: any }> = [];
    let handOffs = 0;
    const tools = [
      stub('search_knowledge', (input) => (received.push({ name: 'search_knowledge', input }), search ? search(input) : answer({ locale: input?.locale ?? 'en', entries: [] })), searchProps),
      stub(
        'hand_off_to_staff',
        (input) => {
          received.push({ name: 'hand_off_to_staff', input });
          const reference = `Q-${String((handOffs += 1)).padStart(4, '0')}`;
          return handOff ? handOff(input, reference) : recorded(reference);
        },
        handOffProps
      ),
    ];
    return { tools, received, handOffsOf: () => received.filter((call) => call.name === 'hand_off_to_staff').map((call) => call.input) };
  };

  it("hands the question to staff itself: once, with the customer's question, reason no_answer, the page's piece and the chat's language", async () => {
    const { tools, received } = strapi();
    const wrapped = withAutoHandOff(tools, { ...context, piece: 'jewelry-coffret' });
    await run(wrapped, 'search_knowledge', { query: 'watch storage', productSlugs: ['jewelry-coffret'], locale: 'en' });
    expect(received).toStrictEqual([
      { name: 'search_knowledge', input: { query: 'watch storage', productSlugs: ['jewelry-coffret'], locale: 'en' } },
      { name: 'hand_off_to_staff', input: { question: QUESTION, reason: 'no_answer', productSlug: 'jewelry-coffret', locale: 'en' } },
    ]);
  });

  it("sends the chat's language with it, which is the question's language", async () => {
    const { tools, handOffsOf } = strapi();
    const question = 'これは腕時計を入れられますか？';
    await run(withAutoHandOff(tools, { question, piece: null, locale: 'ja' }), 'search_knowledge', { query: 'watch' });
    expect(handOffsOf()).toStrictEqual([{ question, reason: 'no_answer', locale: 'ja' }]);
  });

  // Which piece the app records is the piece the search was about, which is not always the page's.
  const handOffFrom = async (page: string | null, productSlugs: unknown) => {
    const { tools, handOffsOf } = strapi();
    await run(withAutoHandOff(tools, { ...context, piece: page }), 'search_knowledge', { query: 'watch', ...(productSlugs === undefined ? {} : { productSlugs }) });
    return handOffsOf();
  };
  const aboutPiece = (slug?: string) => [{ question: QUESTION, reason: 'no_answer', ...(slug ? { productSlug: slug } : {}), locale: 'en' }];

  it('records the piece the search names when it names exactly one, whatever page the customer is on', async () => {
    const cases: Array<[string, string | null, unknown, string]> = [
      ["on another piece's page", 'jewelry-coffret', ['weekender-50'], 'weekender-50'],
      ['on no page', null, ['weekender-50'], 'weekender-50'],
      ["on that piece's own page", 'jewelry-coffret', ['jewelry-coffret'], 'jewelry-coffret'],
      ['named twice, which is one piece', 'jewelry-coffret', ['weekender-50', 'weekender-50'], 'weekender-50'],
    ];
    for (const [what, page, productSlugs, slug] of cases) expect(await handOffFrom(page, productSlugs), what).toStrictEqual(aboutPiece(slug));
  });

  it("records the page's piece when the search names no piece, or its slugs include the page's piece", async () => {
    const cases: Array<[string, unknown]> = [
      ['no productSlugs', undefined],
      ['an empty list', []],
      ["null, which the local model sends for what it isn't using", null],
      ['a value that is no slug, which names no piece', ['../etc']],
      ["several pieces, the page's first", ['jewelry-coffret', 'weekender-50']],
      ["several pieces, the page's last", ['weekender-50', 'voyage-trunk', 'jewelry-coffret']],
    ];
    for (const [what, productSlugs] of cases) expect(await handOffFrom('jewelry-coffret', productSlugs), what).toStrictEqual(aboutPiece('jewelry-coffret'));
  });

  it("records no piece when the search names several and none is the page's, or it names none and there is no page", async () => {
    const cases: Array<[string, string | null, unknown]> = [
      ["several pieces, none the page's", 'jewelry-coffret', ['weekender-50', 'voyage-trunk']],
      ['several pieces, on no page', null, ['weekender-50', 'voyage-trunk']],
      ['an empty list, on no page', null, []],
      ['no productSlugs, on no page', null, undefined],
    ];
    for (const [what, page, productSlugs] of cases) expect(await handOffFrom(page, productSlugs), what).toStrictEqual(aboutPiece());
  });

  it("adds what Strapi recorded to the search's result: a sentence for the model and structuredContent.handOff, and nothing else changes", async () => {
    const product = { slug: 'jewelry-coffret', name: 'Jewelry Coffret' };
    const { tools } = strapi({ handOff: (_input, reference) => recorded(reference, product) });
    const result = await run(withAutoHandOff(tools, { ...context, piece: 'jewelry-coffret' }), 'search_knowledge', { query: 'watch' });
    expect(result).toStrictEqual({
      content: [{ type: 'text', text: JSON.stringify({ locale: 'en', entries: [] }) }, { type: 'text', text: told('Q-0001') }],
      // The question is the text the app sent, and the piece is what Strapi answered.
      structuredContent: { locale: 'en', entries: [], handOff: { reference: 'Q-0001', question: QUESTION, product } },
    });
  });

  it("has a piece of null when Strapi's answer names none, and takes Strapi's reference as it is", async () => {
    const { tools } = strapi({ handOff: () => recorded('Q-9X7') });
    const result = await run(withAutoHandOff(tools, context), 'search_knowledge', { query: 'watch' });
    expect(result.structuredContent.handOff).toStrictEqual({ reference: 'Q-9X7', question: QUESTION, product: null });
    expect(result.content.at(-1)).toStrictEqual({ type: 'text', text: told('Q-9X7') });
  });

  it("doesn't hand off when the search found an entry, and leaves its result as it is", async () => {
    const found = answer({ locale: 'en', entries: [{ title: 'Leather care', answer: 'Wipe it.', category: 'care', productSlugs: [] }] });
    const { tools, handOffsOf } = strapi({ search: () => found });
    expect(await run(withAutoHandOff(tools, context), 'search_knowledge', { query: 'leather' })).toBe(found);
    expect(handOffsOf()).toEqual([]);
  });

  it("doesn't hand off when the search failed, was refused, or can't be read as finding nothing", async () => {
    const answers = [refusal('unavailable', 'Refused.'), { content: [{ type: 'text', text: 'oops' }] }, answer({ entries: 'none' }), answer({ locale: 'en' }), { isError: false, content: [] }];
    for (const result of answers) {
      const { tools, handOffsOf } = strapi({ search: () => result });
      expect(await run(withAutoHandOff(tools, context), 'search_knowledge', { query: 'x' })).toBe(result);
      expect(handOffsOf()).toEqual([]);
    }
    const { tools } = strapi({
      search: () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(run(withAutoHandOff(tools, context), 'search_knowledge', { query: 'x' })).rejects.toThrow('fetch failed');
  });

  it("doesn't hand off a question with nothing in it: Strapi would refuse it", async () => {
    const { tools, handOffsOf } = strapi();
    const result = await run(withAutoHandOff(tools, { ...context, question: '' }), 'search_knowledge', { query: 'x' });
    expect(result.structuredContent).toStrictEqual({ locale: 'en', entries: [] });
    expect(handOffsOf()).toEqual([]);
  });

  it("leaves the search's result as it is when the hand-off fails: Strapi refuses it, it breaks, or the answer has no reference", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failures: Array<[string, () => unknown]> = [
      [
        'broke on the way',
        () => {
          throw new TypeError('fetch failed');
        },
      ],
      ['refused', () => refusal('unavailable', 'Refused.', 'Do not try again.')],
      ['no reference', () => answer({ question: { status: 'open', product: null } })],
    ];
    for (const [what, handOff] of failures) {
      const { tools } = strapi({ handOff });
      expect(await run(withAutoHandOff(tools, context), 'search_knowledge', { query: 'watch' }), what).toStrictEqual(searchResult);
    }
  });

  it('says in the log why a hand-off recorded nothing, with Strapi\'s own words, and says nothing when it went through', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await run(withAutoHandOff(strapi({ handOff: () => refusal('unavailable', 'Refused.', 'Do not try again.') }).tools, context), 'search_knowledge', { query: 'x' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe('[concierge] The hand-off for a search that found nothing recorded nothing: {"error":{"code":"unavailable","message":"Refused.","hint":"Do not try again."}}');
    warn.mockClear();
    await run(withAutoHandOff(strapi().tools, context), 'search_knowledge', { query: 'x' });
    await run(withAutoHandOff(strapi({ search: () => answer({ locale: 'en', entries: [{ title: 'a' }] }) }).tools, context), 'search_knowledge', { query: 'x' });
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs a failed hand-off only while the request is still going: after the customer's abort, whichever way it failed, it says nothing", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failures: Array<[string, () => unknown]> = [
      [
        'broke on the way',
        () => {
          throw new TypeError('Request was aborted');
        },
      ],
      ['refused', () => refusal('unavailable', 'Refused.')],
      ['no reference', () => answer({ question: { status: 'open', product: null } })],
    ];
    for (const [what, failure] of failures) {
      for (const aborted of [false, true]) {
        warn.mockClear();
        const gone = new AbortController();
        const tools = [
          stub('search_knowledge', () => searchResult, searchProps),
          stub('hand_off_to_staff', () => {
            if (aborted) gone.abort(); // the customer closes the chat while the hand-off is with Strapi
            return failure();
          }, handOffProps),
        ];
        expect(await run(withAutoHandOff(tools, context), 'search_knowledge', { query: 'watch' }, gone.signal), what).toStrictEqual(searchResult);
        expect(warn, `${what}, ${aborted ? 'after the abort' : 'with the request going'}`).toHaveBeenCalledTimes(aborted ? 0 : 1);
      }
    }
  });

  it('answers an explicit hand_off_to_staff after the automatic one with the same question and no second call to Strapi', async () => {
    const { tools, handOffsOf } = strapi();
    const wrapped = withAutoHandOff(tools, context);
    await run(wrapped, 'search_knowledge', { query: 'watch' });
    const explicit = await run(wrapped, 'hand_off_to_staff', { question: 'Something else entirely.', reason: 'asked_for_person' });
    expect(explicit.structuredContent).toStrictEqual({ question: { reference: 'Q-0001', status: 'open', product: null } });
    expect(JSON.parse(explicit.content[0].text)).toStrictEqual(explicit.structuredContent);
    expect(handOffsOf()).toHaveLength(1);
  });

  it('gives the same answer to every explicit hand-off after the first, whatever it asks, with no call to Strapi', async () => {
    const { tools, handOffsOf } = strapi();
    const wrapped = withAutoHandOff(tools, context);
    const first = await run(wrapped, 'hand_off_to_staff', { question: 'A person, please.', reason: 'asked_for_person' });
    const second = await run(wrapped, 'hand_off_to_staff', { question: 'Another question.', reason: 'no_answer' });
    expect(second.structuredContent).toStrictEqual(first.structuredContent);
    expect(handOffsOf()).toEqual([{ question: 'A person, please.', reason: 'asked_for_person' }]);
    // A search that finds nothing after it hands off nothing more.
    expect((await run(wrapped, 'search_knowledge', { query: 'watch' })).structuredContent).toStrictEqual({ locale: 'en', entries: [] });
    expect(handOffsOf()).toHaveLength(1);
  });

  it("doesn't count a hand-off that failed or broke: the next one, the model's or the app's, still reaches Strapi", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const { tools, handOffsOf } = strapi({
      handOff: (_input, reference) => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        if (calls === 2) return refusal('unavailable', 'Refused.');
        return recorded(reference);
      },
    });
    const wrapped = withAutoHandOff(tools, context);
    await run(wrapped, 'search_knowledge', { query: 'a' }); // broke
    await expect(run(wrapped, 'hand_off_to_staff', { question: 'Q', reason: 'no_answer' })).resolves.toMatchObject({ isError: true }); // refused
    const third = await run(wrapped, 'hand_off_to_staff', { question: 'Q', reason: 'no_answer' });
    expect(third.structuredContent.question.reference).toBe('Q-0003');
    expect(handOffsOf()).toHaveLength(3);
  });

  it("keeps one hand-off for each call to it: two sets of wrapped tools over the same tools don't share one", async () => {
    const { tools } = strapi();
    const one = withAutoHandOff(tools, context);
    const two = withAutoHandOff(tools, context);
    expect((await run(one, 'search_knowledge', {})).structuredContent.handOff.reference).toBe('Q-0001');
    expect((await run(two, 'search_knowledge', {})).structuredContent.handOff.reference).toBe('Q-0002');
    expect((await run(one, 'hand_off_to_staff', {})).structuredContent.question.reference).toBe('Q-0001');
    expect((await run(two, 'hand_off_to_staff', {})).structuredContent.question.reference).toBe('Q-0002');
  });

  it("makes an explicit hand-off that arrives while the app's own is still with Strapi wait for it, and share its answer", async () => {
    const pending = Promise.withResolvers<unknown>();
    const received: unknown[] = [];
    const tools = [
      stub('search_knowledge', () => searchResult, searchProps),
      stub('hand_off_to_staff', (input) => {
        received.push(input);
        return pending.promise;
      }, handOffProps),
    ];
    const wrapped = withAutoHandOff(tools, context);
    const search = run(wrapped, 'search_knowledge', { query: 'watch' });
    await vi.waitFor(() => expect(received).toHaveLength(1)); // the app's call is out
    const explicit = run(wrapped, 'hand_off_to_staff', { question: 'Can a watch fit in it?', reason: 'no_answer' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toHaveLength(1); // the model's call waits: it didn't go to Strapi too
    pending.resolve(recorded('Q-7'));
    expect((await search).structuredContent.handOff.reference).toBe('Q-7');
    expect((await explicit).structuredContent.question.reference).toBe('Q-7');
    expect(received).toHaveLength(1);
  });

  it("lets the model's own hand-off go to Strapi when the app's, which it waited for, failed", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = Promise.withResolvers<unknown>();
    const received: unknown[] = [];
    const tools = [
      stub('search_knowledge', () => searchResult, searchProps),
      stub('hand_off_to_staff', (input) => {
        received.push(input);
        return received.length === 1 ? first.promise : recorded('Q-8');
      }, handOffProps),
    ];
    const wrapped = withAutoHandOff(tools, context);
    const search = run(wrapped, 'search_knowledge', { query: 'watch' });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const explicit = run(wrapped, 'hand_off_to_staff', { question: 'A person, please.', reason: 'asked_for_person' });
    first.resolve(refusal('unavailable', 'Refused.'));
    // Nothing was recorded, so the model's call is its own: it reaches Strapi, with what the model sent.
    expect((await explicit).structuredContent.question.reference).toBe('Q-8');
    expect(received).toEqual([{ question: QUESTION, reason: 'no_answer', locale: 'en' }, { question: 'A person, please.', reason: 'asked_for_person' }]);
    expect(await search).toStrictEqual(searchResult);
  });

  describe('in a real chat() run over Strapi through MCP', () => {
    /** Runs the script over the in-memory Strapi, with both wrappers as the route applies them. */
    const converse = async (steps: Parameters<typeof scriptedModel>[0], handlers: Record<string, Handler>, wrapContext = context) => {
      const strapiServer = await fakeStrapi({ handlers });
      const mcp = await openMcp({ strapiUrl: 'http://strapi.test', authorization: 'Bearer x', createTransport: () => strapiServer.clientTransport });
      const model = scriptedModel(steps);
      const chunks: StreamChunk[] = [];
      const tools = withAutoHandOff(withConversationLocale(mcp.tools, wrapContext.locale), wrapContext);
      for await (const chunk of chat({ adapter: model.adapter as never, messages: [{ role: 'user', content: QUESTION }], tools, agentLoopStrategy: maxIterations(8), debug: false }) as AsyncIterable<StreamChunk>) chunks.push(chunk);
      await mcp.close();
      await strapiServer.close();
      const results = chunks.filter((chunk) => chunk.type === EventType.TOOL_CALL_RESULT).map((chunk) => JSON.parse((chunk as unknown as { content: string }).content));
      return { calls: strapiServer.calls, results, model };
    };
    let references = 0;
    const handlers = (): Record<string, Handler> => ({
      search_knowledge: (args) => answer({ locale: args.locale, entries: [] }),
      hand_off_to_staff: () => recorded(`Q-${String((references += 1)).padStart(4, '0')}`),
    });

    it('hands off once when the model searches and hands off in the same step, though its two calls run together', async () => {
      references = 0;
      const { calls, results } = await converse(
        [
          {
            calls: [
              { id: 'c1', name: 'search_knowledge', input: { query: 'watch' } },
              { id: 'c2', name: 'hand_off_to_staff', input: { question: QUESTION, reason: 'no_answer' } },
            ],
          },
          { words: 'Passed on.' },
        ],
        handlers()
      );
      expect(calls.filter((call) => call.name === 'hand_off_to_staff')).toHaveLength(1);
      // Whichever call reached Strapi first recorded it, and the other was given the same question.
      const found = results.map((result) => result.structuredContent?.handOff?.reference ?? result.structuredContent?.question?.reference).filter(Boolean);
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(new Set(found)).toEqual(new Set(['Q-0001']));
    });

    it('sends the search to Strapi with the chat locale and hands off with it', async () => {
      references = 0;
      const { calls, model } = await converse([{ calls: [{ id: 'c1', name: 'search_knowledge', input: { query: 'watch' } }] }, { words: 'Noted.' }], handlers());
      // The model's next call reads the search's result, with the sentence that says what the app did.
      expect(JSON.stringify(model.requests[1].messages)).toContain("passed to Maison's client advisors as Q-0001");
      expect(calls).toEqual([
        { name: 'search_knowledge', args: { query: 'watch', locale: 'en' } },
        { name: 'hand_off_to_staff', args: { question: QUESTION, reason: 'no_answer', locale: 'en' } },
      ]);
    });

    it('hands off once in each run: a hand-off is never shared with another', async () => {
      references = 0;
      const steps = [{ calls: [{ id: 'c1', name: 'search_knowledge', input: { query: 'watch' } }] }, { words: 'Noted.' }];
      const first = await converse(steps, handlers());
      const second = await converse(steps, handlers());
      expect(first.results[0].structuredContent.handOff.reference).toBe('Q-0001');
      expect(second.results[0].structuredContent.handOff.reference).toBe('Q-0002');
    });

    it("leaves the search alone when the token has no hand_off_to_staff, and the hand-off alone when it has no search_knowledge", async () => {
      const strapiServer = await fakeStrapi({ tools: ['search_knowledge', 'my_appointments'] });
      const mcp = await openMcp({ strapiUrl: 'http://strapi.test', authorization: 'Bearer x', createTransport: () => strapiServer.clientTransport });
      expect(withAutoHandOff(mcp.tools, context)).toBe(mcp.tools);
      await mcp.close();
      await strapiServer.close();
    });
  });
});
