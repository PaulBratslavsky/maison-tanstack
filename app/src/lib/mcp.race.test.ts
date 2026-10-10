// Calls that hit a 401 together, against the real MCP SDK client and a fake stateless Strapi /mcp.
// The fake answers each POST the way Strapi's MCP server does (an event stream, or a 401 for a token it doesn't
// know), and the token endpoint is scripted. A request waits at either only when a test holds it, so the order of
// events is the test's, not the clock's.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it, vi } from 'vitest';

import { createMcp } from './mcp';
import { SessionError, createSession } from './session';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Something a test waits for (`arrived`) and then lets go (`release`). */
const gate = () => {
  let arrive!: () => void;
  let release!: () => void;
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  return { arrive, arrived, release, released };
};

const makeServer = () => {
  const valid = new Set<string>();
  const log: Array<{ token: string; method: string; status: number }> = [];
  const held = new Map<string, ReturnType<typeof gate>>();

  /** The next request for `name` (a tool, or a JSON-RPC method such as initialize) waits at the server until released. */
  const hold = (name: string) => {
    const waiting = gate();
    held.set(name, waiting);
    return { arrived: waiting.arrived, release: waiting.release };
  };

  const fetchImpl = async (_url: unknown, init: RequestInit) => {
    if (init.method !== 'POST') return new Response(null, { status: 405 }); // stateless: no stream to listen on
    const token = (new Headers(init.headers).get('authorization') ?? '').replace(
      /^Bearer /,
      ''
    );
    const message = JSON.parse(String(init.body));
    const name =
      message.method === 'tools/call' ? message.params.name : message.method;
    const waiting = held.get(name);
    if (waiting) {
      held.delete(name);
      waiting.arrive();
      await waiting.released;
    }
    if (!valid.has(token)) {
      log.push({ token, method: message.method, status: 401 });
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Authentication required' },
          id: null,
        }),
        {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'www-authenticate': 'Bearer',
          },
        }
      );
    }
    log.push({ token, method: message.method, status: 200 });
    if (!('id' in message)) return new Response(null, { status: 202 });
    const result =
      message.method === 'initialize'
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'fake', version: '1' },
          }
        : {
            content: [{ type: 'text', text: message.params.name }],
            structuredContent: { name: message.params.name, token },
          };
    return new Response(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    );
  };
  return { valid, log, hold, fetchImpl };
};

type Step = 'grant' | 'invalid_grant' | 'busy' | 'dud';

/**
 * The token endpoint, scripted: each exchange takes the next step, and 'grant' when the script runs out.
 * A 'dud' issues a token that the server never accepts.
 */
const makeTokenEndpoint = (
  server: ReturnType<typeof makeServer>,
  script: Step[]
) => {
  let issued = 0;
  const steps: Step[] = [];
  let waiting: ReturnType<typeof gate> | null = null;

  /** The next exchange waits at the endpoint until released. */
  const hold = () => {
    const held = gate();
    waiting = held;
    return { started: held.arrived, release: held.release };
  };

  const fetchImpl = vi.fn(async () => {
    const held = waiting;
    if (held) {
      waiting = null;
      held.arrive();
      await held.released;
    }
    const step = script.shift() ?? 'grant';
    steps.push(step);
    if (step === 'invalid_grant')
      return new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'LINE refused the ID token',
        }),
        { status: 400 }
      );
    if (step === 'busy')
      return new Response(
        JSON.stringify({
          error: 'temporarily_unavailable',
          error_description: 'LINE is busy',
        }),
        { status: 503, headers: { 'Retry-After': '1' } }
      );
    const token = `T${++issued}`;
    if (step === 'grant') server.valid.add(token);
    return new Response(
      JSON.stringify({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 3600,
      }),
      { status: 200 }
    );
  });
  return { fetchImpl, steps, hold };
};

/** What connectTo() does, with the fake server's fetch; it keeps every client it made and the token it used. */
const connectVia = (server: ReturnType<typeof makeServer>) => {
  const clients: Array<{ token: string; client: Client; connected: boolean }> =
    [];
  const connect = async (token: string) => {
    const client = new Client({ name: 'maison-app', version: '1.0.0' });
    const entry = { token, client, connected: false };
    clients.push(entry);
    vi.spyOn(client, 'close');
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://strapi.test/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: server.fetchImpl as typeof fetch,
      })
    );
    entry.connected = true;
    return client;
  };
  return { connect, clients };
};

const setup = (script: Step[] = []) => {
  const server = makeServer();
  const endpoint = makeTokenEndpoint(server, script);
  const session = createSession({
    strapiUrl: 'http://strapi.test',
    clientId: 'c',
    getIdToken: () => 'valid.U0',
    fetchImpl: endpoint.fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
  });
  const refresh = vi.spyOn(session, 'refresh');
  const { connect, clients } = connectVia(server);
  const mcp = createMcp({
    strapiUrl: 'http://strapi.test',
    session,
    onRecord: () => {},
    connect,
  });
  return { server, endpoint, session, refresh, clients, mcp };
};

const outcomes = (results: PromiseSettledResult<unknown>[]) =>
  results.map((result) =>
    result.status === 'fulfilled'
      ? 'ok'
      : `${(result.reason as Error).constructor.name}: ${(result.reason as Error).message}`
  );
const reasonOf = (result: PromiseSettledResult<unknown>) =>
  (result as PromiseRejectedResult).reason;

describe('calls that hit a 401 together, on the real SDK client', () => {
  it('three calls in flight across a 401 share one exchange and one reconnect; the old connection closes after the last of them', async () => {
    const t = setup();
    await t.mcp.callTool('s', 'warm'); // connects on T1
    const held = ['a', 'b', 'c'].map((name) => t.server.hold(name));
    const calls = ['a', 'b', 'c'].map((name) => t.mcp.callTool('s', name));
    await Promise.all(held.map((hold) => hold.arrived)); // all three are on the T1 connection
    t.server.valid.delete('T1'); // the session expires while they're in flight

    held[0].release(); // a hears its 401 first, and moves to T2
    await calls[0];
    expect(t.clients[0].client.close).not.toHaveBeenCalled(); // b and c are still on the old connection
    held[1].release();
    await calls[1];
    expect(t.clients[0].client.close).not.toHaveBeenCalled(); // c still is
    held[2].release();
    expect(outcomes(await Promise.allSettled(calls))).toEqual([
      'ok',
      'ok',
      'ok',
    ]);

    expect(t.endpoint.steps).toEqual(['grant', 'grant']); // the first sign-in, then one exchange
    expect(t.clients.map((entry) => entry.token)).toEqual(['T1', 'T2']);
    expect(t.clients[0].client.close).toHaveBeenCalledTimes(1);
    expect(t.clients[1].client.close).not.toHaveBeenCalled();
  });

  it('a 401 while connecting, with three calls waiting: one exchange, one reconnect, and all succeed', async () => {
    const t = setup();
    await t.session.getToken(); // signed in (T1) but not connected yet
    t.server.valid.delete('T1'); // revoked before the first call
    const results = await Promise.allSettled(
      ['a', 'b', 'c'].map((name) => t.mcp.callTool('s', name))
    );
    expect(outcomes(results)).toEqual(['ok', 'ok', 'ok']);
    expect(t.endpoint.steps).toEqual(['grant', 'grant']);
    expect(t.clients.map((entry) => [entry.token, entry.connected])).toEqual([
      ['T1', false],
      ['T2', true],
    ]);
  });

  it('a call that starts while the reconnect is in progress waits for it, and makes no exchange of its own', async () => {
    const t = setup();
    await t.mcp.callTool('s', 'warm');
    const a = t.server.hold('a');
    const exchange = t.endpoint.hold(); // the next exchange stays at the token endpoint
    const callA = t.mcp.callTool('s', 'a');
    await a.arrived;
    t.server.valid.delete('T1');
    a.release(); // a's 401 starts the re-exchange
    await exchange.started;
    const callD = t.mcp.callTool('s', 'd'); // starts while the reconnect is in progress
    exchange.release();
    expect(outcomes(await Promise.allSettled([callA, callD]))).toEqual([
      'ok',
      'ok',
    ]);
    expect(t.endpoint.fetchImpl).toHaveBeenCalledTimes(2); // the first sign-in, and the one exchange
    expect(t.clients.map((entry) => entry.token)).toEqual(['T1', 'T2']);
  });

  it('a 401 that arrives after its replacement was itself replaced joins the newest connection', async () => {
    const t = setup();
    await t.mcp.callTool('s', 'warm');
    const a = t.server.hold('a');
    const b = t.server.hold('b');
    const callA = t.mcp.callTool('s', 'a');
    const callB = t.mcp.callTool('s', 'b');
    await Promise.all([a.arrived, b.arrived]);
    t.server.valid.delete('T1');
    a.release();
    await callA; // renewed to T2
    t.server.valid.delete('T2');
    await t.mcp.callTool('s', 'e'); // a 401 on T2: renewed to T3
    b.release(); // b's 401 on T1 lands now
    expect(outcomes(await Promise.allSettled([callB]))).toEqual(['ok']);
    expect(t.endpoint.steps).toEqual(['grant', 'grant', 'grant']);
    expect(t.clients.map((entry) => entry.token)).toEqual(['T1', 'T2', 'T3']);
    expect(t.clients[0].client.close).toHaveBeenCalledTimes(1);
    expect(t.clients[1].client.close).toHaveBeenCalledTimes(1);
  });

  it('a refused re-exchange fails every call that shared it with the same SessionError, and nothing retries', async () => {
    const t = setup(['grant', 'invalid_grant']);
    await t.mcp.callTool('s', 'warm');
    const a = t.server.hold('a');
    const b = t.server.hold('b');
    const calls = [t.mcp.callTool('s', 'a'), t.mcp.callTool('s', 'b')];
    await Promise.all([a.arrived, b.arrived]);
    t.server.valid.delete('T1');
    const exchange = t.endpoint.hold();
    a.release();
    await exchange.started; // a's 401 started the re-exchange
    b.release(); // b's 401 lands while it is under way
    await flush();
    exchange.release();
    const results = await Promise.allSettled(calls);
    expect(outcomes(results)).toEqual([
      'SessionError: LINE refused the ID token',
      'SessionError: LINE refused the ID token',
    ]);
    expect(reasonOf(results[1])).toBe(reasonOf(results[0]));
    expect(t.endpoint.steps).toEqual(['grant', 'invalid_grant']);
    expect(t.refresh).toHaveBeenCalledTimes(1);
  });

  it('a 401 that lands after the shared re-exchange was refused fails with that refusal, and exchanges nothing of its own', async () => {
    // A third step would be a second, wrong exchange. Inside LINE it would mean a second sign-in.
    const t = setup(['grant', 'invalid_grant', 'invalid_grant']);
    await t.mcp.callTool('s', 'warm');
    const a = t.server.hold('a');
    const b = t.server.hold('b');
    const callA = t.mcp.callTool('s', 'a');
    const callB = t.mcp.callTool('s', 'b');
    await Promise.all([a.arrived, b.arrived]);
    t.server.valid.delete('T1');
    a.release();
    const errorA = await callA.catch((error: unknown) => error); // refused: invalid_grant
    expect(errorA).toBeInstanceOf(SessionError);
    b.release(); // b's 401 on the same T1 connection lands after the refusal
    const errorB = await callB.catch((error: unknown) => error);
    expect(errorB).toBe(errorA); // the same refusal
    expect(t.endpoint.steps).toEqual(['grant', 'invalid_grant']); // one exchange: b made none
    expect(t.refresh).toHaveBeenCalledTimes(1);
  });

  it("after a refused re-exchange, the next call exchanges afresh instead of connecting with the token that was just refused", async () => {
    const t = setup(['grant', 'busy', 'busy', 'grant']);
    await t.mcp.callTool('s', 'warm');
    const a = t.server.hold('a');
    const callA = t.mcp.callTool('s', 'a');
    await a.arrived;
    t.server.valid.delete('T1');
    a.release();
    await expect(callA).rejects.toBeInstanceOf(SessionError); // temporarily_unavailable, twice
    const next = await t.mcp.callTool('s', 'next'); // "Try again"
    expect((next.structuredContent as { token: string }).token).toBe('T2');
    expect(t.endpoint.steps).toEqual(['grant', 'busy', 'busy', 'grant']);
    expect(t.clients.map((entry) => [entry.token, entry.connected])).toEqual([
      ['T1', true],
      ['T2', true], // no connect on T1 in between
    ]);
    expect(
      t.server.log.filter((entry) => entry.status === 401).map((entry) => entry.method)
    ).toEqual(['tools/call']); // only a's own
  });

  it("a late 401 joins the reconnect that 'Try again' opened with a fresh token, and succeeds without an exchange of its own", async () => {
    const t = setup(['grant', 'invalid_grant', 'grant']);
    await t.mcp.callTool('s', 'warm');
    const a = t.server.hold('a');
    const b = t.server.hold('b');
    const callA = t.mcp.callTool('s', 'a');
    const callB = t.mcp.callTool('s', 'b');
    await Promise.all([a.arrived, b.arrived]);
    t.server.valid.delete('T1');
    a.release();
    await expect(callA).rejects.toBeInstanceOf(SessionError); // the re-exchange is refused
    const connecting = t.server.hold('initialize'); // the next connect stays at the server
    const callE = t.mcp.callTool('s', 'e'); // "Try again": a new exchange, then a new connection
    await connecting.arrived;
    b.release(); // b's 401 on the old connection lands while the new one is opening
    await flush();
    connecting.release();
    expect(outcomes(await Promise.allSettled([callB, callE]))).toEqual([
      'ok',
      'ok',
    ]);
    expect(t.endpoint.steps).toEqual(['grant', 'invalid_grant', 'grant']);
    expect(t.clients.map((entry) => entry.token)).toEqual(['T1', 'T2']);
  });

  it('a refused first sign-in fails the call with the SessionError, and the next call starts over', async () => {
    const t = setup(['invalid_grant', 'grant']);
    await expect(t.mcp.callTool('s', 'a')).rejects.toBeInstanceOf(SessionError);
    expect(outcomes(await Promise.allSettled([t.mcp.callTool('s', 'b')]))).toEqual(
      ['ok']
    );
    expect(t.endpoint.steps).toEqual(['invalid_grant', 'grant']);
  });

  it('a renewed token that is refused too fails the call after that one retry: no loop', async () => {
    const t = setup(['grant', 'dud']);
    await t.mcp.callTool('s', 'warm');
    t.server.valid.delete('T1');
    const error = await t.mcp.callTool('s', 'a').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StreamableHTTPError);
    expect((error as StreamableHTTPError).code).toBe(401);
    expect(t.endpoint.steps).toEqual(['grant', 'dud']); // one exchange, and no second
  });
});
