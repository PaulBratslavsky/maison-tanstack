// Server only: it reads STRAPI_URL from process.env, which the browser never has. Import it from a server function
// (task 3B wraps readHomePage in one), never from a component.
import { COPY } from './copy';
import type { Locale } from './types';

/**
 * Where the app's server reaches Strapi: STRAPI_URL, else Strapi's default address. Never VITE_STRAPI_URL, which in
 * LINE mode is the app's own public address, so a call to it would reach the app itself.
 */
const strapiOrigin = (env: Record<string, string | undefined> = process.env) =>
  (env.STRAPI_URL || 'http://127.0.0.1:1339').replace(/\/+$/, '');

/** The Home page's words in one language. The intro is optional: null means Home shows none. */
export interface HomeText {
  eyebrow: string;
  headline: string;
  intro: string | null;
  ctaLabel: string;
}

/** A string with something in it, without the spaces around it, or null. */
const filled = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** The text in Strapi's answer (its `data`), or null when the eyebrow, the headline or the CTA's label is missing or blank. */
const homeTextOf = (data: unknown): HomeText | null => {
  const fields = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const [eyebrow, headline, ctaLabel] = [filled(fields.eyebrow), filled(fields.headline), filled(fields.ctaLabel)];
  return eyebrow && headline && ctaLabel ? { eyebrow, headline, intro: filled(fields.intro), ctaLabel } : null;
};

/** Why a request failed, for the server's log: a fetch that couldn't connect names the cause, such as ECONNREFUSED. */
const failure = (error: unknown, timeoutMs: number): string => {
  if ((error as { name?: unknown } | null)?.name === 'TimeoutError') return `Strapi didn't answer within ${timeoutMs} ms`;
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return `the request failed: ${String(error)}${typeof code === 'string' ? ` (${code})` : ''}`;
};

/** One language: Strapi's published text, or else the built-in text, with the reason on the server's log. */
const readLocale = async (locale: Locale, fetchImpl: typeof fetch, timeoutMs: number): Promise<HomeText> => {
  let problem: string;
  try {
    const response = await fetchImpl(`${strapiOrigin()}/api/home-page?locale=${locale}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 200) {
      const text = homeTextOf(((await response.json()) as { data?: unknown } | null)?.data);
      if (text) return text;
      problem = 'its eyebrow, headline or ctaLabel is missing or blank';
    } else {
      problem = `Strapi answered ${response.status}`;
    }
  } catch (error) {
    problem = failure(error, timeoutMs);
  }
  console.warn(`Home page (${locale}): ${problem}, so Home shows the built-in text.`);
  return { ...COPY[locale].home, intro: null };
};

/**
 * The Home page's text in both languages, for Home's server function. It hands both to the client screen, so the
 * language switch stays instant. Server only: it reaches Strapi the way the app's server does, at strapiOrigin(), never
 * at VITE_STRAPI_URL, which in LINE mode is the app's own public address.
 *
 * The text is Strapi's Home page single type (api::home-page.home-page), as published, asked for on every request (no
 * cache), for both languages at once, each within `timeoutMs`. A language falls back to the built-in text (lib/copy.ts,
 * the same words as Strapi's starting text) when its request fails or times out, when Strapi answers anything but 200,
 * or when its eyebrow, headline or CTA label is missing or blank. The other language keeps Strapi's text. A blank intro
 * is no reason to fall back: it means there's none. `fetchImpl` and `timeoutMs` are for the tests.
 */
export async function readHomePage({
  fetchImpl = fetch,
  timeoutMs = 1000,
}: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<{ en: HomeText; ja: HomeText }> {
  const [en, ja] = await Promise.all([readLocale('en', fetchImpl, timeoutMs), readLocale('ja', fetchImpl, timeoutMs)]);
  return { en, ja };
}
