import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UID } from '../../server/src/constants';
import { buildConfirmationMessage } from '../../server/src/domain/flex-message';
import confirmations, { confirmationFor, inVisitLanguage } from '../../server/src/services/confirmations';
import { IN_ENGLISH, LIFF_URL, LINE_USER_ID, PUBLISHED, PUBLISHED_EN, lineAnswers, world } from './fake-line';

type Doc = Record<string, any>;

const OPTIONS = { liffUrl: LIFF_URL, timezone: 'Asia/Tokyo', houseName: { ja: 'メゾン', en: 'Maison' } };
const APP_LINK = `${LIFF_URL}/visits/APT-4821`;

/** APT-4821 booked in English, with its boutique and products already named in English. */
const ENGLISH_VISIT: Doc = {
  ...PUBLISHED,
  language: 'en',
  boutique: { name: 'Ginza Flagship', address: '1-2-3 Ginza, Chuo-ku, Tokyo (demo)' },
  products: [{ name: 'Weekender 50' }, { name: 'Passport Cover' }],
};

/** APT-4821's confirmation as confirmationFor gave it before visits had a language, key for key and in that order. */
const JAPANESE_CONFIRMATION = {
  lineUserId: LINE_USER_ID,
  boutique: { name: '銀座本店', address: '東京都中央区銀座 1-2-3（デモ）' },
  requestedFor: '2030-01-12T14:00:00+09:00',
  requestedForText: '1月12日(土) 14:00',
  products: [{ name: 'ウィークエンダー 50' }, { name: 'パスポートカバー' }],
  appLink: APP_LINK,
  message: buildConfirmationMessage({
    houseName: 'メゾン',
    reference: 'APT-4821',
    boutiqueName: '銀座本店',
    boutiqueAddress: '東京都中央区銀座 1-2-3（デモ）',
    requestedForText: '1月12日(土) 14:00',
    productNames: ['ウィークエンダー 50', 'パスポートカバー'],
    appLink: APP_LINK,
  }),
};

describe('confirmationFor', () => {
  it('writes the confirmation of a visit booked in English in English: its words, the house name and the date', () => {
    const confirmation = confirmationFor(ENGLISH_VISIT, OPTIONS);
    expect(confirmation).toEqual({
      lineUserId: LINE_USER_ID,
      boutique: { name: 'Ginza Flagship', address: '1-2-3 Ginza, Chuo-ku, Tokyo (demo)' },
      requestedFor: '2030-01-12T14:00:00+09:00',
      requestedForText: 'Sat 12 Jan, 14:00',
      products: [{ name: 'Weekender 50' }, { name: 'Passport Cover' }],
      appLink: APP_LINK,
      message: buildConfirmationMessage({
        language: 'en',
        houseName: 'Maison',
        reference: 'APT-4821',
        boutiqueName: 'Ginza Flagship',
        boutiqueAddress: '1-2-3 Ginza, Chuo-ku, Tokyo (demo)',
        requestedForText: 'Sat 12 Jan, 14:00',
        productNames: ['Weekender 50', 'Passport Cover'],
        appLink: APP_LINK,
      }),
    });
    expect(confirmation?.message.altText).toBe('Your visit is confirmed (APT-4821)');
  });

  it('writes the confirmation of a visit booked in Japanese exactly as it always has', () => {
    expect(JSON.stringify(confirmationFor({ ...PUBLISHED, language: 'ja' }, OPTIONS))).toBe(JSON.stringify(JAPANESE_CONFIRMATION));
  });

  it.each([
    ['no language, as visits booked before it was kept have', {}],
    ['a null language', { language: null }],
    ['a language it has no words for', { language: 'fr' }],
  ])('writes a visit with %s in Japanese', (_label, language) => {
    expect(JSON.stringify(confirmationFor({ ...PUBLISHED, ...language }, OPTIONS))).toBe(JSON.stringify(JAPANESE_CONFIRMATION));
  });
});

describe('inVisitLanguage, the names a confirmation uses', () => {
  const namesOf = (visit: Doc) => ({ boutique: visit.boutique, products: visit.products.map((product: Doc) => product.name) });

  it("names an English visit's boutique and products in English, from the published English versions of what it links", async () => {
    const w = world({ translations: IN_ENGLISH });
    const [visit] = await inVisitLanguage(w.strapi, [PUBLISHED_EN]);
    expect(namesOf(visit)).toEqual({
      boutique: { documentId: 'boutique-ginza', name: 'Ginza Flagship', address: '1-2-3 Ginza, Chuo-ku, Tokyo (demo)' },
      products: ['Weekender 50', 'Passport Cover'],
    });
    expect(w.labelLookups[UID.boutique]).toHaveBeenCalledExactlyOnceWith({
      locale: 'en',
      status: 'published',
      filters: { documentId: { $in: ['boutique-ginza'] } },
      fields: ['name', 'address'],
      limit: 1,
    });
    expect(w.labelLookups[UID.product]).toHaveBeenCalledExactlyOnceWith({
      locale: 'en',
      status: 'published',
      filters: { documentId: { $in: ['product-weekender', 'product-passport'] } },
      fields: ['name'],
      limit: 2,
    });
  });

  it('names the products in the order the visit links them, whatever order the lookup answers in', async () => {
    const reversed = { ...IN_ENGLISH, [UID.product]: { en: [...IN_ENGLISH[UID.product].en].reverse() } };
    const [visit] = await inVisitLanguage(world({ translations: reversed }).strapi, [PUBLISHED_EN]);
    expect(namesOf(visit).products).toEqual(['Weekender 50', 'Passport Cover']);
  });

  it.each([
    ['empty', ''],
    ['blank', '  '],
    ['missing', undefined],
  ])('keeps the default locale, Japanese, for a field that is %s in English, field by field', async (_label, missing) => {
    const w = world({
      translations: {
        [UID.boutique]: { en: [{ documentId: 'boutique-ginza', name: 'Ginza Flagship', address: missing }] },
        [UID.product]: { en: [{ documentId: 'product-passport', name: missing }] },
      },
    });
    const [visit] = await inVisitLanguage(w.strapi, [PUBLISHED_EN]);
    expect(namesOf(visit)).toEqual({
      boutique: { documentId: 'boutique-ginza', name: 'Ginza Flagship', address: '東京都中央区銀座 1-2-3（デモ）' },
      products: ['ウィークエンダー 50', 'パスポートカバー'],
    });
  });

  it('keeps the Japanese names of what has no published English version', async () => {
    const [visit] = await inVisitLanguage(world().strapi, [PUBLISHED_EN]);
    expect(namesOf(visit)).toEqual(namesOf(PUBLISHED_EN));
  });

  it('leaves a visit in Japanese, the default locale, as it is, and looks nothing up', async () => {
    const w = world({ translations: IN_ENGLISH });
    const japanese = { ...PUBLISHED_EN, language: 'ja' };
    expect(await inVisitLanguage(w.strapi, [japanese, PUBLISHED])).toEqual([japanese, PUBLISHED]);
    expect(w.labelLookups[UID.boutique]).not.toHaveBeenCalled();
    expect(w.labelLookups[UID.product]).not.toHaveBeenCalled();
  });

  it('looks a Japanese visit up in Japanese when the default locale, which visits link, is English', async () => {
    const inJapanese = {
      [UID.boutique]: { ja: [{ documentId: 'boutique-ginza', name: '銀座本店', address: '東京都中央区銀座 1-2-3（デモ）' }] },
      [UID.product]: { ja: [{ documentId: 'product-weekender', name: 'ウィークエンダー 50' }] },
    };
    const w = world({ translations: inJapanese, config: { defaultLocale: 'en' } });
    const linkedInEnglish = { ...PUBLISHED_EN, boutique: { documentId: 'boutique-ginza', name: 'Ginza Flagship', address: '' } };
    const [japanese, inEnglish] = await inVisitLanguage(w.strapi, [{ ...linkedInEnglish, language: 'ja' }, linkedInEnglish]);
    expect(japanese.boutique.name).toBe('銀座本店');
    expect(inEnglish).toEqual(linkedInEnglish);
    expect(w.labelLookups[UID.boutique]).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ locale: 'ja' }));
  });

  it('names each of several visits in its own language, and looks English up once for all of them', async () => {
    const w = world({ translations: IN_ENGLISH });
    const japanese = { ...PUBLISHED_EN, reference: 'APT-1000', language: 'ja' };
    const english = { ...PUBLISHED_EN, reference: 'APT-2000' };
    const visits = await inVisitLanguage(w.strapi, [japanese, PUBLISHED_EN, english]);
    expect(visits.map((visit) => [visit.reference, visit.boutique.name])).toEqual([
      ['APT-1000', '銀座本店'],
      ['APT-4821', 'Ginza Flagship'],
      ['APT-2000', 'Ginza Flagship'],
    ]);
    expect(w.labelLookups[UID.boutique]).toHaveBeenCalledOnce();
    expect(w.labelLookups[UID.product]).toHaveBeenCalledOnce();
  });
});

describe('the LINE confirmation of a visit booked in English', () => {
  const NOW = new Date('2026-10-01T00:00:00Z');
  /** What both paths must give APT-4821 booked in English. */
  const ENGLISH_MESSAGE = buildConfirmationMessage({
    language: 'en',
    houseName: 'Maison',
    reference: 'APT-4821',
    boutiqueName: 'Ginza Flagship',
    boutiqueAddress: '1-2-3 Ginza, Chuo-ku, Tokyo (demo)',
    requestedForText: 'Sat 12 Jan, 14:00',
    productNames: ['Weekender 50', 'Passport Cover'],
    appLink: APP_LINK,
  });

  let fetchMock: ReturnType<typeof lineAnswers>;
  const pushedBody = () => JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
  beforeEach(() => {
    fetchMock = lineAnswers();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is pushed in English by Strapi', async () => {
    const { sender } = world({ published: PUBLISHED_EN, translations: IN_ENGLISH });
    expect(await sender.sendConfirmation('APT-4821')).toMatchObject({ status: 'sent' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(pushedBody()).toEqual({ to: LINE_USER_ID, messages: [{ type: 'flex', ...ENGLISH_MESSAGE }] });
  });

  it('is listed in English by pending_confirmations, as the message Strapi pushes', async () => {
    const w = world({ published: PUBLISHED_EN, translations: IN_ENGLISH });
    const listed = await confirmations({ strapi: w.strapi }).listPending(10, NOW);
    expect(listed.ok).toBe(true);
    const [pending] = (listed as { value: Doc[] }).value;
    expect(pending).toEqual({
      reference: 'APT-4821',
      lineUserId: LINE_USER_ID,
      boutique: { name: 'Ginza Flagship', address: '1-2-3 Ginza, Chuo-ku, Tokyo (demo)' },
      requestedFor: '2030-01-12T14:00:00+09:00',
      requestedForText: 'Sat 12 Jan, 14:00',
      products: [{ name: 'Weekender 50' }, { name: 'Passport Cover' }],
      previousAttempts: 0,
      appLink: APP_LINK,
      message: ENGLISH_MESSAGE,
    });

    await w.sender.sendConfirmation('APT-4821');
    expect(pushedBody().messages).toEqual([{ type: 'flex', ...pending.message }]);
  });
});
