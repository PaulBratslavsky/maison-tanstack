import { describe, expect, it } from 'vitest';
import { authorizationOf, bearerTokenOf, lineUserIdOf, maskSubject, parseSubject } from '../../server/src/domain/subject';

const VALID = 'line:U4af4980629c1a7b3f1e2d3c4b5a69788';

describe('parseSubject', () => {
  it('accepts a line subject with 32 lowercase hex characters', () => {
    expect(parseSubject(VALID)).toBe(VALID);
  });

  it.each([
    ['uppercase hex', 'line:U4AF4980629C1A7B3F1E2D3C4B5A69788'],
    ['surrounding spaces', ` ${VALID} `],
    ['missing prefix', 'U4af4980629c1a7b3f1e2d3c4b5a69788'],
    ['two values joined by a proxy', `${VALID}, ${VALID}`],
    ['too short', 'line:U4af498'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(parseSubject(value)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseSubject(undefined)).toBeNull();
    expect(parseSubject(42)).toBeNull();
  });
});

describe('authorizationOf', () => {
  it('returns a single authorization header value', () => {
    expect(authorizationOf({ authorization: 'Bearer abc' })).toBe('Bearer abc');
  });

  it('returns null for a missing, empty or repeated header', () => {
    expect(authorizationOf(undefined)).toBeNull();
    expect(authorizationOf({})).toBeNull();
    expect(authorizationOf({ authorization: '' })).toBeNull();
    expect(authorizationOf({ authorization: ['Bearer a', 'Bearer b'] })).toBeNull();
  });
});

describe('bearerTokenOf', () => {
  it('returns the token of a Bearer header, read the way oauth-mcp-manager reads it', () => {
    expect(bearerTokenOf('Bearer mcp_at_abc')).toBe('mcp_at_abc');
    expect(bearerTokenOf('bearer   mcp_at_abc')).toBe('mcp_at_abc');
  });

  it.each([
    ['no header', null],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['no token', 'Bearer '],
    ['two tokens', 'Bearer a b'],
  ])('returns null for %s', (_label, value) => {
    expect(bearerTokenOf(value)).toBeNull();
  });
});

describe('lineUserIdOf', () => {
  it('strips the line: prefix', () => {
    expect(lineUserIdOf(VALID)).toBe('U4af4980629c1a7b3f1e2d3c4b5a69788');
  });
});

describe('maskSubject', () => {
  it('keeps the prefix, three characters and the last two', () => {
    expect(maskSubject(VALID)).toBe('line:U4af…88');
  });

  it('never contains the LINE user ID', () => {
    expect(maskSubject(VALID)).not.toContain(lineUserIdOf(VALID));
  });

  it.each([
    ['uppercase hex', 'line:U4AF4980629C1A7B3F1E2D3C4B5A69788'],
    ['surrounding spaces', ` ${VALID} `],
    ['empty', ''],
    ['null', null],
  ])('returns "unknown" for %s', (_label, value) => {
    expect(maskSubject(value)).toBe('unknown');
  });
});
