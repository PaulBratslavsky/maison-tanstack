import { describe, expect, it } from 'vitest';

import { requireLocalMode, strapiOrigin } from '../../e2e/env';

// The Playwright tests and the live tests call these before anything else. They live in e2e/, which Vitest does not scan
// (and a `.test.ts` there would be picked up by Playwright), so this suite sits in src/lib.

describe('requireLocalMode', () => {
  it('refuses to go on when VITE_LIFF_MOCK is false, and says what to change', () => {
    expect(() => requireLocalMode({ VITE_LIFF_MOCK: 'false' })).toThrow(/need the LIFF mock.*VITE_LIFF_MOCK to true in app\/\.env/);
  });

  it('ignores spaces around the value', () => {
    expect(() => requireLocalMode({ VITE_LIFF_MOCK: ' false\n' })).toThrow();
  });

  it('goes on when VITE_LIFF_MOCK is true, empty or not set', () => {
    expect(() => requireLocalMode({ VITE_LIFF_MOCK: 'true' })).not.toThrow();
    expect(() => requireLocalMode({ VITE_LIFF_MOCK: '' })).not.toThrow();
    expect(() => requireLocalMode({})).not.toThrow();
  });

  it('reads the process environment when it is given none', () => {
    const kept = process.env.VITE_LIFF_MOCK;
    try {
      process.env.VITE_LIFF_MOCK = 'false';
      expect(() => requireLocalMode()).toThrow();
      process.env.VITE_LIFF_MOCK = 'true';
      expect(() => requireLocalMode()).not.toThrow();
    } finally {
      if (kept === undefined) delete process.env.VITE_LIFF_MOCK;
      else process.env.VITE_LIFF_MOCK = kept;
    }
  });
});

describe('strapiOrigin', () => {
  it('is STRAPI_URL without trailing slashes, else Strapi on this machine', () => {
    expect(strapiOrigin({ STRAPI_URL: 'http://127.0.0.1:1339//' })).toBe('http://127.0.0.1:1339');
    expect(strapiOrigin({ STRAPI_URL: '' })).toBe('http://127.0.0.1:1339');
    expect(strapiOrigin({})).toBe('http://127.0.0.1:1339');
  });
});
