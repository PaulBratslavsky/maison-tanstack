import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { config } from '../lib/config';
import { readStoredLocale, resolveLocale, storeLocale } from '../lib/locale';
import { getMaison, onToolCall, type Maison } from '../lib/maison';
import type { ToolCallRecord } from '../lib/mcp';
import { OpenInLineError } from '../lib/open-in-line';
import { errorOf, type ScreenError } from '../lib/status';
import type { Locale } from '../lib/types';

interface MaisonContext {
  /** open-in-line: LINE mode outside the LINE app, where the app doesn't sign in. It isn't an error. */
  status: 'starting' | 'ready' | 'error' | 'open-in-line';
  /** The message of a failed sign-in, or null. */
  error: string | null;
  /**
   * The code of a failed sign-in, or null: an OAuth error (temporarily_unavailable, invalid_grant), `network` when
   * Strapi can't be reached, or `error`.
   */
  errorCode: string | null;
  /** A failed sign-in as the screens show it (errorText), with any wait the server named, or null. */
  signInError: ScreenError | null;
  maison: Maison | null;
  /**
   * Whether the customer has added Maison's LINE Official Account (Maison's friendFlag), for the words of "Chat with
   * Maison on LINE": asked once, after sign-in, and null until LINE answers, or when it can't.
   */
  friendFlag: boolean | null;
  /** With status open-in-line: the link that opens this page in LINE, and the OS (a phone gets a button). Else null. */
  openInLine: Pick<OpenInLineError, 'url' | 'os'> | null;
  /**
   * The screens' language: the switch's choice, else LINE's language (at sign-in, or as LINE or the browser reports it
   * for the Open in LINE page), else the demo default (lib/locale.ts).
   */
  locale: Locale;
  calls: ToolCallRecord[];
  agentView: boolean;
  setAgentView: (on: boolean) => void;
  /** The header's language switch: every screen's copy and tool calls follow, and this device remembers it. */
  setLocale: (locale: Locale) => void;
  retrySignIn: () => void;
}

type SignIn = Pick<MaisonContext, 'status' | 'signInError' | 'maison'> & { openInLine: OpenInLineError | null };
const STARTING: SignIn = { status: 'starting', signInError: null, maison: null, openInLine: null };

const Context = createContext<MaisonContext | null>(null);
const AGENT_VIEW_KEY = 'maison.agentView';

/** The browser's localStorage, or null where even reaching it throws (blocked storage). */
const browserStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function MaisonProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SignIn>(STARTING);
  const [friendFlag, setFriendFlag] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [calls, setCalls] = useState<ToolCallRecord[]>([]);
  const [agentView, setAgentViewState] = useState(false);
  const [localeOverride, setLocaleOverride] = useState<Locale | null>(null);

  useEffect(() => {
    try {
      setAgentViewState(window.localStorage.getItem(AGENT_VIEW_KEY) === 'on');
    } catch {
      // storage unavailable: start with the agent view off
    }
    // Read after the first render, like the agent view, so the server's HTML and the first client render match.
    setLocaleOverride(readStoredLocale(browserStorage()));
    return onToolCall((record) => setCalls((previous) => [...previous.slice(-49), record]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState(STARTING);
    getMaison().then(
      (maison) => {
        if (cancelled) return;
        setState({ ...STARTING, status: 'ready', maison });
        // Asked here, once, so every screen's button has the same words from its first render. Without
        // VITE_LINE_OA_ID it's null at once, and LINE isn't asked.
        void maison.friendFlag().then((answer) => {
          if (!cancelled) setFriendFlag(answer);
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        // Outside LINE in LINE mode, the app asks to be opened in LINE: not a failure.
        if (error instanceof OpenInLineError) setState({ ...STARTING, status: 'open-in-line', openInLine: error });
        // A failed fetch (Strapi unreachable) is `network`; a token-endpoint refusal keeps its OAuth code.
        else setState({ ...STARTING, status: 'error', signInError: errorOf(error) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const setAgentView = useCallback((on: boolean) => {
    setAgentViewState(on);
    try {
      window.localStorage.setItem(AGENT_VIEW_KEY, on ? 'on' : 'off');
    } catch {
      // not remembered this time
    }
  }, []);
  const setLocale = useCallback((locale: Locale) => {
    setLocaleOverride(locale);
    storeLocale(browserStorage(), locale);
  }, []);
  const retrySignIn = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<MaisonContext>(
    () => ({
      ...state,
      error: state.signInError?.message ?? null,
      errorCode: state.signInError?.code ?? null,
      // The Open in LINE page's language, as LINE or the browser reports it, takes the place of the signed-in one.
      locale: resolveLocale({
        override: localeOverride,
        signedIn: state.maison?.locale ?? state.openInLine?.locale ?? null,
        demo: config.demoLocale,
      }),
      friendFlag,
      calls,
      agentView,
      setAgentView,
      setLocale,
      retrySignIn,
    }),
    [state, friendFlag, localeOverride, calls, agentView, setAgentView, setLocale, retrySignIn]
  );

  // Screen readers and the browser's font choice follow the language. The server renders lang="ja" (routes/__root.tsx);
  // this runs right after the first paint.
  useEffect(() => {
    document.documentElement.lang = value.locale;
  }, [value.locale]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useMaison = (): MaisonContext => {
  const context = useContext(Context);
  if (!context) throw new Error('useMaison must be used inside <MaisonProvider>');
  return context;
};
