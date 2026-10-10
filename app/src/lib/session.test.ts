import { describe, expect, it, vi } from 'vitest';

import {
  ID_TOKEN_TYPE,
  SessionError,
  TOKEN_EXCHANGE,
  createSession,
} from './session';

const granted = (token: string, expiresIn = 3600) =>
  new Response(
    JSON.stringify({
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: 'mcp',
    }),
    { status: 200 }
  );
const refused = (
  status: number,
  error: string,
  headers: Record<string, string> = {}
) =>
  new Response(
    JSON.stringify({ error, error_description: `${error} from the test` }),
    { status, headers }
  );
const base = {
  strapiUrl: 'http://strapi.test',
  clientId: 'mcp_client_app',
  getIdToken: () => 'valid.Uabc',
};

describe('createSession', () => {
  it('exchanges the LINE ID token at the token endpoint', async () => {
    const fetchImpl = vi.fn(async () => granted('mcp_at_1'));
    const session = createSession({ ...base, fetchImpl });
    expect(await session.getToken()).toBe('mcp_at_1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'http://strapi.test/api/strapi-oauth-mcp-manager/oauth/token'
    );
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: TOKEN_EXCHANGE,
      client_id: 'mcp_client_app',
      subject_token: 'valid.Uabc',
      subject_token_type: ID_TOKEN_TYPE,
      resource: 'http://strapi.test/mcp',
    });
  });

  it('reuses the session until a minute before it expires', async () => {
    let now = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(granted('mcp_at_1', 120))
      .mockResolvedValueOnce(granted('mcp_at_2', 120));
    const session = createSession({ ...base, fetchImpl, now: () => now });
    expect(await session.getToken()).toBe('mcp_at_1');
    now = 59_000;
    expect(await session.getToken()).toBe('mcp_at_1');
    now = 61_000;
    expect(await session.getToken()).toBe('mcp_at_2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shares one exchange between concurrent callers', async () => {
    const fetchImpl = vi.fn(async () => granted('mcp_at_1'));
    const session = createSession({ ...base, fetchImpl });
    expect(
      await Promise.all([
        session.getToken(),
        session.getToken(),
        session.refresh(),
      ])
    ).toEqual(['mcp_at_1', 'mcp_at_1', 'mcp_at_1']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never retries invalid_grant: the customer must sign in with LINE again', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(refused(400, 'invalid_grant'))
      .mockResolvedValueOnce(granted('mcp_at_2'));
    const session = createSession({ ...base, fetchImpl, sleep });
    const error = await session.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SessionError);
    expect(error).toMatchObject({
      code: 'invalid_grant',
      signInAgain: true,
      retryLater: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(await session.getToken()).toBe('mcp_at_2'); // the next call tries again, e.g. after a new LINE login
  });

  it('waits for Retry-After and retries once when sign-in is temporarily unavailable', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        refused(503, 'temporarily_unavailable', { 'Retry-After': '3' })
      )
      .mockResolvedValueOnce(granted('mcp_at_1'));
    const session = createSession({ ...base, fetchImpl, sleep });
    expect(await session.getToken()).toBe('mcp_at_1');
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('gives up after that one retry, and says when to try again', async () => {
    const sleep = vi.fn(async () => {});
    const busy = () =>
      refused(503, 'temporarily_unavailable', { 'Retry-After': '10' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(busy())
      .mockResolvedValueOnce(busy());
    const session = createSession({ ...base, fetchImpl, sleep });
    await expect(session.getToken()).rejects.toMatchObject({
      code: 'temporarily_unavailable',
      retryLater: true,
      retryAfterSeconds: 10,
    });
    expect(sleep).toHaveBeenCalledWith(10_000); // 10 seconds is the longest it waits
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('waits 5 seconds when Retry-After says nothing', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(refused(503, 'temporarily_unavailable'))
      .mockResolvedValueOnce(granted('mcp_at_1'));
    const session = createSession({ ...base, fetchImpl, sleep });
    expect(await session.getToken()).toBe('mcp_at_1');
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('does not wait out a Retry-After over 10 seconds: it fails at once, carrying the wait for the screen to show', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        refused(503, 'temporarily_unavailable', { 'Retry-After': '11' })
      )
      .mockResolvedValueOnce(granted('mcp_at_1'));
    const session = createSession({ ...base, fetchImpl, sleep });
    await expect(session.getToken()).rejects.toMatchObject({
      code: 'temporarily_unavailable',
      retryLater: true,
      retryAfterSeconds: 11,
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no automatic retry
    expect(await session.getToken()).toBe('mcp_at_1'); // the next call tries again
  });

  it('refresh() drops the token that was just refused, so getToken() joins the new exchange instead of handing it out', async () => {
    let answer!: () => void;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(granted('mcp_at_1'))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            answer = () => resolve(granted('mcp_at_2'));
          })
      );
    const session = createSession({ ...base, fetchImpl });
    expect(await session.getToken()).toBe('mcp_at_1');
    const renewed = session.refresh(); // mcp_at_1 just got a 401
    const joined = session.getToken(); // while that exchange is under way
    answer();
    expect(await Promise.all([renewed, joined])).toEqual([
      'mcp_at_2',
      'mcp_at_2',
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // getToken() made no exchange of its own
  });

  it('after a failed re-exchange, getToken() exchanges again instead of handing out the refused token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(granted('mcp_at_1'))
      .mockResolvedValueOnce(refused(400, 'invalid_grant'))
      .mockResolvedValueOnce(granted('mcp_at_3'));
    const session = createSession({ ...base, fetchImpl });
    expect(await session.getToken()).toBe('mcp_at_1');
    await expect(session.refresh()).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    expect(await session.getToken()).toBe('mcp_at_3'); // not mcp_at_1: it was refused
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
