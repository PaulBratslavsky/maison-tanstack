import { describe, expect, it } from 'vitest';

import { strapiOrigin } from './strapi-origin';

describe('strapiOrigin', () => {
  it("is STRAPI_URL without a trailing slash, else Strapi's default address", () => {
    expect(strapiOrigin({ STRAPI_URL: 'http://strapi.test:1339/' })).toBe('http://strapi.test:1339');
    expect(strapiOrigin({ STRAPI_URL: 'http://strapi.test///' })).toBe('http://strapi.test');
    expect(strapiOrigin({})).toBe('http://127.0.0.1:1339');
    expect(strapiOrigin({ STRAPI_URL: '' })).toBe('http://127.0.0.1:1339');
  });

  it('never reads VITE_STRAPI_URL, which in LINE mode is the app itself', () => {
    expect(strapiOrigin({ VITE_STRAPI_URL: 'https://app.example.com' })).toBe('http://127.0.0.1:1339');
  });
});
