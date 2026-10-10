import { requireLocalMode, strapiOrigin } from './env';

/**
 * Playwright waits for the app, which is up before Strapi when `npm run dev` starts both. So wait here for Strapi's health
 * check, for up to two minutes.
 */
const waitForStrapi = async (strapiUrl: string) => {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      if ((await fetch(`${strapiUrl}/_health`)).status === 204) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`Strapi did not answer at ${strapiUrl} within two minutes.`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

/**
 * Signs in as the demo admin, deletes demo appointments so each run starts clean (a customer may only have three
 * open requests), and hands the admin session to the API tests. Workers start after this and inherit process.env.
 * Only in local mode, and on this machine: never through VITE_STRAPI_URL, which in LINE mode is the tunnel.
 */
export default async function globalSetup() {
  requireLocalMode();
  const strapiUrl = strapiOrigin();
  await waitForStrapi(strapiUrl);
  const email = process.env.DEMO_ADMIN_EMAIL;
  const password = process.env.DEMO_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Run the tests with `npm run test:e2e`, which loads DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD from strapi/.env.');
  }
  const login = await fetch(`${strapiUrl}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) {
    throw new Error(`Admin sign-in failed with ${login.status}${login.status === 429 ? ': Strapi allows five sign-ins per five minutes' : ''}.`);
  }
  const { data } = (await login.json()) as { data: { token: string } };
  const reset = await fetch(`${strapiUrl}/maison/demo/reset`, { method: 'POST', headers: { Authorization: `Bearer ${data.token}` } });
  if (!reset.ok) throw new Error(`Resetting demo appointments failed with ${reset.status}`);
  process.env.MAISON_E2E_ADMIN_JWT = data.token;
}
