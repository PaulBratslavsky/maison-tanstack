const SUBJECT_PATTERN = /^line:U[0-9a-f]{32}$/;

/** Returns the subject if it is exactly `line:U` + 32 lowercase hex characters, else null. */
export const parseSubject = (value: unknown): string | null =>
  typeof value === 'string' && SUBJECT_PATTERN.test(value) ? value : null;

export const lineUserIdOf = (subject: string): string => subject.slice('line:'.length);

/**
 * The caller's raw Authorization header from the MCP handler context (`extra.requestInfo.headers`).
 * Keys there are lowercase. Only a single non-empty string is usable.
 */
export const authorizationOf = (
  headers: Record<string, string | string[] | undefined> | undefined
): string | null => {
  const value = headers?.authorization;
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/** The token in `Bearer <token>`, or null. Read the way oauth-mcp-manager reads it, so both agree on what the token is. */
export const bearerTokenOf = (authorization: string | null): string | null =>
  /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1] ?? null;

/** A customer as staff see them, e.g. `line:U4af…88`. Never the full subject; anything that isn't one is "unknown". */
export const maskSubject = (value: unknown): string => {
  const subject = parseSubject(value);
  return subject ? `${subject.slice(0, 'line:U'.length + 3)}…${subject.slice(-2)}` : 'unknown';
};
