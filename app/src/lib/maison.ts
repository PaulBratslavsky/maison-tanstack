import { config } from './config';
import { type LiffState, initLiff } from './liff';
import { type ToolCallRecord, createMcp } from './mcp';
import { type Session, SessionError, createSession } from './session';
import type { Locale } from './types';

export interface Maison {
  locale: Locale;
  mock: boolean;
  session: Session;
  callTool: ReturnType<typeof createMcp>['callTool'];
  /** Whether the customer has added Maison's LINE Official Account, or null: LIFF's answer (LiffState.friendFlag). */
  friendFlag: LiffState['friendFlag'];
}

type Listener = (record: ToolCallRecord) => void;
const listeners = new Set<Listener>();

/** Subscribe to every tool call the screens make. Returns the unsubscribe function. */
export const onToolCall = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Every listener hears every record. One that throws is logged and skipped: it can't hide the record from the rest. */
const notifyListeners = (record: ToolCallRecord) =>
  listeners.forEach((listener) => {
    try {
      listener(record);
    } catch (error) {
      console.error('A tool-call listener threw.', error);
    }
  });

let maison: Promise<Maison> | null = null;

const start = async (): Promise<Maison> => {
  if (!config.clientId)
    throw new Error(
      'VITE_MAISON_CLIENT_ID is not set. Run `npm run setup` and restart the app.'
    );
  const liff = await initLiff();
  const exchange = createSession({
    strapiUrl: config.strapiUrl,
    clientId: config.clientId,
    getIdToken: liff.getIdToken,
  });
  // invalid_grant: LINE refused the ID token. Inside LINE a new login fixes that. The mock's tokens don't expire,
  // so there it means the app and Strapi disagree about the LINE channel, and the screen shows the error.
  const signInAgainIfRefused = <T>(promise: Promise<T>): Promise<T> =>
    promise.catch((error: unknown) => {
      if (error instanceof SessionError && error.signInAgain && !liff.mock)
        liff.signInAgain();
      throw error;
    });
  const session: Session = {
    getToken: () => signInAgainIfRefused(exchange.getToken()),
    refresh: () => signInAgainIfRefused(exchange.refresh()),
  };
  await session.getToken(); // sign in now, so the first screen doesn't wait for it
  const mcp = createMcp({
    strapiUrl: config.strapiUrl,
    session,
    onRecord: notifyListeners,
  });
  return {
    locale: liff.locale,
    mock: liff.mock,
    session,
    callTool: mcp.callTool,
    friendFlag: liff.friendFlag,
  };
};

/** LINE sign-in, the customer session and the MCP connection, set up once per page load. Browser only. */
export const getMaison = (): Promise<Maison> =>
  (maison ??= start().catch((error) => {
    maison = null; // so "Try again" starts over
    throw error;
  }));
