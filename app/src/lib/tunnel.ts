/**
 * Headers for the browser's own calls in LINE mode. There the app is served through an ngrok tunnel, and the browser
 * reaches Strapi's paths on the app's own origin (the app proxies them). On ngrok's free plan a browser request gets a
 * warning page (ERR_NGROK_6024) instead of the answer until the visitor has clicked through it, and this header skips
 * it: https://ngrok.com/docs/pricing-limits/free-plan-limits/#removing-the-interstitial-page
 * Sent only when `strapiUrl` is the page's own origin. Cross-origin (local mode) Strapi's CORS settings don't allow
 * it, and on the server there's no tunnel in the way.
 */
export const tunnelHeaders = (strapiUrl: string): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    return new URL(strapiUrl).origin === window.location.origin ? { 'ngrok-skip-browser-warning': '1' } : {};
  } catch {
    return {};
  }
};
