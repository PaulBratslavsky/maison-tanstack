import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { EventType, chat, maxIterations, type AnyClientTool, type AnyServerTool, type StreamChunk, type UIMessage } from '@tanstack/ai';
import type { ConnectionAdapter } from '@tanstack/ai-client';
import { z } from 'zod';

/**
 * Helpers for the concierge's tests. Nothing here calls a provider or Strapi: the model is a script, and Strapi is an
 * MCP server in the same process. Not imported by the app.
 */

/**
 * What the model does in one call: words, tool calls, or nothing. `fail` ends the call with a RUN_ERROR as the adapters
 * do when the provider fails (after the words, if there are any). `throws` makes the adapter throw. `stall` sends the
 * words and then waits until the run is aborted, as a model that never finishes does. `pause` waits that many
 * milliseconds before the first event.
 */
export type Step = { words?: string; calls?: Array<{ id: string; name: string; input: unknown }>; fail?: string; throws?: string; stall?: boolean; pause?: number };

/** A text adapter that plays `steps`, one for each model call, as Claude's adapter would stream them. */
export const scriptedModel = (steps: Step[]) => {
  let index = 0;
  const requests: Array<{ messages: unknown[]; tools: Array<{ name: string }>; modelOptions: unknown; systemPrompts: unknown[] }> = [];
  const adapter = {
    kind: 'text',
    name: 'scripted',
    model: 'scripted-model',
    '~types': {},
    async *chatStream(options: {
      runId?: string;
      threadId?: string;
      messages: unknown[];
      tools?: Array<{ name: string }>;
      modelOptions?: unknown;
      systemPrompts?: unknown[];
      request?: { signal?: AbortSignal };
    }): AsyncIterable<StreamChunk> {
      requests.push({ messages: options.messages, tools: options.tools ?? [], modelOptions: options.modelOptions, systemPrompts: options.systemPrompts ?? [] });
      const step = steps[index++] ?? {};
      const runId = options.runId ?? `run-${index}`;
      const threadId = options.threadId ?? 'thread-1';
      if (step.pause) await new Promise((resolve) => setTimeout(resolve, step.pause));
      yield { type: EventType.RUN_STARTED, runId, threadId, timestamp: Date.now() } as StreamChunk;
      // As Anthropic's adapter does: the words and the calls of one model response share one message id.
      const messageId = `message-${index}`;
      if (step.words) {
        yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant', timestamp: Date.now() } as StreamChunk;
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: step.words, timestamp: Date.now() } as StreamChunk;
        yield { type: EventType.TEXT_MESSAGE_END, messageId, timestamp: Date.now() } as StreamChunk;
      }
      if (step.throws) throw new Error(step.throws);
      if (step.fail) {
        yield { type: EventType.RUN_ERROR, message: step.fail, code: 'provider_error', runId, threadId, timestamp: Date.now() } as StreamChunk;
        return;
      }
      if (step.stall) {
        const signal = options.request?.signal;
        await new Promise<void>((resolve) => (signal?.aborted ? resolve() : signal?.addEventListener('abort', () => resolve(), { once: true })));
        return;
      }
      for (const [place, { id, name, input }] of (step.calls ?? []).entries()) {
        const args = JSON.stringify(input);
        yield { type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: name, toolName: name, parentMessageId: messageId, index: place, timestamp: Date.now() } as StreamChunk;
        yield { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: args, args, timestamp: Date.now() } as StreamChunk;
        yield { type: EventType.TOOL_CALL_END, toolCallId: id, toolCallName: name, toolName: name, input, timestamp: Date.now() } as StreamChunk;
      }
      yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: step.calls?.length ? 'tool_calls' : 'stop', timestamp: Date.now() } as StreamChunk;
    },
    structuredOutput: async () => {
      throw new Error('Not used.');
    },
  };
  return { adapter, requests, modelCalls: () => index };
};

/** A Maison tool's answer: its data as text and as structured content, as Strapi's tools give it. */
export const answer = (data: Record<string, unknown>): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });

/** A Maison tool's refusal: `{ error: { code, message, hint } }` as text, with isError, as Strapi's tools give it. */
export const refusal = (code: string, message: string, hint = ''): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: { code, message, hint } }) }],
  isError: true,
});

type Args = Record<string, unknown>;
export type Handler = (args: Args, extra: { signal: AbortSignal }) => CallToolResult | Promise<CallToolResult>;

const locale = z.enum(['ja', 'en']).optional();

/** The tools of a customer's session, with the input schemas Strapi gives them (the ones the concierge reads are exact). */
const SCHEMAS: Record<string, z.ZodRawShape> = {
  browse_collections: { locale },
  search_products: { query: z.string().optional(), locale },
  view_product: { slug: z.string(), locale },
  find_boutiques: { productSlugs: z.array(z.string()).optional(), date: z.string().optional(), locale },
  search_knowledge: { query: z.string(), productSlugs: z.array(z.string()).optional(), locale },
  my_appointments: { locale },
  hand_off_to_staff: { question: z.string(), reason: z.enum(['no_answer', 'asked_for_person']), productSlug: z.string().optional(), locale },
  request_appointment: { boutique: z.string(), productSlugs: z.array(z.string()), requestedFor: z.string(), locale },
  log_inquiry: {
    message: z.string(),
    reply: z.string(),
    knowledgeFound: z.boolean(),
    handedOff: z.boolean(),
    questionReference: z.string().optional(),
    productSlug: z.string().optional(),
    locale,
  },
};

/**
 * Strapi's MCP server for a test, in memory. `handlers` answer by tool name: a tool with none answers `{}`. `calls` keeps
 * each call's tool and arguments in order. `tools` limits which tools are registered (all of a customer's by default); a name with no schema here is registered with no input.
 */
export const fakeStrapi = async ({ handlers = {}, tools = Object.keys(SCHEMAS) }: { handlers?: Record<string, Handler>; tools?: string[] } = {}) => {
  const server = new McpServer({ name: 'fake-strapi', version: '1.0.0' });
  const calls: Array<{ name: string; args: Args }> = [];
  for (const name of tools) {
    server.registerTool(name, { description: `The ${name} tool.`, inputSchema: SCHEMAS[name] ?? {} }, async (args: Args, extra) => {
      calls.push({ name, args });
      return (await handlers[name]?.(args, { signal: extra.signal })) ?? answer({});
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return { server, clientTransport, calls, close: () => server.close() };
};

/** What `chat()` gives a tool's execute function, for a test that calls one by hand. */
export const toolContext = (abortSignal?: AbortSignal) => ({ toolCallId: 'test-call', abortSignal, emitCustomEvent: () => {} });

/**
 * A chat page's connection with the real server-side `chat()` behind it, in place of `fetchServerSentEvents` and
 * `/api/concierge`: each request the page makes runs one turn of the scripted model, with `tools` as the route's tools
 * (server tools run here; a client tool such as choose_visit ends the turn). `requests` keeps the messages each request
 * carried. It stops a chat that sends again and again, after `limit` requests. The route's own rules (the extra pass,
 * the log) are not here: handleConcierge has its own tests.
 */
export const chatConnection = (model: ReturnType<typeof scriptedModel>, tools: Array<AnyServerTool | AnyClientTool>, { limit = 8 }: { limit?: number } = {}) => {
  const requests: UIMessage[][] = [];
  const connection: ConnectionAdapter = {
    connect: (messages, _data, abortSignal, runContext) => {
      requests.push(structuredClone(messages as UIMessage[]));
      if (requests.length > limit) throw new Error(`Stopped after ${limit} requests: the chat is sending again and again.`);
      const abortController = new AbortController();
      abortSignal?.addEventListener('abort', () => abortController.abort());
      return chat({
        adapter: model.adapter as never,
        messages: messages as never,
        tools,
        agentLoopStrategy: maxIterations(8),
        threadId: runContext?.threadId,
        runId: runContext?.runId,
        abortController,
      }) as AsyncIterable<StreamChunk>;
    },
  };
  return { connection, requests };
};
