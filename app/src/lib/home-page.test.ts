import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { COPY } from './copy';
import { readHomePage } from './home-page';

type Locale = 'en' | 'ja';
/** What the stand-in Strapi does for one language: answer (a status and a JSON body, or raw text), throw, or hang. */
type Answer = { status?: number; body?: unknown; text?: string } | Error | 'hang';

/**
 * A stand-in for Strapi's REST API, answering by the URL's locale and recording each request. A hanging answer settles
 * only when the request's signal aborts, with the signal's reason, as fetch does.
 */
const fakeStrapi = (answers: Partial<Record<Locale, Answer>>) => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push({ url, init });
    const answer = answers[new URL(url).searchParams.get('locale') as Locale] ?? { status: 404, body: NOT_FOUND };
    if (answer instanceof Error) throw answer;
    if (answer === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    }
    const status = answer.status ?? 200;
    return answer.text !== undefined ? new Response(answer.text, { status }) : Response.json(answer.body ?? {}, { status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests };
};

/** Strapi 5's answer for a published single type: its fields flat under `data`. */
const published = (locale: Locale, fields: Record<string, unknown>) => ({
  status: 200,
  body: { data: { id: 2, documentId: 'x1home', locale, publishedAt: '2026-10-01T09:00:00.000Z', ...fields }, meta: {} },
});
const NOT_FOUND = { data: null, error: { status: 404, name: 'NotFoundError', message: 'Not Found', details: {} } };

// What an editor might publish: not the built-in words, so the tests can tell the two apart.
const EN = { eyebrow: 'Wrapped by hand', headline: 'A gift worth the journey.', ctaLabel: 'Talk to the concierge' };
const JA = { eyebrow: '手で包む贈り物', headline: '足を運ぶ価値のある一品を。', ctaLabel: 'コンシェルジュと話す' };
// The built-in text: lib/copy.ts, the same words as Strapi's starting text (task FD), and never an intro.
const BUILT_IN = {
  en: { eyebrow: 'Gifts, chosen with care', headline: 'Find the right piece. See it in person.', intro: null, ctaLabel: 'Ask the concierge' },
  ja: { eyebrow: '心を込めて選ぶ、贈り物', headline: 'ふさわしい一品を。店頭で、お手に取って。', intro: null, ctaLabel: 'コンシェルジュに相談する' },
};

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  vi.stubEnv('STRAPI_URL', 'http://127.0.0.1:1339');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('the built-in Home text (lib/copy.ts)', () => {
  it("holds Strapi's starting text, word for word, in both languages", () => {
    expect(COPY.en.home).toEqual({ eyebrow: BUILT_IN.en.eyebrow, headline: BUILT_IN.en.headline, ctaLabel: BUILT_IN.en.ctaLabel });
    expect(COPY.ja.home).toEqual({ eyebrow: BUILT_IN.ja.eyebrow, headline: BUILT_IN.ja.headline, ctaLabel: BUILT_IN.ja.ctaLabel });
  });
});

describe('readHomePage', () => {
  it("shows the published text when it arrives, in each language", async () => {
    const { fetchImpl } = fakeStrapi({ en: published('en', EN), ja: published('ja', { ...JA, intro: '銀座と表参道でお待ちしています。' }) });
    expect(await readHomePage({ fetchImpl })).toEqual({
      en: { ...EN, intro: null },
      ja: { ...JA, intro: '銀座と表参道でお待ちしています。' },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("asks Strapi where the app's server reaches it, never at VITE_STRAPI_URL: each language, uncached, with a 1 s timeout", async () => {
    vi.stubEnv('STRAPI_URL', 'http://strapi.internal:1339/');
    vi.stubEnv('VITE_STRAPI_URL', 'https://maison.example');
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { fetchImpl, requests } = fakeStrapi({ en: published('en', EN), ja: published('ja', JA) });
    await readHomePage({ fetchImpl });
    expect(requests.map((request) => request.url).sort()).toEqual([
      'http://strapi.internal:1339/api/home-page?locale=en',
      'http://strapi.internal:1339/api/home-page?locale=ja',
    ]);
    for (const { init } of requests) {
      expect(init?.cache).toBe('no-store');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(timeout.mock.calls).toEqual([[1000], [1000]]);
  });

  it("reaches Strapi on its default address when STRAPI_URL isn't set", async () => {
    vi.stubEnv('STRAPI_URL', '');
    const { fetchImpl, requests } = fakeStrapi({ en: published('en', EN), ja: published('ja', JA) });
    await readHomePage({ fetchImpl });
    expect(requests.map((request) => request.url).sort()).toEqual([
      'http://127.0.0.1:1339/api/home-page?locale=en',
      'http://127.0.0.1:1339/api/home-page?locale=ja',
    ]);
  });

  it.each([404, 403, 500, 503])('falls back to the built-in text for a language Strapi answers %i, and keeps the other', async (status) => {
    const { fetchImpl } = fakeStrapi({ en: { status, body: status === 404 ? NOT_FOUND : { data: null } }, ja: published('ja', JA) });
    expect(await readHomePage({ fetchImpl })).toEqual({ en: BUILT_IN.en, ja: { ...JA, intro: null } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('(en)');
    expect(warn.mock.calls[0][0]).toContain(String(status));
  });

  it('treats any answer but 200 as no page, even a success with another status', async () => {
    const { fetchImpl } = fakeStrapi({ en: { ...published('en', EN), status: 203 }, ja: published('ja', JA) });
    expect((await readHomePage({ fetchImpl })).en).toEqual(BUILT_IN.en);
  });

  it('falls back when the fetch throws: Strapi is down', async () => {
    const { fetchImpl } = fakeStrapi({ en: published('en', EN), ja: new TypeError('fetch failed') });
    expect(await readHomePage({ fetchImpl })).toEqual({ en: { ...EN, intro: null }, ja: BUILT_IN.ja });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('(ja)');
  });

  it("falls back when Strapi doesn't answer in time, asking for both languages at once so the wait is one timeout", async () => {
    const { fetchImpl, requests } = fakeStrapi({ en: 'hang', ja: 'hang' });
    const reading = readHomePage({ fetchImpl, timeoutMs: 50 });
    expect(requests).toHaveLength(2); // both asked before either answered
    expect(await reading).toEqual(BUILT_IN);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map(([message]) => String(message)).every((message) => message.includes('50 ms'))).toBe(true);
  });

  it("falls back when the answer isn't the page: not JSON, or no data", async () => {
    const notJson = fakeStrapi({ en: { status: 200, text: '<html>Bad gateway</html>' }, ja: { status: 200, body: { data: null, meta: {} } } });
    expect(await readHomePage({ fetchImpl: notJson.fetchImpl })).toEqual(BUILT_IN);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['eyebrow', ''],
    ['headline', '   '],
    ['ctaLabel', null],
    ['headline', undefined],
    ['eyebrow', 42],
  ])('falls back for that language only when a required field (%s) is blank or missing: %j', async (field, value) => {
    const fields: Record<string, unknown> = { ...JA, intro: '銀座でお待ちしています。' };
    if (value === undefined) delete fields[field];
    else fields[field] = value;
    const { fetchImpl } = fakeStrapi({ en: published('en', EN), ja: published('ja', fields) });
    // The other fields don't stay: the language's whole text is the built-in one, with no intro.
    expect(await readHomePage({ fetchImpl })).toEqual({ en: { ...EN, intro: null }, ja: BUILT_IN.ja });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('(ja)');
  });

  it.each([
    ['blank', ''],
    ['only spaces', '  \n '],
    ['null', null],
    ['missing', undefined],
  ])('takes an intro that is %s as no intro, not as a reason to fall back', async (_case, intro) => {
    const fields: Record<string, unknown> = { ...EN };
    if (intro !== undefined) fields.intro = intro;
    const { fetchImpl } = fakeStrapi({ en: published('en', fields), ja: published('ja', JA) });
    expect((await readHomePage({ fetchImpl })).en).toEqual({ ...EN, intro: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps an intro that is set, and trims the spaces around every field', async () => {
    const { fetchImpl } = fakeStrapi({
      en: published('en', { eyebrow: ' Wrapped by hand ', headline: 'A gift worth the journey.\n', ctaLabel: '  Talk to the concierge', intro: '  Two boutiques, one concierge.\n\nBook a visit.  ' }),
      ja: published('ja', JA),
    });
    expect((await readHomePage({ fetchImpl })).en).toEqual({ ...EN, intro: 'Two boutiques, one concierge.\n\nBook a visit.' });
  });
});
