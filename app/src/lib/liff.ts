import type { ExtendedInit, LiffMockApi } from '@line/liff-mock';

import { config } from './config';
import { lineAppUrl } from './line-app-url.mjs';
import { lineChatUrl } from './line-chat';
import { OpenInLineError } from './open-in-line';
import type { Locale } from './types';

export interface LiffState {
  getIdToken: () => string;
  locale: Locale;
  mock: boolean;
  /** Inside LINE: a new LINE login, for when the token endpoint answers invalid_grant. It reloads the page. */
  signInAgain: () => void;
  /**
   * Whether the customer has added Maison's LINE Official Account as a friend, for "Chat with Maison on LINE"'s words
   * (lineChatWords): liff.getFriendship()'s friendFlag, for the account linked to the LIFF app's LINE Login channel.
   * Asked once per page load, inside LINE only, and only with VITE_LINE_OA_ID set: the LIFF mock is never asked.
   * Null when there's no answer: the setting is unset, the app runs on the LIFF mock, or the call failed, as it does
   * until that account is linked.
   */
  friendFlag: () => Promise<boolean | null>;
}

const LINE_USER_ID = /^U[0-9a-f]{32}$/;
const DEMO_USER_KEY = 'maison.demoUser';
const SIGNED_IN_AGAIN_AT = 'maison.signedInAgainAt';
/** Development only: why the plain button shows when liff.getFriendship() fails, and the fix. It names no LINE value. */
const FRIENDSHIP_FAILED =
  'liff.getFriendship() failed, so the app shows the plain "Chat with Maison on LINE" button. Link Maison\'s ' +
  "Official Account to the LIFF app's LINE Login channel: Basic settings → Linked LINE Official Account.";
let ready: Promise<LiffState> | null = null;

export const toLocale = (language: string | undefined): Locale =>
  language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';

/** Mock mode only: ?demoUser=U… signs in another demo customer in this tab (tests, second-customer check). */
const demoUserId = (): string => {
  const fromQuery = new URLSearchParams(window.location.search).get('demoUser');
  try {
    if (fromQuery && LINE_USER_ID.test(fromQuery))
      window.sessionStorage.setItem(DEMO_USER_KEY, fromQuery);
    const stored = window.sessionStorage.getItem(DEMO_USER_KEY);
    if (stored && LINE_USER_ID.test(stored)) return stored;
  } catch {
    // storage unavailable: use the default demo customer
  }
  return config.demoLineUserId;
};

const init = async (): Promise<LiffState> => {
  const liff = (await import('@line/liff')).default;

  if (config.liffMock) {
    const { LiffMockPlugin } = await import('@line/liff-mock');
    liff.use(new LiffMockPlugin());
    await (liff.init as unknown as ExtendedInit)({
      liffId: config.liffId || 'maison-demo',
      mock: true,
    });
    const userId = demoUserId();
    // Always the function form: set() with a plain object replaces the whole mock store.
    (liff as unknown as { $mock: LiffMockApi }).$mock.set((previous) => ({
      ...previous,
      isLoggedIn: true,
      getIDToken: `valid.${userId}`,
      getAppLanguage: config.demoLocale,
      getLanguage: config.demoLocale,
    }));
  } else {
    await liff.init({ liffId: config.liffId });
    // Outside the LINE app, for instance when LINE hands a liff.line.me link to Safari, LINE Login looped through LINE
    // and ngrok's warning page and never came back. So the app signs in only inside LINE, and asks to be opened there.
    // (The LIFF mock's isInClient() is false too, which is why this sits in the branch for the real LIFF only.)
    if (!liff.isInClient()) {
      throw new OpenInLineError(lineAppUrl(config.liffId, window.location.pathname), toLocale(liff.getAppLanguage()), liff.getOS());
    }
    if (!liff.isLoggedIn()) {
      liff.login();
      return new Promise<LiffState>(() => {}); // the page is leaving for LINE Login
    }
  }

  if (!liff.getIDToken()) {
    throw new Error(
      'LINE gave no ID token. The LIFF app needs the openid scope.'
    );
  }
  // LiffState.friendFlag: asked at most once per page load, and its answer kept, a failure's too.
  let friendship: Promise<boolean | null> | null = null;
  const askFriendship = async (): Promise<boolean | null> => {
    // Inside LINE only: the LIFF mock, on the stage and in development, isn't asked, so it can't warn or nudge.
    if (!lineChatUrl(config.lineOaId) || config.liffMock) return null;
    try {
      // Inside the try, so a call that throws counts as failed, as one that rejects does.
      const { friendFlag } = await liff.getFriendship();
      return typeof friendFlag === 'boolean' ? friendFlag : null;
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.warn(FRIENDSHIP_FAILED, error);
      return null;
    }
  };
  return {
    getIdToken: () => liff.getIDToken() ?? '',
    locale: toLocale(liff.getAppLanguage()),
    mock: config.liffMock,
    signInAgain: () => {
      // LINE's way: log out, then reload. Inside LINE, liff.init() signs in again by itself, and liff.login() can't be
      // used there; outside LINE the app never signs in (init() above ends in the "Open in LINE" page). At most once a
      // minute: refused again right after a new sign-in, the app and Strapi disagree about the LINE channel, and the
      // screen shows the error instead.
      // The same minute absorbs a second call for one refusal: maison.ts wraps both getToken() and refresh(), which
      // share one exchange.
      try {
        if (Date.now() - Number(window.sessionStorage.getItem(SIGNED_IN_AGAIN_AT)) < 60_000) return;
        window.sessionStorage.setItem(SIGNED_IN_AGAIN_AT, String(Date.now()));
      } catch {
        return; // without storage a loop can't be told apart: show the error
      }
      liff.logout(); // drops the expired ID token
      window.location.reload();
    },
    friendFlag: () => (friendship ??= askFriendship()),
  };
};

/** Initializes LIFF once per page load; a failed start can be tried again. Browser only. */
export const initLiff = (): Promise<LiffState> =>
  (ready ??= init().catch((error) => {
    ready = null;
    throw error;
  }));
