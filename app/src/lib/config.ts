/** Public settings. Vite inlines VITE_* at build time, so each is read by its full name. */
export const config = {
  strapiUrl: (
    import.meta.env.VITE_STRAPI_URL ?? 'http://localhost:1339'
  ).replace(/\/+$/, ''),
  clientId: import.meta.env.VITE_MAISON_CLIENT_ID ?? '',
  liffMock: import.meta.env.VITE_LIFF_MOCK !== 'false',
  liffId: import.meta.env.VITE_LIFF_ID ?? '',
  // Maison's LINE Official Account, by its basic ID with the @: "Chat with Maison on LINE" (lib/line-chat.ts).
  lineOaId: import.meta.env.VITE_LINE_OA_ID ?? '',
  demoLineUserId:
    import.meta.env.VITE_DEMO_LINE_USER_ID ||
    'U4af4980629c1a7b3f1e2d3c4b5a69788',
  demoLocale: import.meta.env.VITE_DEMO_LOCALE || 'en',
};
