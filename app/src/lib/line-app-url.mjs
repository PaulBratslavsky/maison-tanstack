// One implementation for the app (components/open-in-line.tsx, by way of lib/liff.ts) and for `npm run qr`
// (scripts/line-qr.mjs), so the page and the QR code always give the same link. Plain JavaScript, so Node runs the
// script without a build; line-app-url.d.mts types it for the app.

/**
 * The link that opens a page of the app inside LINE: https://liff.line.me/<LIFF ID>, plus the page's path when it isn't
 * the start page. LINE passes the path on to the app, so `/visits` opens on My visits.
 * Pass location.pathname: a query string or a hash can carry LINE's tokens or codes, and anything from a `?` or a `#`
 * on is dropped here too. Repeated slashes collapse, a trailing slash goes, and a missing leading slash is added.
 */
export const lineAppUrl = (liffId, pathname) => {
  const path = `/${String(pathname).split(/[?#]/, 1)[0]}`.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return `https://liff.line.me/${liffId}${path}`;
};
