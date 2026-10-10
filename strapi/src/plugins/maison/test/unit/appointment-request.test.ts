import { describe, expect, it, vi } from 'vitest';
import appointmentSchema from '../../server/src/content-types/appointment/schema.json';
import { LOCALES, UID } from '../../server/src/constants';
import appointments from '../../server/src/services/appointments';
import { fakeStrapi } from './fake-strapi';

type Doc = Record<string, any>;

const NOW = new Date('2026-10-01T00:00:00Z'); // 09:00 on Thursday 1 October in Tokyo
const EVERY_DAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((weekday) => ({ weekday, opens: '11:00', closes: '20:00' }));
const GINZA = { documentId: 'b-ginza', slug: 'ginza', name: '銀座本店', openingHours: EVERY_DAY };
const WEEKENDER = { documentId: 'p-weekender', slug: 'weekender-50', name: 'ウィークエンダー 50' };

/** A visit to Ginza at 14:00 on Saturday 10 October, as the tools and the REST door ask for one. */
const booking = {
  subject: `line:U${'a'.repeat(32)}`,
  boutique: 'ginza',
  productSlugs: ['weekender-50'],
  requestedFor: '2026-10-10T14:00:00+09:00',
  createdVia: 'app' as const,
  now: NOW,
};

/**
 * The Document Service as request() reads and writes it, with nothing booked yet: Ginza and the Weekender are
 * published, and no appointment or notification exists. `create` is kept, so a test can read what was stored.
 */
const world = (config: Record<string, unknown> = {}) => {
  let stored: Doc = {};
  const create = vi.fn(async ({ data }: { data: Doc }) => {
    stored = { documentId: 'doc-new', ...data };
    return stored;
  });
  const documents = (uid: string) => {
    if (uid === UID.boutique) return { findFirst: vi.fn(async () => GINZA), findMany: vi.fn(async () => [GINZA]) };
    if (uid === UID.product) return { findFirst: vi.fn(async () => WEEKENDER), findMany: vi.fn(async () => [WEEKENDER]) };
    if (uid === UID.notification) return { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) };
    return {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      create,
      // The new draft, with the boutique and products it links.
      findOne: vi.fn(async () => ({ ...stored, boutique: GINZA, products: [WEEKENDER] })),
    };
  };
  return { service: appointments({ strapi: fakeStrapi({ documents, config }) }), create };
};

const storedLanguage = (create: ReturnType<typeof world>['create']) => {
  expect(create).toHaveBeenCalledOnce();
  return create.mock.calls[0][0].data.language;
};

describe('appointments.request', () => {
  it("stores the language the customer booked in: the booking's locale", async () => {
    const { service, create } = world();
    expect((await service.request({ ...booking, locale: 'en' })).ok).toBe(true);
    expect(storedLanguage(create)).toBe('en');
  });

  it('stores Japanese for a booking in Japanese', async () => {
    const { service, create } = world();
    expect((await service.request({ ...booking, locale: 'ja' })).ok).toBe(true);
    expect(storedLanguage(create)).toBe('ja');
  });

  it('stores the default locale, Japanese, for a booking without a locale', async () => {
    const { service, create } = world();
    expect((await service.request(booking)).ok).toBe(true);
    expect(storedLanguage(create)).toBe('ja');
  });

  it("stores the configured default locale for a booking without a locale, when it isn't Japanese", async () => {
    const { service, create } = world({ defaultLocale: 'en' });
    expect((await service.request(booking)).ok).toBe(true);
    expect(storedLanguage(create)).toBe('en');
  });
});

describe("the appointment's language field", () => {
  it('takes every locale a booking can be in, and is Japanese by default', () => {
    // Not `locale`: Strapi's i18n uses that name.
    expect(appointmentSchema.attributes.language).toEqual({ type: 'enumeration', enum: [...LOCALES], default: 'ja' });
  });
});
