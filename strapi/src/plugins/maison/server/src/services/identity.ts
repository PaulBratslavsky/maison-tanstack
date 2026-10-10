import type { Core } from '@strapi/strapi';

import { OAUTH_PLUGIN_ID } from '../constants';
import { authorizationOf, bearerTokenOf, parseSubject } from '../domain/subject';

export interface HandlerExtra {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> };
}

/**
 * Who is calling: a LINE customer, or nobody. Or unknown: `unavailable` because customer sign-in isn't installed,
 * `error` because checking the session failed on the server, which is no reason to sign the customer out.
 */
export type CustomerSession =
  | { status: 'signed_in'; subject: string }
  | { status: 'signed_out' }
  | { status: 'unavailable' }
  | { status: 'error' };

/** oauth-mcp-manager's resolveAccessToken: { valid: true, adminAccessKey, grantId } or { valid: false, reason }. */
type ResolveAccessToken = (accessToken: string) => Promise<{ valid?: unknown } | null | undefined>;

/** The parts of oauth-mcp-manager's oauth service (1.1) Maison uses. */
interface OAuthService {
  resolveAccessToken?: ResolveAccessToken;
  /** The customer a session belongs to: 'line:U…', or null. It doesn't check the session itself. */
  resolveSubject?: (authorization: string) => Promise<unknown>;
}

/**
 * Whether the session behind `authorization` passes /mcp's session check: oauth-mcp-manager's resolveAccessToken, which
 * refuses an unknown, expired, revoked or rotated token, a key it can't decrypt, and an inactive user. /mcp goes
 * further in two ways: Strapi core also refuses the session once its admin token has expired (checkExpiry), and each
 * tool needs its own permission on that admin token. Only `valid` is read: the decrypted admin key that comes with a
 * valid session is neither kept nor logged.
 */
const sessionAccepted = async (resolveAccessToken: ResolveAccessToken, authorization: string): Promise<boolean> => {
  const token = bearerTokenOf(authorization);
  if (!token) return false;
  const { valid } = (await resolveAccessToken(token)) ?? {};
  return valid === true;
};

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const oauthService = (): OAuthService | undefined => {
    try {
      return strapi.plugin(OAUTH_PLUGIN_ID)?.service('oauth') as OAuthService | undefined;
    } catch {
      return undefined;
    }
  };

  /**
   * The LINE customer behind a raw Authorization header: one code path for the MCP tools and the REST routes.
   * It runs /mcp's session check unless `sessionValidated` says /mcp already has, and then asks oauth-mcp-manager whose
   * session it is. Anything but a LINE subject is signed out: staff sessions, admin and API tokens, users-permissions
   * JWTs, and unknown, expired, revoked or rotated sessions. A lookup that throws is an error, not a sign-out. It never
   * logs the header, the subject, or a resolver's error message, which could quote either.
   *
   * `sessionValidated` is true only for an MCP tool call, whose request /mcp's middleware has already checked with
   * resolveAccessToken: an invalid session never reaches a tool. It stays inside this service, so app code can't skip
   * the check.
   */
  const resolveCustomer = async (authorization: string | null, sessionValidated: boolean): Promise<CustomerSession> => {
    const oauth = oauthService();
    // Bound, because the service's methods use `this` (resolveAccessToken revokes a rotated grant through it).
    const resolveSubject = typeof oauth?.resolveSubject === 'function' ? oauth.resolveSubject.bind(oauth) : null;
    const resolveAccessToken = typeof oauth?.resolveAccessToken === 'function' ? oauth.resolveAccessToken.bind(oauth) : null;
    if (!resolveSubject || (!resolveAccessToken && !sessionValidated)) return { status: 'unavailable' };
    if (!authorization) return { status: 'signed_out' };
    try {
      if (!sessionValidated) {
        const accepted = resolveAccessToken !== null && (await sessionAccepted(resolveAccessToken, authorization));
        if (!accepted) return { status: 'signed_out' };
      }
      const subject = parseSubject(await resolveSubject(authorization));
      return subject ? { status: 'signed_in', subject } : { status: 'signed_out' };
    } catch (error) {
      strapi.log.warn(`[maison] Checking a customer session failed (${(error as Error)?.name ?? 'unknown error'}), so the request has no customer.`);
      return { status: 'error' };
    }
  };

  return {
    /**
     * The customer behind an Authorization header, for routes of your own: it always runs /mcp's session check
     * first, then resolves the customer.
     */
    customerSession: (authorization: string | null): Promise<CustomerSession> => resolveCustomer(authorization, false),

    /**
     * The verified LINE subject of the MCP caller, or null.
     * Tools see the caller's original Authorization header (Strapi builds tool-visible headers from the raw request).
     * oauth-mcp-manager's /mcp middleware has already run resolveAccessToken on it, so this only resolves the customer.
     */
    async getCustomerSubject(extra: HandlerExtra | undefined): Promise<string | null> {
      const session = await resolveCustomer(authorizationOf(extra?.requestInfo?.headers), true);
      return session.status === 'signed_in' ? session.subject : null;
    },
  };
};
