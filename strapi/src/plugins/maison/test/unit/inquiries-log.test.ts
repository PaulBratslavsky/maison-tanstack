import { describe, expect, it, vi } from 'vitest';
import schema from '../../server/src/content-types/inquiry/schema.json';
import { UID } from '../../server/src/constants';
import inquiries from '../../server/src/services/inquiries';
import { fakeStrapi } from './fake-strapi';

type Doc = Record<string, any>;
type Language = 'ja' | 'en';
/** A product in one language: published unless `status` says draft. */
type Piece = { slug: string; name: string; locale: Language; status?: 'published' | 'draft' };

/** The customer as the session gives them: `line:U` and 32 hex characters. */
const SUBJECT = 'line:U4af49806290a28bb0a53ff1d09a9d588';
const SOMEONE_ELSE = `line:U${'b'.repeat(32)}`;
const ASKED = 'Can the coffret hold a watch?';
const ANSWERED = 'Yes, a watch up to 42 mm fits.';
/** A turn that the concierge answered from product knowledge. */
const input = { subject: SUBJECT, message: ASKED, reply: ANSWERED, knowledgeFound: true, handedOff: false };

const COFFRET: Piece[] = [
  { slug: 'jewelry-coffret', name: 'ジュエリー・コフレ', locale: 'ja' },
  { slug: 'jewelry-coffret', name: 'Jewelry Coffret', locale: 'en' },
];

interface WorldOptions {
  pieces?: Piece[];
  /** The questions there are, each with the customer it belongs to. */
  questions?: Array<{ reference: string; customer: string }>;
  config?: Record<string, unknown>;
}

/**
 * The Document Service as `log` reads and writes it. A piece is found only in its own language, and only in the status
 * asked for. `count` answers the question check, which filters on both `reference` and `customer`, and anything else is
 * a mistake in the service. `create` is kept, for a test to read what was stored.
 */
const world = ({ pieces = [], questions = [], config = {} }: WorldOptions = {}) => {
  const create = vi.fn(async ({ data }: { data: Doc }) => ({ documentId: 'inq-new', ...data }));
  const findPiece = vi.fn(
    async ({ locale, status, filters }: Doc) =>
      pieces.find((piece) => piece.locale === locale && (piece.status ?? 'published') === status && piece.slug === filters?.slug?.$eq) ?? null
  );
  const countQuestions = vi.fn(async ({ filters }: Doc) => {
    if (!filters?.reference || !filters?.customer) throw new Error(`count was asked something these tests don't know: ${JSON.stringify(filters)}`);
    return questions.filter((question) => question.reference === filters.reference.$eq && question.customer === filters.customer.$eq).length;
  });
  const documents = (uid: string) => {
    if (uid === UID.inquiry) return { create };
    if (uid === UID.product) return { findFirst: findPiece };
    if (uid === UID.question) return { count: countQuestions };
    throw new Error(`These tests have no ${uid}.`);
  };
  const strapi = fakeStrapi({ documents, config });
  return { service: inquiries({ strapi }), strapi, create, findPiece, countQuestions };
};

/** What the inquiry's `create` was given. */
const storedBy = (create: ReturnType<typeof world>['create']): Doc => {
  expect(create).toHaveBeenCalledOnce();
  return create.mock.calls[0][0].data;
};

describe('inquiries.log', () => {
  it("records one row: the customer from the session, what was asked and answered, and the chat's language", async () => {
    const { service, create } = world();

    const result = await service.log({ ...input, locale: 'en' });

    // Every field, so a label the model hasn't given yet can't be stored by accident.
    expect(storedBy(create)).toEqual({
      customer: SUBJECT,
      message: ASKED,
      reply: ANSWERED,
      language: 'en',
      knowledgeFound: true,
      handedOff: false,
      questionReference: null,
      productSlug: null,
      analysisStatus: 'pending',
      queue: 'none',
      status: 'open',
    });
    expect(result).toEqual({ ok: true, value: { logged: true } });
  });

  it('starts every row pending and open, whatever the turn was', async () => {
    for (const handedOff of [true, false]) {
      const { service, create } = world();
      await service.log({ ...input, handedOff });
      expect(storedBy(create)).toMatchObject({ analysisStatus: 'pending', status: 'open' });
    }
  });

  it.each([
    ['a chat in English', { locale: 'en' as const }, {}, 'en'],
    ['a chat in Japanese', { locale: 'ja' as const }, {}, 'ja'],
    ['no locale: the default locale, Japanese', {}, {}, 'ja'],
    ['no locale, with English as the default locale', {}, { defaultLocale: 'en' }, 'en'],
  ])('stores the language of %s', async (_label, locale, config, language) => {
    const { service, create } = world({ config });
    expect((await service.log({ ...input, ...locale })).ok).toBe(true);
    expect(storedBy(create).language).toBe(language);
  });

  it.each([
    [true, false],
    [false, true],
    [true, true],
    [false, false],
  ])('stores knowledgeFound %s and handedOff %s as they were given', async (knowledgeFound, handedOff) => {
    const { service, create } = world();
    await service.log({ ...input, knowledgeFound, handedOff });
    expect(storedBy(create)).toMatchObject({ knowledgeFound, handedOff });
  });
});

describe('inquiries.log, the words', () => {
  // Staff read the customer's paragraphs and the concierge's lists as they were written.
  it('stores the message and the reply trimmed, keeping their line breaks and the spaces inside their lines', async () => {
    const { service, create } = world();

    await service.log({
      ...input,
      message: '  Can the coffret\n  hold a watch?\n',
      reply: ' Yes.\n\nIt fits:\n- a 42 mm watch\n-   a pair of cufflinks \n',
    });

    expect(storedBy(create)).toMatchObject({
      message: 'Can the coffret\n  hold a watch?',
      reply: 'Yes.\n\nIt fits:\n- a 42 mm watch\n-   a pair of cufflinks',
    });
  });

  it('counts a line break as one unit when it cuts, and keeps the breaks in what it keeps', async () => {
    const { service, create } = world();

    await service.log({ ...input, message: 'a\n'.repeat(700), reply: 'b\n\n'.repeat(1000) });

    const { message, reply } = storedBy(create);
    expect(message).toBe(`${'a\n'.repeat(499)}a…`);
    expect(message).toHaveLength(1000);
    expect(reply.startsWith('b\n\nb\n\n')).toBe(true);
    expect(reply.endsWith('…')).toBe(true);
    expect(reply).toHaveLength(2000);
  });

  it('keeps a message of 1000 UTF-16 units whole, and cuts a longer one to 1000, ending with …', async () => {
    const whole = world();
    await whole.service.log({ ...input, message: 'x'.repeat(1000) });
    expect(storedBy(whole.create).message).toBe('x'.repeat(1000));

    const cut = world();
    await cut.service.log({ ...input, message: 'x'.repeat(4000) });
    expect(storedBy(cut.create).message).toBe(`${'x'.repeat(999)}…`);
  });

  it('keeps a reply of 2000 UTF-16 units whole, and cuts a longer one to 2000, ending with …', async () => {
    const whole = world();
    await whole.service.log({ ...input, reply: 'y'.repeat(2000) });
    expect(storedBy(whole.create).reply).toBe('y'.repeat(2000));

    const cut = world();
    await cut.service.log({ ...input, reply: 'y'.repeat(8000) });
    expect(storedBy(cut.create).reply).toBe(`${'y'.repeat(1999)}…`);
  });

  it("cuts to the lengths the inquiry's message and reply hold, which are what the tool's larger limits protect", async () => {
    // The tool takes up to 4,000 and 8,000 characters so a long turn is logged, and the service cuts it to fit the row.
    expect(schema.attributes.message.maxLength).toBe(1000);
    expect(schema.attributes.reply.maxLength).toBe(2000);
    const { service, create } = world();

    await service.log({ ...input, message: 'x'.repeat(4000), reply: 'y'.repeat(8000) });

    const { message, reply } = storedBy(create);
    expect(message).toHaveLength(schema.attributes.message.maxLength);
    expect(reply).toHaveLength(schema.attributes.reply.maxLength);
  });

  it('counts UTF-16 units, as Strapi does, and never splits an emoji', async () => {
    // 600 emoji are 600 characters but 1200 units, and 1200 reply emoji are 2400.
    const { service, create } = world();

    await service.log({ ...input, message: '😀'.repeat(600), reply: '😀'.repeat(1200) });

    const { message, reply } = storedBy(create);
    expect(message.length).toBeLessThanOrEqual(1000);
    expect(reply.length).toBeLessThanOrEqual(2000);
    expect(message.endsWith('…')).toBe(true);
    expect(reply.endsWith('…')).toBe(true);
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(message).not.toMatch(lone);
    expect(reply).not.toMatch(lone);
  });

  it.each([
    ['no reply', undefined],
    ['an empty reply', ''],
    ['a reply of only spaces', ' \n\t '],
  ])('stores no reply for %s: the turn is still logged', async (_label, reply) => {
    const { service, create } = world();

    const result = await service.log({ subject: SUBJECT, message: ASKED, knowledgeFound: false, handedOff: false, reply });

    expect(storedBy(create).reply).toBeNull();
    expect(result).toEqual({ ok: true, value: { logged: true } });
  });

  it("keeps the customer's words out of Strapi's logs", async () => {
    const { service, strapi } = world();
    await service.log(input);
    for (const level of ['debug', 'info', 'warn', 'error'] as const) expect(strapi.log[level], level).not.toHaveBeenCalled();
  });
});

describe('inquiries.log, about a piece', () => {
  it('stores the slug of a published piece', async () => {
    const { service, create, findPiece } = world({ pieces: COFFRET });

    await service.log({ ...input, productSlug: 'jewelry-coffret', locale: 'en' });

    expect(storedBy(create).productSlug).toBe('jewelry-coffret');
    expect(findPiece).toHaveBeenCalledExactlyOnceWith({
      locale: 'en',
      status: 'published',
      filters: { slug: { $eq: 'jewelry-coffret' } },
      fields: ['slug', 'name'],
    });
  });

  it("finds the piece in the default language when the chat's language has no version of it", async () => {
    const { service, create, findPiece } = world({ pieces: [COFFRET[0]] });

    await service.log({ ...input, productSlug: 'jewelry-coffret', locale: 'en' });

    expect(findPiece.mock.calls.map(([params]) => params.locale)).toEqual(['en', 'ja']);
    expect(storedBy(create).productSlug).toBe('jewelry-coffret');
  });

  it('reads published versions only, so a piece that is only a draft is dropped', async () => {
    const { service, create } = world({ pieces: COFFRET.map((piece) => ({ ...piece, status: 'draft' as const })) });

    await service.log({ ...input, productSlug: 'jewelry-coffret', locale: 'en' });

    expect(storedBy(create).productSlug).toBeNull();
  });

  it('drops an unknown slug, and still logs the turn', async () => {
    const { service, create } = world({ pieces: COFFRET });

    const result = await service.log({ ...input, productSlug: 'no-such-piece', locale: 'en' });

    expect(storedBy(create)).toMatchObject({ productSlug: null, message: ASKED });
    expect(result).toEqual({ ok: true, value: { logged: true } });
  });

  it('looks for no piece when the turn was not on one', async () => {
    const { service, findPiece } = world({ pieces: COFFRET });
    await service.log(input);
    expect(findPiece).not.toHaveBeenCalled();
  });
});

describe('inquiries.log, a hand-off', () => {
  const HANDED_OFF = { ...input, knowledgeFound: false, handedOff: true };

  it("stores the question's reference when that question is this customer's", async () => {
    const { service, create, countQuestions } = world({ questions: [{ reference: 'Q-4821', customer: SUBJECT }] });

    await service.log({ ...HANDED_OFF, questionReference: 'Q-4821' });

    expect(storedBy(create)).toMatchObject({ handedOff: true, questionReference: 'Q-4821' });
    expect(countQuestions).toHaveBeenCalledExactlyOnceWith({ filters: { reference: { $eq: 'Q-4821' }, customer: { $eq: SUBJECT } } });
  });

  it.each([
    ['another customer’s', [{ reference: 'Q-4821', customer: SOMEONE_ELSE }]],
    ['no question’s', []],
  ])('drops a reference that is %s, but still records the hand-off, in Needs an answer', async (_label, questions) => {
    const { service, create } = world({ questions });

    const result = await service.log({ ...HANDED_OFF, questionReference: 'Q-4821' });

    expect(storedBy(create)).toMatchObject({ handedOff: true, questionReference: null, queue: 'needs-answer' });
    expect(result).toEqual({ ok: true, value: { logged: true } });
  });

  it('records a hand-off with no reference too, in Needs an answer', async () => {
    const { service, create, countQuestions } = world();

    await service.log(HANDED_OFF);

    expect(storedBy(create)).toMatchObject({ handedOff: true, questionReference: null, queue: 'needs-answer' });
    expect(countQuestions).not.toHaveBeenCalled();
  });

  it('checks no question when the turn gave no reference', async () => {
    const { service, countQuestions } = world();
    await service.log(input);
    expect(countQuestions).not.toHaveBeenCalled();
  });
});

describe('inquiries.log, the queue', () => {
  it('puts a hand-off in Needs an answer at once, before anything is labelled', async () => {
    const { service, create } = world();
    await service.log({ ...input, handedOff: true });
    expect(storedBy(create).queue).toBe('needs-answer');
  });

  it.each([
    ['answered from product knowledge', { knowledgeFound: true }],
    ['not answered from it, and not handed off', { knowledgeFound: false }],
  ])('puts a turn that was %s in no queue until it is labelled', async (_label, facts) => {
    const { service, create } = world();
    await service.log({ ...input, ...facts, handedOff: false });
    expect(storedBy(create).queue).toBe('none');
  });
});
