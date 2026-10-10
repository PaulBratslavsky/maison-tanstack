import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LineOs } from './open-in-line';

// The real LIFF SDK, as the app uses it in LINE mode (VITE_LIFF_MOCK=false), plus what mock mode calls on it.
const liff = vi.hoisted(() => ({
  init: vi.fn(async (_config: object) => {}),
  isInClient: vi.fn(() => true),
  isLoggedIn: vi.fn(() => true),
  getIDToken: vi.fn(() => 'eyJ.line.idtoken'),
  getAppLanguage: vi.fn((): string => 'ja'),
  getOS: vi.fn((): LineOs => 'ios'),
  getFriendship: vi.fn(async (): Promise<unknown> => ({ friendFlag: true })),
  login: vi.fn(),
  logout: vi.fn(),
  use: vi.fn(),
  $mock: { set: vi.fn() },
}));
vi.mock('@line/liff', () => ({ default: liff }));

const LIFF_ID = '1234567890-AbcdEfgh'; // made up: never a real LIFF ID in this repo

/** The browser: its location, and the tab's session storage, which outlives a reload. */
const browser = ({
  pathname = '/visits',
  search = '',
  hash = '',
  sessionStorage,
}: { pathname?: string; search?: string; hash?: string; sessionStorage?: Pick<Storage, 'getItem' | 'setItem'> } = {}) => {
  const store = new Map<string, string>();
  const location = { href: `https://maison.example${pathname}${search}${hash}`, pathname, search, hash, reload: vi.fn() };
  vi.stubGlobal('window', {
    location,
    sessionStorage: sessionStorage ?? {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
  return location;
};

/** Whether a promise is still pending after the microtasks and a few timers have run. */
const stillPending = (promise: Promise<unknown>) =>
  Promise.race([promise.then(() => false, () => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 20))]);

/** liff.ts and the open-in-LINE state, fresh for each test (beforeEach resets the modules), so instanceof holds. */
const load = async () => ({ ...(await import('./liff')), ...(await import('./open-in-line')) });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // Inside LINE, signed in by LINE, on an iPhone, in Japanese. Each test changes what it's about.
  liff.isInClient.mockReturnValue(true);
  liff.isLoggedIn.mockReturnValue(true);
  liff.getAppLanguage.mockReturnValue('ja');
  liff.getOS.mockReturnValue('ios');
  liff.getFriendship.mockImplementation(async () => ({ friendFlag: true }));
  vi.stubEnv('VITE_LIFF_MOCK', 'false');
  vi.stubEnv('VITE_LIFF_ID', LIFF_ID);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('initLiff inside LINE', () => {
  it("starts LIFF with the app's LIFF ID and passes on LINE's ID token and language", async () => {
    browser();
    const { initLiff } = await import('./liff');
    const state = await initLiff();
    expect(liff.init).toHaveBeenCalledWith({ liffId: LIFF_ID });
    expect(state).toMatchObject({ locale: 'ja', mock: false });
    expect(state.getIdToken()).toBe('eyJ.line.idtoken');
  });

  it("keeps today's sign-in: LINE signs in by itself, and liff.login() runs only if it hasn't", async () => {
    browser();
    liff.isLoggedIn.mockReturnValue(false);
    const { initLiff } = await import('./liff');
    const started = initLiff();
    expect(await stillPending(started)).toBe(true); // the page is leaving for LINE Login
    expect(liff.login).toHaveBeenCalledTimes(1);
  });

  it('signs in again the way LINE documents it: log out and reload, never liff.login(), and only once a minute', async () => {
    const location = browser();
    const { initLiff } = await import('./liff');
    const state = await initLiff();
    state.signInAgain();
    expect(liff.logout).toHaveBeenCalledTimes(1);
    expect(location.reload).toHaveBeenCalledTimes(1);
    // A second call right after is one sign-in, not two: one refused exchange reaches signInAgain through both of
    // maison.ts's session wrappers. And refused again after the reload, the app and Strapi disagree about the channel:
    // the screen shows the error rather than reload for ever.
    state.signInAgain();
    expect(liff.logout).toHaveBeenCalledTimes(1);
    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(liff.login).not.toHaveBeenCalled();
  });

  it('signs in again a minute later: an ID token lasts an hour, and the next one expires too', async () => {
    const location = browser();
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 7, 10));
    const { initLiff } = await import('./liff');
    const state = await initLiff();
    state.signInAgain();
    now.mockReturnValue(Date.UTC(2026, 9, 7, 10, 1));
    state.signInAgain();
    expect(liff.logout).toHaveBeenCalledTimes(2);
    expect(location.reload).toHaveBeenCalledTimes(2);
  });

  it("doesn't reload without session storage, where a loop can't be told apart: the screen shows the error", async () => {
    const location = browser({
      sessionStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
      },
    });
    const { initLiff } = await import('./liff');
    const state = await initLiff();
    state.signInAgain();
    expect(liff.logout).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });
});

describe('initLiff outside LINE, in a browser such as Safari', () => {
  it("never starts LINE Login: start-up ends in the open-in-LINE state, with this page's LINE link", async () => {
    const location = browser({ pathname: '/products/weekender-50', search: '?code=abc&liffClientId=x', hash: '#access_token=y' });
    liff.isInClient.mockReturnValue(false);
    liff.isLoggedIn.mockReturnValue(false);
    liff.getAppLanguage.mockReturnValue('en-US');
    liff.getOS.mockReturnValue('android');
    const { initLiff, OpenInLineError } = await load();
    const started = initLiff().then(
      () => 'signed in',
      (error: unknown) => error
    );
    const outcome = await Promise.race([started, new Promise((resolve) => setTimeout(() => resolve('still starting'), 20))]);
    expect(liff.login).not.toHaveBeenCalled();
    expect(outcome).toBeInstanceOf(OpenInLineError);
    // The page's path only: the query and the hash can carry LINE's tokens or codes.
    expect(outcome).toMatchObject({ url: `https://liff.line.me/${LIFF_ID}/products/weekender-50`, locale: 'en', os: 'android' });
    expect(liff.init).toHaveBeenCalledWith({ liffId: LIFF_ID });
    expect(liff.getIDToken).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('gives the start page the bare LINE link, and passes on a desktop browser as web, which gets no button', async () => {
    browser({ pathname: '/' });
    liff.isInClient.mockReturnValue(false);
    liff.getOS.mockReturnValue('web');
    const { initLiff } = await import('./liff');
    await expect(initLiff()).rejects.toMatchObject({ url: `https://liff.line.me/${LIFF_ID}`, locale: 'ja', os: 'web' });
    expect(liff.login).not.toHaveBeenCalled();
  });

  it('is also how a signed-in browser ends: outside LINE, no session even with a LINE login', async () => {
    browser();
    liff.isInClient.mockReturnValue(false);
    liff.isLoggedIn.mockReturnValue(true);
    const { initLiff, OpenInLineError } = await load();
    await expect(initLiff()).rejects.toBeInstanceOf(OpenInLineError);
    expect(liff.getIDToken).not.toHaveBeenCalled();
  });
});

describe('initLiff with the LIFF mock (the stage and development)', () => {
  it("signs the demo customer in as before: the mock isn't outside LINE, though its isInClient() says false", async () => {
    browser();
    vi.stubEnv('VITE_LIFF_MOCK', 'true');
    liff.isInClient.mockReturnValue(false); // what @line/liff-mock answers by default
    const { initLiff } = await import('./liff');
    const state = await initLiff();
    expect(state).toMatchObject({ mock: true });
    expect(liff.init).toHaveBeenCalledWith({ liffId: LIFF_ID, mock: true });
    expect(liff.$mock.set).toHaveBeenCalledTimes(1);
    expect(liff.login).not.toHaveBeenCalled();
  });
});

describe("friendFlag: whether the customer has added Maison's Official Account, for the add-friend nudge", () => {
  beforeEach(() => {
    vi.stubEnv('VITE_LINE_OA_ID', '@123abcde'); // made up: never Maison's real basic ID in this repo
    browser();
  });

  /** Signs in as the screens do, then asks the way each screen's button does. */
  const friendFlag = async () => {
    const { initLiff } = await import('./liff');
    return (await initLiff()).friendFlag();
  };

  it.each([true, false])(
    "passes on LINE's friendFlag %s, asked once per page load, for the account linked to the LINE Login channel",
    async (answer) => {
      liff.getFriendship.mockResolvedValue({ friendFlag: answer });
      expect(await friendFlag()).toBe(answer);
      expect(await friendFlag()).toBe(answer); // another screen, or another button, on the same page load
      expect(liff.getFriendship).toHaveBeenCalledTimes(1);
      expect(liff.getFriendship).toHaveBeenCalledWith(); // no officialAccountId: the linked account is the one asked about
    }
  );

  it('takes an answer without a true or false friendFlag as none', async () => {
    liff.getFriendship.mockResolvedValue({});
    expect(await friendFlag()).toBeNull();
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not an @ ID', '123abcde'],
  ])("doesn't ask LINE when VITE_LINE_OA_ID is %s: there's no button to word", async (_, value) => {
    vi.stubEnv('VITE_LINE_OA_ID', value);
    expect(await friendFlag()).toBeNull();
    expect(liff.getFriendship).not.toHaveBeenCalled();
  });

  it('gives no answer when the call fails, as it does until the account is linked: the plain button, and one warning in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    liff.getFriendship.mockRejectedValue(new Error('403: no Official Account is linked to the channel'));
    expect(await friendFlag()).toBeNull();
    expect(await friendFlag()).toBeNull(); // the page load's answer: not asked again
    expect(liff.getFriendship).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Linked LINE Official Account');
  });

  it('says nothing about a failed call outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    liff.getFriendship.mockRejectedValue(new Error('403'));
    expect(await friendFlag()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['would answer friendFlag false', async () => ({ friendFlag: false })], // @line/liff-mock's default answer
    [
      'would throw, as it does without liff.login()',
      () => {
        throw new Error('You need to call liff.login first.');
      },
    ],
  ])("doesn't ask in LIFF-mock mode, though the mock %s: the plain button, and no warning", async (_, answer) => {
    vi.stubEnv('VITE_LIFF_MOCK', 'true');
    vi.stubEnv('NODE_ENV', 'development');
    liff.isInClient.mockReturnValue(false); // what @line/liff-mock answers by default
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    liff.getFriendship.mockImplementation(answer);
    expect(await friendFlag()).toBeNull();
    expect(liff.getFriendship).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
