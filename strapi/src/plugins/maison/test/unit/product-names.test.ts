import { describe, expect, it, vi } from 'vitest';
import { UID } from '../../server/src/constants';
import services from '../../server/src/services';
import { productNamed, rememberProductNames } from '../../server/src/services/product-names';
import { fakeStrapi } from './fake-strapi';

type Doc = Record<string, any>;
type Language = 'ja' | 'en';
/** A product in one language: published unless `status` says draft. */
type Piece = { slug: string; name: string; locale: Language; status?: 'published' | 'draft' };

const COFFRET: Piece[] = [
  { slug: 'jewelry-coffret', name: 'ジュエリー・コフレ', locale: 'ja' },
  { slug: 'jewelry-coffret', name: 'Jewelry Coffret', locale: 'en' },
];

/** The Document Service as `productNamed` reads it: a piece is found only in its own language, and only in the status asked for. */
const world = ({ pieces = [], config = {} }: { pieces?: Piece[]; config?: Record<string, unknown> } = {}) => {
  const findFirst = vi.fn(
    async ({ locale, status, filters }: Doc) =>
      pieces.find((piece) => piece.locale === locale && (piece.status ?? 'published') === status && piece.slug === filters?.slug?.$eq) ?? null
  );
  const documents = (uid: string) => {
    if (uid === UID.product) return { findFirst };
    throw new Error(`These tests have no ${uid}.`);
  };
  return { lookup: productNamed(fakeStrapi({ documents, config })), findFirst };
};
const localesAsked = (findFirst: ReturnType<typeof world>['findFirst']) => findFirst.mock.calls.map(([params]) => params.locale);

describe('productNamed', () => {
  it("names a published piece in the language it is asked for, and asks for only its slug and name", async () => {
    const { lookup, findFirst } = world({ pieces: COFFRET });

    expect(await lookup('jewelry-coffret', 'en')).toEqual({ slug: 'jewelry-coffret', name: 'Jewelry Coffret' });

    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      locale: 'en',
      status: 'published',
      filters: { slug: { $eq: 'jewelry-coffret' } },
      fields: ['slug', 'name'],
    });
  });

  it('names it in Japanese for a chat in Japanese', async () => {
    const { lookup } = world({ pieces: COFFRET });
    expect(await lookup('jewelry-coffret', 'ja')).toEqual({ slug: 'jewelry-coffret', name: 'ジュエリー・コフレ' });
  });

  it("names it in the default language when the language it is asked for has no version of it", async () => {
    const { lookup, findFirst } = world({ pieces: [COFFRET[0]] });

    expect(await lookup('jewelry-coffret', 'en')).toEqual({ slug: 'jewelry-coffret', name: 'ジュエリー・コフレ' });

    expect(localesAsked(findFirst)).toEqual(['en', 'ja']);
  });

  it('takes the default language from the config', async () => {
    const { lookup, findFirst } = world({ pieces: [COFFRET[1]], config: { defaultLocale: 'en' } });

    expect(await lookup('jewelry-coffret', 'ja')).toEqual({ slug: 'jewelry-coffret', name: 'Jewelry Coffret' });

    expect(localesAsked(findFirst)).toEqual(['ja', 'en']);
  });

  it('asks only once when the language is the default one', async () => {
    const { lookup, findFirst } = world();
    expect(await lookup('no-such-piece', 'ja')).toBeNull();
    expect(localesAsked(findFirst)).toEqual(['ja']);
  });

  it('reads published versions only, so a piece that is only a draft has no name', async () => {
    const { lookup } = world({ pieces: COFFRET.map((piece) => ({ ...piece, status: 'draft' as const })) });
    expect(await lookup('jewelry-coffret', 'en')).toBeNull();
  });

  it('answers null for a slug no piece has', async () => {
    const { lookup } = world({ pieces: COFFRET });
    expect(await lookup('no-such-piece', 'en')).toBeNull();
  });

  it('looks up afresh on every call: remembering is rememberProductNames', async () => {
    const { lookup, findFirst } = world({ pieces: COFFRET });
    await lookup('jewelry-coffret', 'en');
    await lookup('jewelry-coffret', 'en');
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});

describe('rememberProductNames', () => {
  const lookupOf = () => vi.fn(async (slug: string, language: Language) => (slug === 'gone' ? null : { slug, name: `${slug} in ${language}` }));
  const row = (productSlug: string | null | undefined, language: Language) => ({ productSlug, language });

  it("names each row's piece in the row's own language", async () => {
    const nameOf = rememberProductNames(lookupOf());
    expect(await nameOf(row('jewelry-coffret', 'en'))).toEqual({ slug: 'jewelry-coffret', name: 'jewelry-coffret in en' });
    expect(await nameOf(row('jewelry-coffret', 'ja'))).toEqual({ slug: 'jewelry-coffret', name: 'jewelry-coffret in ja' });
  });

  it('looks each piece up once per language, however many rows are about it', async () => {
    const lookup = lookupOf();
    const nameOf = rememberProductNames(lookup);

    const names = await Promise.all([row('a', 'en'), row('a', 'en'), row('a', 'ja'), row('b', 'en'), row('a', 'en')].map(nameOf));

    expect(lookup.mock.calls).toEqual([['a', 'en'], ['a', 'ja'], ['b', 'en']]);
    expect(names.map((name) => name?.name)).toEqual(['a in en', 'a in en', 'a in ja', 'b in en', 'a in en']);
  });

  it('shares one lookup between rows asked about the same piece at the same time', async () => {
    const lookup = lookupOf();
    const nameOf = rememberProductNames(lookup);
    await Promise.all([nameOf(row('a', 'en')), nameOf(row('a', 'en'))]);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('remembers a piece that is not there, too', async () => {
    const lookup = lookupOf();
    const nameOf = rememberProductNames(lookup);
    expect(await nameOf(row('gone', 'en'))).toBeNull();
    expect(await nameOf(row('gone', 'en'))).toBeNull();
    expect(lookup).toHaveBeenCalledOnce();
  });

  it.each([['null', null], ['undefined', undefined], ['empty', '']])('gives a row whose slug is %s no piece, and looks nothing up', async (_label, slug) => {
    const lookup = lookupOf();
    expect(await rememberProductNames(lookup)(row(slug, 'en'))).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('starts empty each time: a second list looks its pieces up again', async () => {
    const lookup = lookupOf();
    await rememberProductNames(lookup)(row('a', 'en'));
    await rememberProductNames(lookup)(row('a', 'en'));
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe('product-names', () => {
  it("is code the services share, and no service: the plugin's services don't include it", () => {
    expect(Object.keys(services).filter((name) => /product/.test(name))).toEqual([]);
  });
});
