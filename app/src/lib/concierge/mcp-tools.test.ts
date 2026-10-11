import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { EventType, chat, maxIterations, type StreamChunk } from '@tanstack/ai';
import { afterEach, describe, expect, it } from 'vitest';

import { CUSTOMER_TOOLS, openMcp } from './mcp-tools';
import { SURFACE_HEADER } from './instructions';
import { answer, fakeStrapi, refusal, scriptedModel, toolContext } from './test-support';

const AUTHORIZATION = 'Bearer mcp_at_customer-token';

const open: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((item) => item.close()));
});

/** What a call's result came to, as the stream carries it (a TOOL_CALL_RESULT holds the whole result as JSON text). */
const resultOf = (chunks: StreamChunk[], id: string) => {
  const chunk = chunks.find((candidate) => candidate.type === EventType.TOOL_CALL_RESULT && (candidate as { toolCallId?: string }).toolCallId === id) as { content: string } | undefined;
  return chunk ? JSON.parse(chunk.content) : undefined;
};

/** A session with the fake Strapi, as the route opens it. `headersSeen` is what the transport was asked to send. */
const session = async (options: Parameters<typeof fakeStrapi>[0] = {}) => {
  const strapi = await fakeStrapi(options);
  const asked: Array<{ url: string; headers: Record<string, string> }> = [];
  const mcp = await openMcp({
    strapiUrl: 'http://strapi.test',
    authorization: AUTHORIZATION,
    createTransport: (url, headers) => {
      asked.push({ url: url.href, headers });
      return strapi.clientTransport;
    },
  });
  open.push(mcp, strapi);
  return { ...strapi, mcp, asked };
};

describe('openMcp', () => {
  it("connects to Strapi's /mcp with the customer's own header and the surface header, and no other credential", async () => {
    const { asked } = await session();
    expect(asked).toEqual([{ url: 'http://strapi.test/mcp', headers: { Authorization: AUTHORIZATION, [SURFACE_HEADER]: 'concierge' } }]);
    expect(SURFACE_HEADER).toBe('x-maison-surface');
  });

  it('passes the same headers over HTTP, whatever the header looks like', async () => {
    const seen: Array<Record<string, string | string[] | undefined>> = [];
    const server = createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(500).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(openMcp({ strapiUrl: `http://127.0.0.1:${port}`, authorization: 'Bearer mcp_at_odd header' })).rejects.toThrow();
    } finally {
      server.close();
    }
    expect(seen[0]).toMatchObject({ authorization: 'Bearer mcp_at_odd header', 'x-maison-surface': 'concierge' });
  });

  it('reaches /mcp once when STRAPI_URL ends with a slash', async () => {
    const strapi = await fakeStrapi();
    const asked: string[] = [];
    const mcp = await openMcp({ strapiUrl: 'http://strapi.test/', authorization: AUTHORIZATION, createTransport: (url) => (asked.push(url.href), strapi.clientTransport) });
    open.push(mcp, strapi);
    expect(asked).toEqual(['http://strapi.test/mcp']);
  });

  it('rejects when Strapi cannot be reached, with its message', async () => {
    const strapi = await fakeStrapi();
    open.push(strapi);
    await expect(
      openMcp({
        strapiUrl: 'http://strapi.test',
        authorization: AUTHORIZATION,
        createTransport: () => ({
          start: async () => {
            throw new Error('connect ECONNREFUSED 127.0.0.1:1339');
          },
          send: async () => {},
          close: async () => {},
        }),
      })
    ).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:1339');
  });
});

describe("the customer's tools", () => {
  it('leaves out request_appointment and log_inquiry, and offers the seven customer tools, in the server order', async () => {
    const { mcp } = await session();
    expect(CUSTOMER_TOOLS).toEqual(['browse_collections', 'search_products', 'view_product', 'find_boutiques', 'search_knowledge', 'my_appointments', 'hand_off_to_staff']);
    expect(mcp.tools.map((tool) => tool.name)).toEqual(['browse_collections', 'search_products', 'view_product', 'find_boutiques', 'search_knowledge', 'my_appointments', 'hand_off_to_staff']);
  });

  it("offers the model only Maison's seven customer tools, even when the server also lists Strapi's dev tool log and an unknown tool", async () => {
    const all = ['log', 'browse_collections', 'surprise_tool', 'search_products', 'view_product', 'request_appointment', 'find_boutiques', 'search_knowledge', 'my_appointments', 'hand_off_to_staff', 'log_inquiry'];
    const { mcp } = await session({ tools: all });
    expect(mcp.tools.map((tool) => tool.name)).toEqual(['browse_collections', 'search_products', 'view_product', 'find_boutiques', 'search_knowledge', 'my_appointments', 'hand_off_to_staff']);
    expect(mcp.listed).toEqual(all);
    // The route can still call log_inquiry on the connection.
    await expect(mcp.client.callTool({ name: 'log_inquiry', arguments: { message: 'a', reply: 'b', knowledgeFound: false, handedOff: false } })).resolves.toBeDefined();
  });

  it('lists the name of every tool Strapi offered, the hidden ones included, so the route knows whether log_inquiry is there', async () => {
    const { mcp } = await session();
    expect(mcp.listed).toContain('log_inquiry');
    expect(mcp.listed).toContain('request_appointment');
    expect(mcp.listed).toContain('search_products');
    const without = await session({ tools: ['search_products'] });
    expect(without.mcp.listed).toEqual(['search_products']);
  });

  it("gives each tool Strapi's description and JSON Schema, as they are", async () => {
    const { mcp } = await session();
    const listed = (await mcp.client.listTools()).tools.find((tool) => tool.name === 'find_boutiques')!;
    const tool = mcp.tools.find((candidate) => candidate.name === 'find_boutiques')!;
    expect(tool.description).toBe('The find_boutiques tool.');
    expect(tool.inputSchema).toEqual(listed.inputSchema);
    expect(tool.inputSchema).toMatchObject({ type: 'object', properties: { productSlugs: { type: 'array' }, locale: { enum: ['ja', 'en'] } } });
  });

  it('runs a tool on Strapi with the model input and returns the whole MCP result unchanged', async () => {
    const data = { products: [{ slug: 'weekender-50', name: 'Weekender 50' }] };
    const { mcp, calls } = await session({ handlers: { search_products: () => answer(data) } });
    const tool = mcp.tools.find((candidate) => candidate.name === 'search_products')!;
    const result = await tool.execute!({ query: 'weekender', locale: 'en' });
    expect(calls).toEqual([{ name: 'search_products', args: { query: 'weekender', locale: 'en' } }]);
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
  });

  it("returns Strapi's refusal as a result with isError, and never throws for it", async () => {
    const { mcp } = await session({ handlers: { view_product: () => refusal('not_found', 'No such piece.', 'Search for it first.') } });
    const tool = mcp.tools.find((candidate) => candidate.name === 'view_product')!;
    const result = await tool.execute!({ slug: 'nope' });
    expect(result).toMatchObject({ isError: true });
    expect(JSON.parse((result as { content: Array<{ text: string }> }).content[0].text)).toEqual({ error: { code: 'not_found', message: 'No such piece.', hint: 'Search for it first.' } });
  });

  it("returns the MCP server's own input check as a result with isError too", async () => {
    const { mcp } = await session();
    const tool = mcp.tools.find((candidate) => candidate.name === 'view_product')!;
    const result = await tool.execute!({ slug: 42 });
    expect(result).toMatchObject({ isError: true });
    expect((result as { content: Array<{ text: string }> }).content[0].text).toMatch(/^MCP error -32602: Input validation error|^Input validation error/);
  });

  it('forwards the run abort signal to Strapi', async () => {
    let seenByStrapi: AbortSignal | undefined;
    const started = Promise.withResolvers<void>();
    const { mcp } = await session({
      handlers: {
        search_products: async (_args, { signal }) => {
          seenByStrapi = signal;
          started.resolve();
          await new Promise((resolve) => signal.addEventListener('abort', resolve));
          return answer({});
        },
      },
    });
    const tool = mcp.tools.find((candidate) => candidate.name === 'search_products')!;
    const controller = new AbortController();
    const running = tool.execute!({ query: 'x' }, toolContext(controller.signal));
    await started.promise;
    controller.abort();
    await expect(running).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seenByStrapi?.aborted).toBe(true);
  });

  it('gives the route the client, to call log_inquiry and find_boutiques itself, and to close', async () => {
    const { mcp, calls } = await session({ handlers: { log_inquiry: () => answer({ inquiry: { reference: 'I-1' } }) } });
    const logged = await mcp.client.callTool({ name: 'log_inquiry', arguments: { message: 'Hi', reply: 'Hello', knowledgeFound: false, handedOff: false } });
    expect(logged.structuredContent).toEqual({ inquiry: { reference: 'I-1' } });
    expect(calls.map((call) => call.name)).toEqual(['log_inquiry']);
    await mcp.close();
    await expect(mcp.client.callTool({ name: 'search_products', arguments: {} })).rejects.toThrow();
  });

  it('works as the tools of a real chat() run: the model calls one, Strapi answers, and the stream carries the whole result', async () => {
    const data = { products: [{ slug: 'weekender-50', name: 'Weekender 50' }] };
    const { mcp } = await session({ handlers: { search_products: () => answer(data) } });
    const model = scriptedModel([{ calls: [{ id: 'call-1', name: 'search_products', input: { query: 'weekender' } }] }, { words: 'Here it is.' }]);
    const chunks: StreamChunk[] = [];
    for await (const chunk of chat({ adapter: model.adapter as never, messages: [{ role: 'user', content: 'Show me bags' }], tools: mcp.tools, agentLoopStrategy: maxIterations(8), debug: false }) as AsyncIterable<StreamChunk>) chunks.push(chunk);
    expect(resultOf(chunks, 'call-1')).toEqual({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
    expect(model.modelCalls()).toBe(2);
  });

  it('gives the model a tool that has a JSON Schema and no check of its own: chat() passes the input to Strapi as it is', async () => {
    const { mcp, calls } = await session();
    const model = scriptedModel([{ calls: [{ id: 'call-1', name: 'view_product', input: { slug: 42 } }] }, { words: 'Sorry.' }]);
    const chunks: StreamChunk[] = [];
    for await (const chunk of chat({ adapter: model.adapter as never, messages: [{ role: 'user', content: 'Show me' }], tools: mcp.tools, agentLoopStrategy: maxIterations(8), debug: false }) as AsyncIterable<StreamChunk>) chunks.push(chunk);
    expect(calls).toEqual([]); // Strapi's own check refused it, so the handler never ran
    expect(resultOf(chunks, 'call-1')).toMatchObject({ isError: true });
  });
});
