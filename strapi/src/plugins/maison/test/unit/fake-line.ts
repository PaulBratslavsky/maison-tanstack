import { vi } from 'vitest';
import { UID } from '../../server/src/constants';
import lineConfirmations from '../../server/src/services/line-confirmations';
import { fakeStrapi } from './fake-strapi';

type Doc = Record<string, any>;
type Middleware = (ctx: Doc, next: () => Promise<unknown>) => Promise<unknown>;
/** Published versions of boutiques and products, per content type and then per locale. */
type Translations = Record<string, Record<string, Doc[]>>;

export const TOKEN = 'test-channel-token';
export const LINE_API = 'http://127.0.0.1:4010';
export const LIFF_URL = 'https://liff.line.me/1234567890-AbCdEfGh';
export const LINE_USER_ID = `U${'a'.repeat(32)}`;
export const LINE_CONFIG = { liffUrl: LIFF_URL, lineChannelAccessToken: TOKEN, lineApiBaseUrl: LINE_API };

/** APT-4821's published version, as the Document Service returns it with the boutique and products populated. */
export const PUBLISHED: Doc = {
  documentId: 'doc-4821',
  reference: 'APT-4821',
  customer: `line:${LINE_USER_ID}`,
  requestedFor: '2030-01-12T05:00:00.000Z', // 14:00 in Tokyo, far enough ahead that no test runs after it
  boutique: { name: '銀座本店', address: '東京都中央区銀座 1-2-3（デモ）' },
  products: [{ name: 'ウィークエンダー 50' }, { name: 'パスポートカバー' }],
};

/**
 * APT-4821 booked in English: its published version, with the boutique and products it links in the default locale,
 * as appointments.request links them, and their documentIds.
 */
export const PUBLISHED_EN: Doc = {
  ...PUBLISHED,
  language: 'en',
  boutique: { documentId: 'boutique-ginza', ...PUBLISHED.boutique },
  products: [
    { documentId: 'product-weekender', name: 'ウィークエンダー 50' },
    { documentId: 'product-passport', name: 'パスポートカバー' },
  ],
};

/** The published English versions of APT-4821's boutique and products, as world()'s `translations`. */
export const IN_ENGLISH: Translations = {
  [UID.boutique]: { en: [{ documentId: 'boutique-ginza', name: 'Ginza Flagship', address: '1-2-3 Ginza, Chuo-ku, Tokyo (demo)' }] },
  [UID.product]: {
    en: [
      { documentId: 'product-weekender', name: 'Weekender 50' },
      { documentId: 'product-passport', name: 'Passport Cover' },
    ],
  },
};

/**
 * APT-4821 as the Document Service holds it: a draft (unless `exists` is false), its published version (or none), and
 * the notifications recorded so far. `record` stands in for confirmations.record and appends to them, so a second send
 * sees the first one. `sender` is the real line-confirmations service, also at services['line-confirmations'].
 * `call` runs a Document Service call through the middlewares registered with documents.use, as Strapi does.
 * `strapi.db` says whether the call runs `inTransaction`; `commits` keeps what onCommit registered, for a test to run,
 * as a commit would, or to drop, as a rollback does.
 * `translations` holds the published boutiques and products a visit's language is looked up in; `labelLookups` keeps
 * those lookups, per content type.
 */
export const world = ({
  exists = true,
  published = PUBLISHED as Doc | null,
  sent = false,
  config = LINE_CONFIG as Record<string, unknown>,
  inTransaction = false,
  translations = {} as Translations,
} = {}) => {
  const notifications: Doc[] = sent ? [{ appointmentReference: 'APT-4821', outcome: 'sent' }] : [];
  const appointmentFindOne = vi.fn(async ({ documentId, status }: Doc) =>
    status === 'published' && documentId === 'doc-4821' ? published : null
  );
  const appointmentFindMany = vi.fn(async ({ status }: Doc) => (status === 'published' && published ? [published] : []));
  /** findMany on boutiques or products: the published versions in `locale` among `filters.documentId.$in`. */
  const lookupIn = (uid: string) =>
    vi.fn(async ({ locale, status, filters }: Doc) =>
      status === 'published' ? (translations[uid]?.[locale] ?? []).filter((row) => filters?.documentId?.$in?.includes(row.documentId)) : []
    );
  const labelLookups = { [UID.boutique]: lookupIn(UID.boutique), [UID.product]: lookupIn(UID.product) };
  const middlewares: Middleware[] = [];
  const documents = Object.assign(
    (uid: string) => {
      if (uid === UID.boutique || uid === UID.product) return { findMany: labelLookups[uid] };
      if (uid === UID.notification) {
        return {
          findFirst: vi.fn(async ({ filters }: Doc) =>
            notifications.find(
              (row) => row.outcome === filters.outcome?.$eq && row.appointmentReference === filters.appointmentReference?.$eq
            ) ?? null
          ),
          findMany: vi.fn(async () => notifications),
        };
      }
      return {
        findFirst: vi.fn(async ({ status, filters }: Doc) =>
          exists && status === 'draft' && filters.reference?.$eq === 'APT-4821' ? { documentId: 'doc-4821' } : null
        ),
        findOne: appointmentFindOne,
        findMany: appointmentFindMany,
      };
    },
    { use: (middleware: Middleware) => void middlewares.push(middleware) }
  );
  const record = vi.fn(async (input: Doc) => {
    notifications.push({ appointmentReference: input.reference, outcome: input.status });
    return { ok: true, value: { notification: { reference: input.reference, status: input.status }, alreadyRecorded: false } };
  });
  const services: Record<string, unknown> = { confirmations: { record } };
  const strapi = fakeStrapi({ documents, config, services });
  const commits: Array<() => unknown> = [];
  strapi.db = {
    inTransaction: () => inTransaction,
    transaction: async (callback: (params: { onCommit: (fn: () => unknown) => void }) => unknown) =>
      callback({ onCommit: (fn) => void commits.push(fn) }),
  };
  const sender = lineConfirmations({ strapi });
  services['line-confirmations'] = sender;

  /** Each middleware in the order it was registered, then `work`, the call itself: Strapi's middleware manager. */
  const call = (ctx: { uid: string; action: string; params?: Doc }, work: () => Promise<unknown>) => {
    const context = { contentType: {}, params: {}, ...ctx };
    let index = 0;
    const next = async (): Promise<unknown> => (index < middlewares.length ? middlewares[index++](context, next) : work());
    return next();
  };

  return { strapi, record, sender, services, call, commits, appointmentFindOne, appointmentFindMany, labelLookups };
};

/** LINE's push endpoint as a stand-in for fetch, answering `status` with `body`. */
export const lineAnswers = (status = 200, body: unknown = { sentMessages: [{ id: '1', quoteToken: 'q' }] }) =>
  vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
