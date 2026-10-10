import { tunnelHeaders } from './tunnel';

export const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const ID_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token';

/** A failed token exchange. `code` is the OAuth error, e.g. invalid_grant or temporarily_unavailable. */
export class SessionError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = 'SessionError';
  }

  /** invalid_grant: LINE refused the ID token (invalid or expired). Only a new LINE sign-in helps. */
  get signInAgain(): boolean {
    return this.code === 'invalid_grant';
  }

  /** temporarily_unavailable (503): LINE couldn't be reached, or the LINE client needs an admin. Try again later. */
  get retryLater(): boolean {
    return this.code === 'temporarily_unavailable';
  }
}

export interface SessionOptions {
  strapiUrl: string;
  clientId: string;
  getIdToken: () => string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The longest the app waits for its one automatic retry, so a screen never hangs. A longer Retry-After isn't
 * waited out: the error carries it (`retryAfterSeconds`), so the screen can say when to try again.
 */
const MAX_RETRY_WAIT_SECONDS = 10;
const DEFAULT_RETRY_WAIT_SECONDS = 5;

/**
 * A customer's MCP session: the LINE ID token exchanged at oauth-mcp-manager's token endpoint.
 * Kept in memory only. There is no refresh token, so it exchanges the ID token again when needed.
 */
export const createSession = ({
  strapiUrl,
  clientId,
  getIdToken,
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: SessionOptions) => {
  let current: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  const exchangeOnce = async (): Promise<string> => {
    const response = await fetchImpl(
      `${strapiUrl}/api/strapi-oauth-mcp-manager/oauth/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...tunnelHeaders(strapiUrl),
        },
        body: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE,
          client_id: clientId,
          subject_token: getIdToken(),
          subject_token_type: ID_TOKEN_TYPE,
          resource: `${strapiUrl}/mcp`,
        }),
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.access_token !== 'string') {
      // Strapi's CORS settings expose Retry-After to the app (Task 1).
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new SessionError(
        body.error ?? 'server_error',
        body.error_description ?? `Sign-in failed (${response.status})`,
        retryAfter > 0 ? retryAfter : null
      );
    }
    current = {
      token: body.access_token,
      expiresAt: now() + (Number(body.expires_in) || 3600) * 1000,
    };
    return current.token;
  };

  /**
   * One exchange. temporarily_unavailable is retried once, after Retry-After, when that is 10 seconds or less
   * (5 when it says nothing). A longer wait fails at once. invalid_grant is never retried.
   */
  const exchange = async (): Promise<string> => {
    try {
      return await exchangeOnce();
    } catch (error) {
      if (!(error instanceof SessionError) || !error.retryLater) throw error;
      const wait = error.retryAfterSeconds ?? DEFAULT_RETRY_WAIT_SECONDS;
      if (wait > MAX_RETRY_WAIT_SECONDS) throw error;
      await sleep(wait * 1000);
      return exchangeOnce();
    }
  };

  /**
   * A new exchange. Concurrent callers share it.
   * It drops the token handed out so far: that one was just refused (or is about to expire), so it isn't handed out
   * again while the exchange is under way, or after it fails. `getToken()` joins the exchange instead.
   */
  const refresh = (): Promise<string> => {
    if (!pending) {
      current = null;
      pending = exchange().finally(() => {
        pending = null;
      });
    }
    return pending;
  };

  return {
    /** The current session token, or a new one when there is none or it expires within a minute. */
    async getToken(): Promise<string> {
      if (current && current.expiresAt - now() > 60_000) return current.token;
      return refresh();
    },
    refresh,
  };
};

export type Session = ReturnType<typeof createSession>;
