import { describe, expect, it } from 'vitest';

import { lineAppUrl } from './line-app-url.mjs';

// A made-up LIFF ID. Never a real one in this repo.
const LIFF_ID = '1234567890-AbcdEfgh';
const BASE = `https://liff.line.me/${LIFF_ID}`;

describe('lineAppUrl', () => {
  it.each([
    ['/', BASE],
    ['', BASE],
    ['/visits', `${BASE}/visits`],
    ['/products/weekender-50', `${BASE}/products/weekender-50`],
    ['/visits/MSN-7KQ2', `${BASE}/visits/MSN-7KQ2`],
    ['visits', `${BASE}/visits`], // the leading slash is added
    ['/visits/', `${BASE}/visits`], // a trailing slash goes
    ['//products//weekender-50//', `${BASE}/products/weekender-50`], // repeated slashes collapse
    ['///', BASE],
  ])('%j opens %s', (pathname, url) => {
    expect(lineAppUrl(LIFF_ID, pathname)).toBe(url);
  });

  it("never carries a query string or a hash, which can hold LINE's tokens or codes", () => {
    expect(lineAppUrl(LIFF_ID, '/visits?code=abc&liffClientId=x#access_token=y')).toBe(`${BASE}/visits`);
    expect(lineAppUrl(LIFF_ID, '/?liff.state=%2Fvisits')).toBe(BASE);
    expect(lineAppUrl(LIFF_ID, '/#id_token=y')).toBe(BASE);
  });
});
