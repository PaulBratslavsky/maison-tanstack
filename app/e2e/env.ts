/**
 * Where the tests reach Strapi: STRAPI_URL from app/.env, else Strapi's address on this machine. This is the same setting
 * the app's server reads.
 */
export const strapiOrigin = (env: Record<string, string | undefined> = process.env) =>
  (env.STRAPI_URL || 'http://127.0.0.1:1339').replace(/\/+$/, '');

/**
 * Refuses to go on when the app is set up for LINE (VITE_LIFF_MOCK is false). The tests sign in with the LIFF mock and the
 * local verify mock, sign in to Strapi as the demo admin and reset the demo's visits.
 */
export const requireLocalMode = (env: Record<string, string | undefined> = process.env): void => {
  if ((env.VITE_LIFF_MOCK ?? '').trim() === 'false') {
    throw new Error('These tests need the LIFF mock. Set VITE_LIFF_MOCK to true in app/.env, then restart Strapi and the app.');
  }
};
