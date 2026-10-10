import { EventType, chatParamsFromRequestBody } from '@tanstack/ai';
import { ChatClient } from '@tanstack/ai-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanup, modelOf } from './concierge/handle-support';
import { fakeStrapi } from './concierge/test-support';
import { conciergeConnection } from './chat-connection';
import type { Locale } from './types';

/**
 * The chat page's connection: where the customer's session token, the language and the piece are read, and how they reach
 * the route. They are read when a message is sent, so a language switch or a new piece applies to the next send.
 * Nothing here calls a provider.
 */

afterEach(cleanup);

/** A response that ends a run at once: a reply of no words. */
const emptyReply = (body: { threadId: string; runId: string }) => {
  const events = [
    { type: EventType.RUN_STARTED, threadId: body.threadId, runId: body.runId, timestamp: 1 },
    { type: EventType.RUN_FINISHED, threadId: body.threadId, runId: body.runId, finishReason: 'stop', timestamp: 2 },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
};

const setup = ({ extraHeaders }: { extraHeaders?: () => Record<string, string> } = {}) => {
  const sent: Array<{ headers: Headers; body: { threadId: string; runId: string; forwardedProps: Record<string, unknown> } }> = [];
  const settings: { locale: Locale; product: string | null } = { locale: 'en', product: null };
  let tokens = 0;
  const fetchClient = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({ headers: new Headers(init?.headers), body });
    return emptyReply(body);
  };
  const connection = conciergeConnection({
    url: 'http://localhost:3004/api/concierge',
    getToken: async () => `token-${++tokens}`,
    extraHeaders,
    read: () => settings,
    fetchClient: fetchClient as typeof fetch,
  });
  const client = new ChatClient({ connection });
  return { client, sent, settings };
};

describe('conciergeConnection', () => {
  it("sends the customer's session token as a Bearer header, a fresh one for each send", async () => {
    const { client, sent } = setup();
    await client.sendMessage('First');
    await client.sendMessage('Second');
    expect(sent.map((request) => request.headers.get('authorization'))).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it("sends the tunnel's headers too, when there are any", async () => {
    const { client, sent } = setup({ extraHeaders: () => ({ 'ngrok-skip-browser-warning': '1' }) });
    await client.sendMessage('Hello');
    expect(sent[0].headers.get('ngrok-skip-browser-warning')).toBe('1');
  });

  it('puts the language and the piece in the request as forwardedProps, which is where the route reads them', async () => {
    const { client, sent, settings } = setup();
    settings.locale = 'ja';
    settings.product = 'weekender-50';
    await client.sendMessage('Hello');
    expect(sent[0].body.forwardedProps).toEqual({ locale: 'ja', product: 'weekender-50' });
    // The route's own reader, from TanStack AI: the props come out as the route gets them.
    const params = await chatParamsFromRequestBody(sent[0].body);
    expect(params.forwardedProps).toEqual({ locale: 'ja', product: 'weekender-50' });
  });

  it('sends no piece when there is none', async () => {
    const { client, sent } = setup();
    await client.sendMessage('Hello');
    expect(sent[0].body.forwardedProps).toEqual({ locale: 'en' });
  });

  it('reads the language and the piece when a message is sent, so a switch applies to the next send', async () => {
    const { client, sent, settings } = setup();
    await client.sendMessage('First');
    settings.locale = 'ja';
    settings.product = 'cabin-case-55';
    await client.sendMessage('Second');
    expect(sent.map((request) => request.body.forwardedProps)).toEqual([{ locale: 'en' }, { locale: 'ja', product: 'cabin-case-55' }]);
  });

  it("reaches handleConcierge: the route's instructions are in the page's language and name the piece", async () => {
    const { handleConcierge } = await import('./concierge/handle');
    const strapi = await fakeStrapi();
    const scripted = modelOf([{ words: 'Noted.' }]);
    const settings: { locale: Locale; product: string | null } = { locale: 'ja', product: 'weekender-50' };
    const connection = conciergeConnection({
      url: 'http://localhost:3004/api/concierge',
      getToken: async () => 'mcp_at_customer',
      read: () => settings,
      fetchClient: (async (input: unknown, init?: RequestInit) =>
        handleConcierge(new Request(String(input), init), { model: scripted.model, strapiUrl: 'http://strapi.test', createTransport: () => strapi.clientTransport })) as typeof fetch,
    });
    const client = new ChatClient({ connection });
    await client.sendMessage('Hello');
    expect(client.getError()).toBeUndefined();
    const prompt = JSON.stringify(scripted.requests[0].systemPrompts);
    expect(prompt).toContain('weekender-50');
    expect(prompt).toMatch(/[ぁ-んァ-ン]/); // Japanese words in the instructions
    await strapi.close();
  });
});
