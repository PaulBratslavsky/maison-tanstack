import { EventType, uiMessagesToWire, type UIMessage } from '@tanstack/ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { vi } from 'vitest';

import type { ConciergeDeps } from './handle';
import type { ConciergeModel } from './model';
import { fakeStrapi, scriptedModel, type Step } from './test-support';

/**
 * What the route's tests share: a conversation as the browser sends it (TanStack AI's AG-UI wire shape), the request, the
 * server-sent events that come back, and one function that runs a turn through `handleConcierge` with Strapi in memory
 * and a scripted model. Nothing here calls a provider, Strapi or LINE. Not imported by the app.
 */

export const AUTHORIZATION = 'Bearer mcp_at_customer';
/** 10:00 in Tokyo on Wednesday 7 October 2026. */
export const NOW = new Date('2026-10-07T01:00:00Z');

type Part = UIMessage['parts'][number];

/** One of the customer's messages, as the browser holds it. */
export const say = (text: string, id = 'u1'): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', content: text }] });
/** One of the concierge's earlier replies, as the browser holds it. */
export const assistantSays = (text: string, id = 'a1'): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', content: text }] });
/** A tool call in a message: with an `output` it was answered. */
export const toolCall = (id: string, name: string, input: unknown, output?: unknown): Part =>
  ({ type: 'tool-call', id, name, arguments: JSON.stringify(input), input, state: output === undefined ? 'input-complete' : 'complete', ...(output === undefined ? {} : { output }) }) as Part;
/** A concierge message made of `parts`. */
export const assistantWith = (parts: Part[], id = 'a1'): UIMessage => ({ id, role: 'assistant', parts });

/** The body the browser sends: AG-UI's RunAgentInput, with the conversation as the wire carries it. */
export const chatBody = (messages: UIMessage[], { locale = 'en', product, threadId = 'thread-1', runId = 'run-1' }: { locale?: string; product?: unknown; threadId?: string; runId?: string } = {}) => ({
  threadId,
  runId,
  state: {},
  messages: uiMessagesToWire(messages),
  tools: [],
  context: [],
  forwardedProps: { locale, ...(product === undefined ? {} : { product }) },
});

export const request = (authorization: string | null, body: unknown, signal?: AbortSignal) =>
  new Request('http://localhost:3004/api/concierge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  });

/** The events of a server-sent event stream. */
// Untyped on purpose: a test reads an event by the field it looks for.
export const sseEvents = (text: string): any[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .map((data) => JSON.parse(data));

/** The words of a stream: every text delta, in order. */
export const wordsOf = (events: any[]) =>
  events
    .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
    .map((event) => event.delta)
    .join('');
/** The types of a stream's events, in order. */
export const typesOf = (events: any[]) => events.map((event) => event.type as string);

type Strapi = Awaited<ReturnType<typeof fakeStrapi>>;
const strapis: Strapi[] = [];
/** Closes the Strapi of every turn run so far. Each test file calls it in `afterEach`. */
export const cleanup = async () => {
  await Promise.all(strapis.splice(0).map((strapi) => strapi.close()));
  vi.restoreAllMocks();
};

/** A scripted model as the route takes it. `provider` says which adapter's rules apply (the extra pass forces a tool on Anthropic only). */
export const modelOf = (steps: Step[], provider: 'anthropic' | 'ollama' = 'anthropic') => {
  const scripted = scriptedModel(steps);
  const model = {
    provider,
    adapter: scripted.adapter,
    modelOptions: provider === 'ollama' ? { think: false } : undefined,
    label: 'the scripted model',
    fix: 'Start the scripted model.',
  } as unknown as ConciergeModel;
  return { ...scripted, model };
};

export interface Options {
  steps?: Step[];
  messages?: UIMessage[];
  /** A body of its own, in place of `messages`. */
  body?: unknown;
  locale?: string;
  product?: unknown;
  threadId?: string;
  runId?: string;
  authorization?: string | null;
  signal?: AbortSignal;
  provider?: 'anthropic' | 'ollama';
  strapi?: Parameters<typeof fakeStrapi>[0];
  deps?: Partial<ConciergeDeps>;
  /** Wraps the transport the route's MCP client gets, to make a call fail. */
  wrapTransport?: (transport: Transport) => Transport;
  /** A request of its own, in place of the one built from the body (a body that arrives in chunks, or says its own length). */
  build?: (authorization: string | null) => Request;
  /** False when the test reads the response itself. */
  read?: boolean;
}

/**
 * One turn through the route: Strapi in memory (its MCP client's transport), a scripted model, and the request. Returns
 * the response, its events once the stream has ended, and what the model, Strapi and the transport saw.
 */
export const converse = async ({
  steps = [{ words: 'Noted.' }],
  messages = [say('Hello')],
  body,
  locale,
  product,
  threadId,
  runId,
  authorization = AUTHORIZATION,
  signal,
  provider,
  strapi: strapiOptions,
  deps,
  wrapTransport,
  build,
  read = true,
}: Options = {}) => {
  const { handleConcierge } = await import('./handle');
  const strapi = await fakeStrapi(strapiOptions);
  strapis.push(strapi);
  // The route's own call to close its client: the in-memory transport closes itself twice, so its close is no count of that.
  const closed = vi.spyOn(Client.prototype, 'close');
  closed.mockClear(); // a test may run several turns, and the spy is one for all of them
  const model = modelOf(steps, provider);
  const connections: Array<{ url: string; headers: Record<string, string> }> = [];
  const response = await handleConcierge(build ? build(authorization) : request(authorization, body ?? chatBody(messages, { locale, product, threadId, runId }), signal), {
    model: model.model,
    strapiUrl: 'http://strapi.test',
    createTransport: (url, headers) => {
      connections.push({ url: url.href, headers });
      return wrapTransport ? wrapTransport(strapi.clientTransport) : strapi.clientTransport;
    },
    now: () => NOW,
    ...deps,
  });
  const events = read && response.status === 200 ? sseEvents(await response.text()) : [];
  return {
    response,
    events,
    model,
    strapi,
    connections,
    closed,
    /** What Strapi was asked to do, by tool. */
    callsTo: (name: string) => strapi.calls.filter((call) => call.name === name).map((call) => call.args),
  };
};
