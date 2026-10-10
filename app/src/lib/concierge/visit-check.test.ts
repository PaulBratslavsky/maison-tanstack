import { EventType, chat, maxIterations, type StreamChunk, type UIMessage } from '@tanstack/ai';
import { ChatClient, type ConnectionAdapter } from '@tanstack/ai-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHOOSE_VISIT, livePickerOf, pickerViewOf } from '../visit-picker';
import { chooseVisitTool, resolveDateTool } from './local-tools';
import { openMcp } from './mcp-tools';
import { answer, fakeStrapi, refusal, scriptedModel, type Handler, type Step } from './test-support';
import { chooseVisitCheck } from './visit-check';

/**
 * choose_visit is a client tool, so the model's call ends the server's loop and the browser answers it. The call names
 * pieces, and the picker asks find_boutiques for them: Strapi refuses the whole call for a piece it doesn't know, which
 * would leave a form with no boutiques that Try again can't mend. So the server checks the pieces first, and refuses the
 * model's call with Strapi's words, so the model looks the piece up and calls again.
 *
 * The plan was to do that in a middleware's `onBeforeToolCall`. @tanstack/ai 0.68 never runs that hook for a client tool
 * (executeToolCalls in activities/chat/tools/tool-calls.js reaches the "no execute" branch and `continue`s before the
 * hook), so the first test pins that, and the check runs in `onToolPhaseComplete` instead (see visit-check.ts).
 */

const NOT_FOUND = refusal('not_found', 'No published product "weekender-5".', 'Call search_products to find valid product slugs.');
const BOUTIQUES = answer({ date: null, boutiques: [] });

type Fake = Awaited<ReturnType<typeof fakeStrapi>>;
const strapis: Fake[] = [];
afterEach(async () => {
  await Promise.all(strapis.splice(0).map((strapi) => strapi.close()));
  vi.restoreAllMocks();
});

/** The route's pieces for a turn: Strapi in memory, its MCP client, and the check. `find_boutiques` answers with `find`. */
const setup = async ({ find, tools }: { find?: Handler; tools?: string[] } = {}) => {
  const strapi = await fakeStrapi({ handlers: find ? { find_boutiques: find } : {}, tools });
  strapis.push(strapi);
  const mcp = await openMcp({ strapiUrl: 'http://strapi.test', authorization: 'Bearer x', createTransport: () => strapi.clientTransport });
  return { strapi, mcp, findCalls: () => strapi.calls.filter((call) => call.name === 'find_boutiques').map((call) => call.args) };
};

/** Runs the script on a real chat() with the picker, resolve_date and the check, the way the route will. */
const converse = async (steps: Step[], { find, tools, locale = 'en', timeoutMs, abort }: { find?: Handler; tools?: string[]; locale?: 'en' | 'ja'; timeoutMs?: number; abort?: AbortController } = {}) => {
  const { mcp, findCalls } = await setup({ find, tools });
  const model = scriptedModel(steps);
  const chunks: StreamChunk[] = [];
  for await (const chunk of chat({
    adapter: model.adapter as never,
    messages: [{ role: 'user', content: 'Can we schedule one?' }],
    tools: [resolveDateTool(locale, new Date('2026-10-07T03:00:00Z')), chooseVisitTool],
    agentLoopStrategy: maxIterations(8),
    middleware: [chooseVisitCheck({ client: mcp.client, locale, ...(timeoutMs ? { timeoutMs } : {}) })],
    ...(abort ? { abortController: abort } : {}),
    debug: false,
  }) as AsyncIterable<StreamChunk>)
    chunks.push(chunk);
  const results = chunks.filter((chunk) => chunk.type === EventType.TOOL_CALL_RESULT) as unknown as Array<{ toolCallId: string; content: string; metadata?: { tanstack?: { state?: string } } }>;
  const waiting = chunks.find((chunk) => chunk.type === EventType.RUN_FINISHED && (chunk as { outcome?: { type?: string } }).outcome?.type === 'interrupt') as unknown as
    | { outcome: { interrupts: Array<{ toolCallId: string }> } }
    | undefined;
  return { model, chunks, results, waiting, findCalls };
};

const call = (id: string, productSlugs: string[], more: Record<string, unknown> = {}): Step => ({ calls: [{ id, name: CHOOSE_VISIT, input: { productSlugs, ...more } }] });

describe('the hook the plan named', () => {
  it('onBeforeToolCall runs for a server tool but not for a client tool, in @tanstack/ai 0.68', async () => {
    const seen: string[] = [];
    const order: string[] = [];
    const model = scriptedModel([
      {
        calls: [
          { id: 'c1', name: 'resolve_date', input: { relative: 'tomorrow' } },
          { id: 'c2', name: CHOOSE_VISIT, input: { productSlugs: ['weekender-50'] } },
        ],
      },
    ]);
    for await (const chunk of chat({
      adapter: model.adapter as never,
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [resolveDateTool('en', new Date('2026-10-07T03:00:00Z')), chooseVisitTool],
      middleware: [
        {
          name: 'probe',
          onBeforeToolCall: (_ctx, hook) => {
            seen.push(hook.toolName);
          },
          onToolPhaseComplete: (_ctx, info) => {
            order.push(`phase: ${info.needsClientExecution.map((pending) => pending.toolName).join(',')}`);
          },
        },
      ],
      debug: false,
    }) as AsyncIterable<StreamChunk>) {
      if (chunk.type === EventType.RUN_FINISHED && (chunk as { outcome?: { type?: string } }).outcome?.type === 'interrupt') order.push('the browser is asked');
    }
    expect(seen).toEqual(['resolve_date']);
    // What does run for the pending client call, before the browser is asked to answer it.
    expect(order).toEqual([`phase: ${CHOOSE_VISIT}`, 'the browser is asked']);
  });
});

describe('chooseVisitCheck', () => {
  it("refuses a call that names a piece Strapi doesn't know, with Strapi's own words: the model reads them, looks it up and calls again, and no picker waits for it", async () => {
    const { model, results, waiting, findCalls } = await converse([call('call-1', ['weekender-5'], { boutique: 'ginza' }), { words: 'Let me check that piece.' }], { find: () => NOT_FOUND });
    expect(findCalls()).toEqual([{ productSlugs: ['weekender-5'], locale: 'en' }]);
    expect(waiting).toBeUndefined();
    expect(results).toHaveLength(1);
    expect(results[0].toolCallId).toBe('call-1');
    expect(results[0].metadata?.tanstack?.state).toBe('output-error');
    expect(JSON.parse(results[0].content)).toEqual({ error: 'No published product "weekender-5". Call search_products to find valid product slugs.' });
    // The model is called again and is shown the error.
    expect(model.modelCalls()).toBe(2);
    expect(JSON.stringify(model.requests[1].messages)).toContain('No published product \\"weekender-5\\". Call search_products to find valid product slugs.');
  });

  it('then shows the picker for the call the model makes with the right slug', async () => {
    const find: Handler = (args) => ((args.productSlugs as string[]).includes('weekender-5') ? NOT_FOUND : BOUTIQUES);
    const { model, results, waiting, findCalls } = await converse([call('call-1', ['weekender-5']), call('call-2', ['weekender-50'])], { find });
    expect(findCalls()).toEqual([
      { productSlugs: ['weekender-5'], locale: 'en' },
      { productSlugs: ['weekender-50'], locale: 'en' },
    ]);
    expect(results.map((result) => result.toolCallId)).toEqual(['call-1']);
    expect(waiting?.outcome.interrupts.map((interrupt) => interrupt.toolCallId)).toEqual(['call-2']);
    expect(model.modelCalls()).toBe(2);
  });

  it('shows the picker when Strapi knows every piece: one find_boutiques call for them, in the chat language', async () => {
    const { model, results, waiting, findCalls } = await converse([call('call-1', ['weekender-50', 'cabin-case-55'])], { find: () => BOUTIQUES, locale: 'ja' });
    expect(findCalls()).toEqual([{ productSlugs: ['weekender-50', 'cabin-case-55'], locale: 'ja' }]);
    expect(waiting?.outcome.interrupts.map((interrupt) => interrupt.toolCallId)).toEqual(['call-1']);
    expect(results).toEqual([]);
    expect(model.modelCalls()).toBe(1);
  });

  it('asks Strapi nothing for input the schema refuses already', async () => {
    for (const input of [{ productSlugs: ['Weekender 50'] }, { productSlugs: ['weekender-50'], note: 'For my father.' }, { productSlugs: ['weekender-50'], time: '2 pm' }]) {
      const { results, findCalls } = await converse([{ calls: [{ id: 'call-1', name: CHOOSE_VISIT, input }] }, { words: 'Sorry.' }], { find: () => NOT_FOUND });
      expect(results[0].metadata?.tanstack?.state, JSON.stringify(input)).toBe('output-error');
      expect(findCalls(), JSON.stringify(input)).toEqual([]);
    }
  });

  // Anything but not_found can't be put right by the model: the form then shows its own error, with Try again.
  it('shows the picker when the check fails otherwise: Strapi refuses for another reason, the call breaks or hangs, or the token has no find_boutiques', async () => {
    const hangs: Handler = (_args, { signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(answer({}))));
    const cases: Array<[string, { find?: Handler; tools?: string[] }]> = [
      ['not signed in', { find: () => refusal('not_signed_in', 'No signed-in LINE customer is attached to this session.', 'Sign in again.') }],
      ['plain text', { find: () => ({ isError: true, content: [{ type: 'text', text: 'Internal error' }] }) }],
      [
        'breaks',
        {
          find: () => {
            throw new TypeError('fetch failed');
          },
        },
      ],
      ['hangs', { find: hangs }],
      ['no find_boutiques', { tools: ['search_products'] }],
    ];
    for (const [name, options] of cases) {
      const { model, results, waiting } = await converse([call('call-1', ['weekender-50'])], { ...options, timeoutMs: 30 });
      expect(waiting?.outcome.interrupts.map((interrupt) => interrupt.toolCallId), name).toEqual(['call-1']);
      expect(results, name).toEqual([]);
      expect(model.modelCalls(), name).toBe(1);
    }
  });

  it('gives the check five seconds by default', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await converse([call('call-1', ['weekender-50'])], { find: () => BOUTIQUES });
    expect(timeout).toHaveBeenCalledWith(5000);
  });

  it("gives the check the run's abort signal, so a customer who closes the chat cuts it short", async () => {
    const abort = new AbortController();
    let seen: AbortSignal | undefined;
    const find: Handler = (_args, { signal }) => {
      seen = signal;
      abort.abort(); // the customer closes the chat while Strapi is working
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve(NOT_FOUND)));
    };
    const { results } = await converse([call('call-1', ['weekender-5'])], { find, abort }).catch(() => ({ results: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen?.aborted).toBe(true);
    expect(results).toEqual([]);
  });

  it('refuses only the call that names an unknown piece when the model calls choose_visit twice in one step', async () => {
    const find: Handler = (args) => ((args.productSlugs as string[]).includes('nope') ? NOT_FOUND : BOUTIQUES);
    const steps: Step[] = [
      {
        calls: [
          { id: 'call-1', name: CHOOSE_VISIT, input: { productSlugs: ['nope'] } },
          { id: 'call-2', name: CHOOSE_VISIT, input: { productSlugs: ['weekender-50'] } },
        ],
      },
    ];
    const { results, waiting } = await converse(steps, { find });
    expect(results.map((result) => result.toolCallId)).toEqual(['call-1']);
    expect(waiting?.outcome.interrupts.map((interrupt) => interrupt.toolCallId)).toEqual(['call-2']);
  });

  it("leaves other tools' calls alone: a resolve_date call in the same step runs as it always does", async () => {
    const steps: Step[] = [
      {
        calls: [
          { id: 'call-1', name: 'resolve_date', input: { weekday: 'saturday' } },
          { id: 'call-2', name: CHOOSE_VISIT, input: { productSlugs: ['weekender-50'], date: '2026-10-10' } },
        ],
      },
    ];
    const { results, waiting, findCalls } = await converse(steps, { find: () => BOUTIQUES });
    expect(results.map((result) => result.toolCallId)).toEqual(['call-1']);
    expect(JSON.parse(results[0].content)).toEqual({ date: '2026-10-10', weekday: 'Saturday', isPast: false });
    expect(waiting?.outcome.interrupts.map((interrupt) => interrupt.toolCallId)).toEqual(['call-2']);
    expect(findCalls()).toHaveLength(1);
  });
});

describe('a refused call, on the real ChatClient', () => {
  type CallPart = Extract<UIMessage['parts'][number], { type: 'tool-call' }>;
  const connectionTo = async (steps: Step[], find: Handler) => {
    const { mcp } = await setup({ find });
    const model = scriptedModel(steps);
    const requests: UIMessage[][] = [];
    const connection: ConnectionAdapter = {
      connect: (messages, _data, abortSignal, runContext) => {
        requests.push(structuredClone(messages as UIMessage[]));
        if (requests.length > 4) throw new Error('Stopped after four requests.');
        const abortController = new AbortController();
        abortSignal?.addEventListener('abort', () => abortController.abort());
        return chat({
          adapter: model.adapter as never,
          messages: messages as never,
          tools: [chooseVisitTool],
          agentLoopStrategy: maxIterations(8),
          middleware: [chooseVisitCheck({ client: mcp.client, locale: 'en' })],
          threadId: runContext?.threadId,
          runId: runContext?.runId,
          abortController,
        }) as AsyncIterable<StreamChunk>;
      },
    };
    return { connection, requests, model };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
  const callsOf = (client: ChatClient) => client.getMessages().flatMap((message) => message.parts).filter((part): part is CallPart => part.type === 'tool-call' && part.name === CHOOSE_VISIT);

  it('never shows a picker for it: the call ends in an error, no picker waits, and the chat sends nothing more', async () => {
    const { connection, requests, model } = await connectionTo([call('call-1', ['weekender-5']), { words: 'I could not find that piece.' }], () => NOT_FOUND);
    const client = new ChatClient({ connection });
    await client.sendMessage('Can we schedule one?');
    await settle();
    const [refused] = callsOf(client);
    expect(refused).toMatchObject({ id: 'call-1', state: 'error' });
    expect(refused.output).toEqual({ error: 'No published product "weekender-5". Call search_products to find valid product slugs.' });
    expect(livePickerOf(client.getMessages() as UIMessage[])).toBeNull();
    expect(pickerViewOf(refused, { live: false, busy: false })).toEqual({ kind: 'none' });
    expect(model.modelCalls()).toBe(2);
    expect(requests).toHaveLength(1);
    expect(client.getIsLoading()).toBe(false);
    expect(client.getMessages().flatMap((message) => message.parts).some((part) => part.type === 'text' && part.content === 'I could not find that piece.')).toBe(true);
  });

  it('shows the picker for the corrected call, and only that one', async () => {
    const find: Handler = (args) => ((args.productSlugs as string[]).includes('weekender-5') ? NOT_FOUND : BOUTIQUES);
    const { connection, requests } = await connectionTo([call('call-1', ['weekender-5']), call('call-2', ['weekender-50'])], find);
    const client = new ChatClient({ connection });
    await client.sendMessage('Can we schedule one?');
    await settle();
    const [refused, corrected] = callsOf(client);
    expect(refused).toMatchObject({ id: 'call-1', state: 'error' });
    expect(corrected).toMatchObject({ id: 'call-2', state: 'input-complete', input: { productSlugs: ['weekender-50'] } });
    expect(corrected.output).toBeUndefined();
    expect(livePickerOf(client.getMessages() as UIMessage[])).toBe('call-2');
    expect(pickerViewOf(corrected, { live: true, busy: false })).toEqual({ kind: 'form', canSend: true });
    expect(requests).toHaveLength(1);
  });
});
