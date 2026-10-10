import { EventType, chat, maxIterations, toolDefinition, type StreamChunk, type UIMessage } from '@tanstack/ai';
import { ChatClient, type ConnectionAdapter } from '@tanstack/ai-client';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CHOOSE_VISIT, livePickerOf, pickerViewOf } from './visit-picker';

/**
 * The visit picker answers its call once, and the concierge goes on once. The original needed its own predicates for this
 * (resumesAfterPicker and resumesOncePerAnswer), because the AI SDK asked "may I send again?" after every reply and an empty
 * reply made it send the same answer again and again. @tanstack/ai-client continues by itself, and only when a tool
 * result is added (ChatClient.addToolResult), once. These tests hold that, against the real ChatClient and the real
 * server-side chat(), with a scripted model in place of Claude. Nothing here calls a provider.
 */

const appointment = {
  reference: 'APT-0042',
  status: 'requested',
  boutique: { slug: 'ginza', name: 'Ginza Flagship' },
  requestedFor: '2026-10-10T14:00:00+09:00',
  products: [{ slug: 'weekender-50', name: 'Weekender 50' }],
  note: '',
  confirmationSent: false,
};

/** What the model does in one call: words, tool calls, or nothing. */
type Step = { words?: string; calls?: Array<{ id: string; name: string; input: unknown }> };

/** A text adapter that plays `steps`, one for each model call, as Claude's adapter would stream them. */
const scriptedModel = (steps: Step[]) => {
  let index = 0;
  const messagesSeen: unknown[] = [];
  const adapter = {
    kind: 'text',
    name: 'scripted',
    model: 'scripted-model',
    '~types': {},
    async *chatStream(options: { runId?: string; threadId?: string; messages: unknown[] }): AsyncIterable<StreamChunk> {
      messagesSeen.push(options.messages);
      const step = steps[index++] ?? {};
      const runId = options.runId ?? `run-${index}`;
      const threadId = options.threadId ?? 'thread-1';
      yield { type: EventType.RUN_STARTED, runId, threadId, timestamp: Date.now() } as StreamChunk;
      if (step.words) {
        const messageId = `message-${index}`;
        yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant', timestamp: Date.now() } as StreamChunk;
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: step.words, timestamp: Date.now() } as StreamChunk;
        yield { type: EventType.TEXT_MESSAGE_END, messageId, timestamp: Date.now() } as StreamChunk;
      }
      for (const [place, { id, name, input }] of (step.calls ?? []).entries()) {
        const args = JSON.stringify(input);
        yield { type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: name, toolName: name, index: place, timestamp: Date.now() } as StreamChunk;
        yield { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: args, args, timestamp: Date.now() } as StreamChunk;
        yield { type: EventType.TOOL_CALL_END, toolCallId: id, toolCallName: name, toolName: name, input, timestamp: Date.now() } as StreamChunk;
      }
      yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: step.calls?.length ? 'tool_calls' : 'stop', timestamp: Date.now() } as StreamChunk;
    },
    structuredOutput: async () => {
      throw new Error('Not used.');
    },
  };
  return { adapter, messagesSeen, modelCalls: () => index };
};

/** A Maison tool the server runs itself, as the MCP wrapper's tools are. */
const searchProducts = toolDefinition({ name: 'search_products', description: 'Searches the catalog.', inputSchema: z.object({ query: z.string() }) }).server(async () => ({
  content: [],
  structuredContent: { products: [{ slug: 'weekender-50', name: 'Weekender 50' }] },
}));
/** choose_visit as the browser knows it, and as the server knows it: a client tool, with no code to run on the server. */
const chooseVisitDefinition = toolDefinition({
  name: CHOOSE_VISIT,
  description: 'Shows the customer the visit picker.',
  inputSchema: z.object({ productSlugs: z.array(z.string()) }),
});
const chooseVisitOnServer = chooseVisitDefinition.client();
const chooseVisitInBrowser = chooseVisitDefinition.client();

/**
 * A connection with the real server-side chat() behind it, in place of fetchServerSentEvents and /api/concierge: each
 * request the ChatClient makes runs one turn of the scripted model. Counts the requests, and keeps the messages each sent.
 */
const connectionTo = (model: ReturnType<typeof scriptedModel>, { echoIds = true }: { echoIds?: boolean } = {}) => {
  const requests: UIMessage[][] = [];
  const connection: ConnectionAdapter = {
    connect: (messages, _data, abortSignal, runContext) => {
      requests.push(structuredClone(messages as UIMessage[]));
      if (requests.length > 6) throw new Error('Stopped after six requests: the chat is sending again and again.');
      const abortController = new AbortController();
      abortSignal?.addEventListener('abort', () => abortController.abort());
      return chat({
        adapter: model.adapter as never,
        messages: messages as never,
        tools: [searchProducts, chooseVisitOnServer],
        agentLoopStrategy: maxIterations(8),
        ...(echoIds ? { threadId: runContext?.threadId, runId: runContext?.runId } : {}),
        abortController,
      }) as AsyncIterable<StreamChunk>;
    },
  };
  return { connection, requests };
};

/** Gives the chat time to send again, if it were going to. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

type CallPart = Extract<UIMessage['parts'][number], { type: 'tool-call' }>;
/** The chat's messages, as the base UIMessage type: the client types them by the tools it was given. */
const messagesOf = (client: ChatClient): UIMessage[] => client.getMessages() as UIMessage[];
/** The picker's call, wherever it is in the conversation. */
const pickerOf = (client: ChatClient) =>
  client
    .getMessages()
    .flatMap((message) => message.parts)
    .find((part): part is CallPart => part.type === 'tool-call' && part.name === CHOOSE_VISIT);

/** A turn that ends at the picker: the model writes a few words and calls choose_visit. */
const picking = { words: 'Here is the picker.', calls: [{ id: 'call-picker', name: CHOOSE_VISIT, input: { productSlugs: ['weekender-50'] } }] };

describe('the chat after a visit picker is answered', () => {
  const answers = [
    ['requested', { status: 'requested', appointment }],
    ['closed', { status: 'closed' }],
  ] as const;

  for (const [name, answer] of answers) {
    it(`sends exactly one follow-up request for the answer (${name}), and none after the reply that follows it`, async () => {
      const model = scriptedModel([picking, { words: name === 'requested' ? 'Your visit is requested.' : 'Happy to help.' }]);
      const { connection, requests } = connectionTo(model);
      const client = new ChatClient({ connection, tools: [chooseVisitInBrowser] });

      await client.sendMessage('Can we schedule one?');
      await settle();
      // The turn ended at the picker: the call waits for the customer, and the chat has sent nothing more.
      expect(requests).toHaveLength(1);
      const waiting = pickerOf(client);
      expect(waiting).toMatchObject({ id: 'call-picker', state: 'input-complete', input: { productSlugs: ['weekender-50'] } });
      expect(waiting?.output).toBeUndefined();
      expect(livePickerOf(messagesOf(client))).toBe('call-picker');
      expect(pickerViewOf(waiting!, { live: true, busy: false })).toEqual({ kind: 'form', canSend: true });

      await client.addToolResult({ tool: CHOOSE_VISIT, toolCallId: 'call-picker', output: answer });
      await settle();

      // One answer, one follow-up request. It carries the answer, and the model's reply ended the message: no more.
      expect(requests).toHaveLength(2);
      expect(model.modelCalls()).toBe(2);
      const answered = pickerOf(client);
      expect(answered).toMatchObject({ state: 'complete', output: answer });
      // The reply after the answer is a new message, under the one that holds the picker: the picker is no longer the newest.
      const [, asked, reply] = messagesOf(client);
      expect(messagesOf(client)).toHaveLength(3);
      expect(reply.id).not.toBe(asked.id);
      expect(reply).toMatchObject({ role: 'assistant', parts: [{ type: 'text', content: name === 'requested' ? 'Your visit is requested.' : 'Happy to help.' }] });
      expect(livePickerOf(messagesOf(client))).toBeNull();
      expect(pickerViewOf(answered!, { live: false, busy: false })).toEqual(name === 'requested' ? { kind: 'requested', appointment } : { kind: 'closed' });
      expect(client.getIsLoading()).toBe(false);
      const lastRequest = requests[1].at(-1);
      expect(lastRequest?.role).toBe('assistant');
      expect(lastRequest?.parts.find((part) => part.type === 'tool-call' && part.name === CHOOSE_VISIT)).toMatchObject({ output: answer });
    });
  }

  it('sends exactly one follow-up request when the model answers the picker with nothing at all, and never in a loop', async () => {
    // The original's hazard: an empty reply left the message as it was, so an "again?" check after every reply resent the same answer.
    const model = scriptedModel([picking, {}]);
    const { connection, requests } = connectionTo(model);
    const client = new ChatClient({ connection, tools: [chooseVisitInBrowser] });
    await client.sendMessage('Can we schedule one?');
    await client.addToolResult({ tool: CHOOSE_VISIT, toolCallId: 'call-picker', output: { status: 'requested', appointment } });
    await settle();
    await settle();
    expect(requests).toHaveLength(2);
    expect(model.modelCalls()).toBe(2);
    expect(client.getIsLoading()).toBe(false);
    // An empty reply makes no message: the picker stays the newest, answered, and the composer is free.
    expect(messagesOf(client)).toHaveLength(2);
    expect(pickerViewOf(pickerOf(client)!, { live: livePickerOf(messagesOf(client)) === 'call-picker', busy: client.getIsLoading() })).toEqual({ kind: 'requested', appointment });
  });

  it('sends one follow-up request when choose_visit is called beside a server tool in the same turn', async () => {
    const model = scriptedModel([
      {
        words: 'Let me look.',
        calls: [
          { id: 'call-search', name: 'search_products', input: { query: 'weekender' } },
          { id: 'call-picker', name: CHOOSE_VISIT, input: { productSlugs: ['weekender-50'] } },
        ],
      },
      { words: 'Your visit is requested.' },
    ]);
    const { connection, requests } = connectionTo(model);
    const client = new ChatClient({ connection, tools: [chooseVisitInBrowser] });
    await client.sendMessage('Can we schedule one?');
    await settle();
    expect(requests).toHaveLength(1);
    const calls = messagesOf(client).flatMap((message) => message.parts).filter((part): part is CallPart => part.type === 'tool-call');
    expect(calls.find((part) => part.name === 'search_products')).toMatchObject({ state: 'complete' });
    await client.addToolResult({ tool: CHOOSE_VISIT, toolCallId: 'call-picker', output: { status: 'closed' } });
    await settle();
    expect(requests).toHaveLength(2);
  });

  it('sends one follow-up request for each picker, when the customer asks again after the first answer', async () => {
    const second = { words: 'Here is another.', calls: [{ id: 'call-picker-2', name: CHOOSE_VISIT, input: { productSlugs: ['cabin-case-55'] } }] };
    const model = scriptedModel([picking, { words: 'Not now, then.' }, second, { words: 'Done.' }]);
    const { connection, requests } = connectionTo(model);
    const client = new ChatClient({ connection, tools: [chooseVisitInBrowser] });
    await client.sendMessage('Can we schedule one?');
    await client.addToolResult({ tool: CHOOSE_VISIT, toolCallId: 'call-picker', output: { status: 'closed' } });
    await settle();
    expect(requests).toHaveLength(2);
    await client.sendMessage('And one for the cabin case?');
    await settle();
    expect(requests).toHaveLength(3);
    await client.addToolResult({ tool: CHOOSE_VISIT, toolCallId: 'call-picker-2', output: { status: 'closed' } });
    await settle();
    expect(requests).toHaveLength(4);
  });
});

describe('the chat after a turn of server tools only', () => {
  it('sends no follow-up request: the server runs the tools and the reply comes in the same request', async () => {
    const model = scriptedModel([{ calls: [{ id: 'call-search', name: 'search_products', input: { query: 'weekender' } }] }, { words: 'Here are two pieces.' }]);
    const { connection, requests } = connectionTo(model);
    const client = new ChatClient({ connection, tools: [chooseVisitInBrowser] });

    await client.sendMessage('A travel gift?');
    await settle();
    await settle();

    expect(requests).toHaveLength(1);
    expect(model.modelCalls()).toBe(2); // the tool step and the reply, both inside the one request
    const reply = messagesOf(client).at(-1);
    expect(reply?.parts.find((part) => part.type === 'tool-call')).toMatchObject({ name: 'search_products', state: 'complete', output: { structuredContent: { products: [{ slug: 'weekender-50' }] } } });
    expect(reply?.parts.at(-1)).toMatchObject({ type: 'text', content: 'Here are two pieces.' });
    expect(client.getIsLoading()).toBe(false);
  });

  it('sends no follow-up request when the server tools end the turn with no words: Try again is the customer’s to press', async () => {
    const model = scriptedModel([{ calls: [{ id: 'call-search', name: 'search_products', input: { query: 'weekender' } }] }, {}]);
    const { connection, requests } = connectionTo(model);
    const client = new ChatClient({ connection, tools: [chooseVisitInBrowser] });
    await client.sendMessage('A travel gift?');
    await settle();
    await settle();
    expect(requests).toHaveLength(1);
    expect(client.getIsLoading()).toBe(false);
  });

  it('sends no follow-up request for a plain text reply', async () => {
    const model = scriptedModel([{ words: 'Good afternoon.' }]);
    const { connection, requests } = connectionTo(model);
    const client = new ChatClient({ connection, tools: [chooseVisitInBrowser] });
    await client.sendMessage('Hello');
    await settle();
    expect(requests).toHaveLength(1);
  });
});

// What the route (task 4B) must do. Found by trying it: a server that starts chat() without the request's own thread and run
// ids ends the turn in a way the client treats as an open interrupt, and the picker's answer is then not followed up.
describe("the route's part of the follow-up", () => {
  it("is not followed up when chat() runs without the request's threadId and runId, so the route must pass both", async () => {
    const { connection, requests } = connectionTo(scriptedModel([picking, { words: 'Your visit is requested.' }]), { echoIds: false });
    const client = new ChatClient({ connection, tools: [chooseVisitInBrowser] });
    await client.sendMessage('Can we schedule one?');
    await client.addToolResult({ tool: CHOOSE_VISIT, toolCallId: 'call-picker', output: { status: 'closed' } });
    await settle();
    expect(requests).toHaveLength(1);
  });
});

// A check that the waiting guard above is the chat's own, and not this file's connection: no continuation without a result.
describe('the guard against a loop', () => {
  it('never sends on its own while a picker waits, however long it waits', async () => {
    const model = scriptedModel([picking, { words: 'Never sent.' }]);
    const { connection, requests } = connectionTo(model);
    const send = vi.spyOn(connection, 'connect');
    const client = new ChatClient({ connection, tools: [chooseVisitInBrowser] });
    await client.sendMessage('Can we schedule one?');
    await settle();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(model.modelCalls()).toBe(1);
  });
});
