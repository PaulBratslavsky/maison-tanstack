// maison.ts wires LINE sign-in, the customer session and the MCP client together. These tests run the real
// session against a stubbed token endpoint, and replace only the parts that need a browser or a network:
// LIFF, the public config, and the MCP client (whose `onRecord` they capture).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolCallRecord } from './mcp';
import { OpenInLineError } from './open-in-line';

const mocks = vi.hoisted(() => ({
  config: { strapiUrl: 'http://strapi.test', clientId: 'mcp_client_app' },
  initLiff: vi.fn(),
  createMcp: vi.fn(),
}));
vi.mock('./config', () => ({ config: mocks.config }));
vi.mock('./liff', () => ({ initLiff: mocks.initLiff }));
vi.mock('./mcp', () => ({ createMcp: mocks.createMcp }));

const granted = () =>
  new Response(
    JSON.stringify({
      access_token: 'mcp_at_1',
      token_type: 'Bearer',
      expires_in: 3600,
    }),
    { status: 200 }
  );
const refused = (status: number, error: string) =>
  new Response(
    JSON.stringify({ error, error_description: `${error} from the test` }),
    { status }
  );

/** The token endpoint. Change `mockImplementation` on what it returns to change the answer. */
const tokenEndpoint = (answer: () => Response) => {
  const fetchImpl = vi.fn(async () => answer());
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
};

/** What initLiff() gives: inside LINE (`mock: false`) or with the LIFF mock (`mock: true`). */
const liffState = (mock: boolean) => ({
  getIdToken: () => 'valid.Uabc',
  locale: 'en' as const,
  mock,
  signInAgain: vi.fn(),
  friendFlag: vi.fn(async (): Promise<boolean | null> => null),
});

/** maison.ts keeps its sign-in and its listeners at module level, so each test loads a fresh copy. */
const load = () => import('./maison');

beforeEach(() => {
  vi.resetModules();
  mocks.config.clientId = 'mcp_client_app';
  mocks.initLiff.mockReset();
  mocks.createMcp.mockReset();
  mocks.createMcp.mockImplementation(() => ({ callTool: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getMaison', () => {
  it('signs in before the first screen, and sets up once per page load', async () => {
    mocks.initLiff.mockResolvedValue(liffState(true));
    const fetchImpl = tokenEndpoint(granted);
    const { getMaison } = await load();
    const maison = await getMaison();
    expect(maison).toMatchObject({ locale: 'en', mock: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mocks.createMcp).toHaveBeenCalledTimes(1);
    expect(mocks.createMcp.mock.calls[0][0]).toMatchObject({
      strapiUrl: 'http://strapi.test',
    });
    expect(mocks.createMcp.mock.calls[0][0].session).toBe(maison.session);
    expect(await getMaison()).toBe(maison);
    expect(mocks.initLiff).toHaveBeenCalledTimes(1);
  });

  it('without a client ID, says to run the setup, and does not start LIFF', async () => {
    mocks.config.clientId = '';
    const { getMaison } = await load();
    await expect(getMaison()).rejects.toThrow(/npm run setup/);
    expect(mocks.initLiff).not.toHaveBeenCalled();
  });

  it('after a failed start, the next call starts over', async () => {
    mocks.initLiff.mockResolvedValue(liffState(true));
    const fetchImpl = tokenEndpoint(() => refused(500, 'server_error'));
    const { getMaison } = await load();
    await expect(getMaison()).rejects.toMatchObject({ code: 'server_error' });
    fetchImpl.mockImplementation(async () => granted());
    expect(await getMaison()).toMatchObject({ mock: true });
    expect(mocks.initLiff).toHaveBeenCalledTimes(2);
  });

  it('hands the screens LIFF\'s friendship check, for the words of "Chat with Maison on LINE"', async () => {
    const liff = liffState(false);
    liff.friendFlag.mockResolvedValue(false);
    mocks.initLiff.mockResolvedValue(liff);
    tokenEndpoint(granted);
    const { getMaison } = await load();
    expect(await (await getMaison()).friendFlag()).toBe(false);
    expect(liff.friendFlag).toHaveBeenCalledTimes(1);
  });

  it('outside LINE, hands the open-in-LINE state to the screens as it came: no token exchange, no MCP connection', async () => {
    const outside = new OpenInLineError('https://liff.line.me/1234567890-AbcdEfgh/visits', 'en', 'ios');
    mocks.initLiff.mockRejectedValue(outside);
    const fetchImpl = tokenEndpoint(granted);
    const { getMaison } = await load();
    await expect(getMaison()).rejects.toBe(outside);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.createMcp).not.toHaveBeenCalled();
  });
});

describe('invalid_grant: LINE refused the ID token', () => {
  it('inside LINE, starts a new LINE login, and the error still reaches the screen', async () => {
    const liff = liffState(false);
    mocks.initLiff.mockResolvedValue(liff);
    tokenEndpoint(() => refused(400, 'invalid_grant'));
    const { getMaison } = await load();
    await expect(getMaison()).rejects.toMatchObject({
      code: 'invalid_grant',
      signInAgain: true,
    });
    expect(liff.signInAgain).toHaveBeenCalledTimes(1);
  });

  it('with the LIFF mock, only shows the error: the mock has no LINE login to go to', async () => {
    const liff = liffState(true);
    mocks.initLiff.mockResolvedValue(liff);
    tokenEndpoint(() => refused(400, 'invalid_grant'));
    const { getMaison } = await load();
    await expect(getMaison()).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(liff.signInAgain).not.toHaveBeenCalled();
  });

  it('is the only refusal that starts a new LINE login', async () => {
    const liff = liffState(false);
    mocks.initLiff.mockResolvedValue(liff);
    tokenEndpoint(() => refused(500, 'server_error'));
    const { getMaison } = await load();
    await expect(getMaison()).rejects.toMatchObject({ code: 'server_error' });
    expect(liff.signInAgain).not.toHaveBeenCalled();
  });

  it.each([
    { mock: false, signIns: 1 },
    { mock: true, signIns: 0 },
  ])(
    'when a later exchange is refused, signs in again only inside LINE (mock: $mock)',
    async ({ mock, signIns }) => {
      const liff = liffState(mock);
      mocks.initLiff.mockResolvedValue(liff);
      const fetchImpl = tokenEndpoint(granted); // the first sign-in works
      const { getMaison } = await load();
      const { session } = await getMaison();
      fetchImpl.mockImplementation(async () => refused(400, 'invalid_grant')); // the session expired
      await expect(session.refresh()).rejects.toMatchObject({
        code: 'invalid_grant',
      });
      expect(liff.signInAgain).toHaveBeenCalledTimes(signIns);
    }
  );
});

describe('onToolCall', () => {
  const record: ToolCallRecord = {
    id: 1,
    screen: 'home',
    name: 'browse_collections',
    args: {},
    result: null,
    error: null,
    ms: 3,
    at: '2026-09-30T00:00:00.000Z',
  };

  /** Starts Maison, and hands back the `onRecord` that maison.ts gave the MCP client. */
  const started = async () => {
    mocks.initLiff.mockResolvedValue(liffState(true));
    tokenEndpoint(granted);
    const { getMaison, onToolCall } = await load();
    await getMaison();
    const { onRecord } = mocks.createMcp.mock.calls[0][0] as {
      onRecord: (record: ToolCallRecord) => void;
    };
    return { onRecord, onToolCall };
  };

  it('tells every listener about each call, until it unsubscribes', async () => {
    const { onRecord, onToolCall } = await started();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onToolCall(first);
    onToolCall(second);
    onRecord(record);
    expect(first).toHaveBeenCalledWith(record);
    expect(second).toHaveBeenCalledWith(record);
    stopFirst();
    onRecord(record);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('isolates the listeners: one that throws neither fails the call nor hides the record from the others', async () => {
    const { onRecord, onToolCall } = await started();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = vi.fn();
    const broken = vi.fn(() => {
      throw new Error('listener broke');
    });
    const after = vi.fn();
    onToolCall(before);
    onToolCall(broken);
    onToolCall(after);
    expect(() => onRecord(record)).not.toThrow();
    expect(before).toHaveBeenCalledTimes(1);
    expect(broken).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1); // after the one that threw
    expect(logged).toHaveBeenCalledTimes(1); // not swallowed silently
  });
});
