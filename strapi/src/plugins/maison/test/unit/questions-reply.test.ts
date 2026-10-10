import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UID } from '../../server/src/constants';
import { acknowledgementText, answerText, knowledgeTitleOf } from '../../server/src/domain/question-messages';
import questions from '../../server/src/services/questions';
import { LINE_API, LINE_USER_ID, TOKEN, lineAnswers } from './fake-line';
import { fakeStrapi } from './fake-strapi';

type Doc = Record<string, any>;
type Language = 'ja' | 'en';
/** A product in one language: published unless `status` says draft. */
type Piece = { slug: string; name: string; locale: Language; status?: 'published' | 'draft' };

/** The customer as the session gives them. LINE's own user ID is what follows `line:`. */
const SUBJECT = `line:${LINE_USER_ID}`;
const ASKED = 'Can the coffret hold a watch?';
const TEXT = 'Yes, a watch up to 42 mm fits.';
const NOW = new Date('2026-10-01T06:00:00.000Z');
const WITH_TOKEN = { lineChannelAccessToken: TOKEN, lineApiBaseUrl: LINE_API };
/** What staff send with Answer: the answer, to be added to product knowledge under a category. */
const ADD_TO_KNOWLEDGE = { text: TEXT, addToKnowledge: true, category: 'sizing' as const };
const ONLY_SEND = { text: TEXT, addToKnowledge: false };

const COFFRET: Piece[] = [
  { slug: 'jewelry-coffret', name: 'ジュエリー・コフレ', locale: 'ja' },
  { slug: 'jewelry-coffret', name: 'Jewelry Coffret', locale: 'en' },
];

/** Q-4821 right after the hand-off: an open question in English, about a piece. */
const OPEN: Doc = {
  documentId: 'doc-1',
  reference: 'Q-4821',
  customer: SUBJECT,
  customerName: 'Paul (test)',
  question: ASKED,
  reason: 'no_answer',
  language: 'en',
  productSlug: 'jewelry-coffret',
  status: 'open',
  staffName: null,
  takenAt: null,
  answeredAt: null,
  answer: null,
  knowledgeDocumentId: null,
  lineOutcome: null,
  lineDetail: null,
  createdAt: '2026-10-01T05:30:00.000Z',
};
const TAKEN: Doc = { ...OPEN, status: 'taken', staffName: 'Jane', takenAt: '2026-10-01T05:35:00.000Z', lineOutcome: 'sent', lineDetail: '' };
const ANSWERED: Doc = {
  ...TAKEN,
  status: 'answered',
  answeredAt: '2026-10-01T05:40:00.000Z',
  answer: TEXT,
  knowledgeDocumentId: 'k-1',
};

interface WorldOptions {
  /** The question as the database holds it, or null when there is none. */
  question?: Doc | null;
  pieces?: Piece[];
  config?: Record<string, unknown>;
}

/**
 * The Document Service as notify and answer read and write it. The question is kept, and `update` writes into it as the
 * database would, so a second call sees what the first one did. A piece is found only in its own language, and only in
 * the status asked for. A knowledge entry gets the ID `k-new`. The inquiries service is a stand-in that does nothing,
 * so a test reads what `answer` asked of it.
 */
const world = ({ question = OPEN, pieces = COFFRET, config = WITH_TOKEN }: WorldOptions = {}) => {
  const stored: Doc | null = question && { ...question };
  const findQuestion = vi.fn(async ({ filters }: Doc) => (stored && filters?.reference?.$eq === stored.reference ? { ...stored } : null));
  const update = vi.fn(async ({ data }: { documentId: string; data: Doc }) => Object.assign(stored ?? {}, data));
  const findPiece = vi.fn(
    async ({ locale, status, filters }: Doc) =>
      pieces.find((piece) => piece.locale === locale && (piece.status ?? 'published') === status && piece.slug === filters?.slug?.$eq) ?? null
  );
  const createEntry = vi.fn(async ({ data }: { locale: string; data: Doc }) => ({ documentId: 'k-new', ...data }));
  const publishEntry = vi.fn(async ({ documentId }: { documentId: string; locale: string }) => ({ entries: [{ documentId }] }));
  const documents = (uid: string) => {
    if (uid === UID.question) return { findFirst: findQuestion, update };
    if (uid === UID.product) return { findFirst: findPiece };
    if (uid === UID.knowledge) return { create: createEntry, publish: publishEntry };
    throw new Error(`These tests have no ${uid}.`);
  };
  const markQuestionReplied = vi.fn(async (_reference: string, _reply: Doc): Promise<void> => undefined);
  const strapi = fakeStrapi({ documents, config, services: { inquiries: { markQuestionReplied } } });
  return { service: questions({ strapi }), strapi, stored, findQuestion, update, findPiece, createEntry, publishEntry, markQuestionReplied };
};
type World = ReturnType<typeof world>;

/** `fetch` when no answer comes: it rejects with `error`. */
const rejects = (error: unknown) => vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => Promise.reject(error));

let fetchMock: ReturnType<typeof lineAnswers>;
const useFetch = (mock: ReturnType<typeof lineAnswers>) => {
  fetchMock = mock;
  vi.stubGlobal('fetch', mock);
};

/** The one push LINE was asked for: where it went, and the one message in it. */
const pushed = () => {
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0];
  const body = JSON.parse(String(init.body));
  return { url, init, body, message: body.messages[0] as { type: string; text: string } };
};

/** Nothing went out to LINE, and nothing was written: not the question, not product knowledge, and not an inquiry. */
const expectNothingDone = ({ update, createEntry, publishEntry, markQuestionReplied }: World) => {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(createEntry).not.toHaveBeenCalled();
  expect(publishEntry).not.toHaveBeenCalled();
  expect(markQuestionReplied).not.toHaveBeenCalled();
};

/** Where a mock was first called in the order of all mock calls, to say what ran before what. */
const firstCall = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0];

// Nothing here reaches LINE: every test starts with fetch stubbed to answer 200 itself, and the API address is this machine's.
beforeEach(() => useFetch(lineAnswers()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('questions.notify', () => {
  it("pushes one text message to the customer's LINE user, in the staff member's name, and marks the question taken", async () => {
    const { service, update, findQuestion } = world();

    const outcome = await service.notify('Q-4821', 'Jane', NOW);

    const { url, init, body, message } = pushed();
    expect(url).toBe(`${LINE_API}/v2/bot/message/push`);
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
    expect(body.to).toBe(LINE_USER_ID);
    expect(body.messages).toHaveLength(1);
    expect(message.type).toBe('text');
    expect(message.text).toBe(acknowledgementText({ language: 'en', staffName: 'Jane', question: ASKED, productName: 'Jewelry Coffret' }));
    expect(message.text).toBe(
      'Hello, this is Jane, a client advisor at Maison. Thank you for your question about the Jewelry Coffret: "Can the coffret hold a watch?" I\'m looking into it and will reply here in this chat as soon as I can.\nJane, Maison'
    );
    expect(findQuestion).toHaveBeenCalledExactlyOnceWith({ filters: { reference: { $eq: 'Q-4821' } } });
    expect(update).toHaveBeenCalledExactlyOnceWith({
      documentId: 'doc-1',
      data: { status: 'taken', staffName: 'Jane', takenAt: NOW, lineOutcome: 'sent', lineDetail: '' },
    });
    expect(outcome).toEqual({ reference: 'Q-4821', status: 'sent', message: 'Sent the LINE message for Q-4821.' });
    expect(outcome).not.toHaveProperty('warning');
  });

  it.each([
    ['English', { ...OPEN }, 'Jewelry Coffret'],
    ['Japanese', { ...OPEN, language: 'ja', question: '腕時計は入りますか？' }, 'ジュエリー・コフレ'],
  ])("writes in %s for a question in it, with the piece's name in that language", async (_label, question, productName) => {
    const { service } = world({ question });

    await service.notify('Q-4821', 'Jane', NOW);

    expect(pushed().message.text).toBe(
      acknowledgementText({ language: question.language, staffName: 'Jane', question: question.question, productName })
    );
    expect(pushed().message.text).toContain(productName);
  });

  it("names the piece in the default language when the question's language has no version of it", async () => {
    const { service, findPiece } = world({ pieces: [COFFRET[0]] });

    await service.notify('Q-4821', 'Jane', NOW);

    expect(findPiece.mock.calls.map(([params]) => params.locale)).toEqual(['en', 'ja']);
    expect(pushed().message.text).toContain('about the ジュエリー・コフレ:');
  });

  it('leaves the piece out of the message, and looks none up, when the question is not about one', async () => {
    const { service, findPiece } = world({ question: { ...OPEN, productSlug: null } });

    await service.notify('Q-4821', 'Jane', NOW);

    expect(findPiece).not.toHaveBeenCalled();
    expect(pushed().message.text).toBe(acknowledgementText({ language: 'en', staffName: 'Jane', question: ASKED, productName: null }));
    expect(pushed().message.text).not.toContain('about the');
  });

  it('leaves the piece out of the message when it is no longer published, and still sends it', async () => {
    const { service } = world({ pieces: COFFRET.map((piece) => ({ ...piece, status: 'draft' as const })) });

    expect((await service.notify('Q-4821', 'Jane', NOW)).status).toBe('sent');

    expect(pushed().message.text).not.toContain('about the');
  });

  it("speaks for the team, and records no name, without a staff member's name", async () => {
    const { service, update } = world();

    expect((await service.notify('Q-4821', null, NOW)).status).toBe('sent');

    expect(pushed().message.text).toBe(acknowledgementText({ language: 'en', staffName: null, question: ASKED, productName: 'Jewelry Coffret' }));
    expect(pushed().message.text.startsWith("Hello, this is Maison's client advisor team.")).toBe(true);
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'taken', staffName: null });
  });

  it('takes the time from the clock when it is not given one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { service, update } = world();

    await service.notify('Q-4821', 'Jane');

    expect(update.mock.calls[0][0].data.takenAt).toEqual(NOW);
  });

  describe('when LINE does not take the message', () => {
    const REFUSAL = "The property, 'to', in the request body is invalid (line 1, column 6)";

    it('records why, leaves the question open with nothing else changed, and answers failed', async () => {
      useFetch(lineAnswers(400, { message: REFUSAL }));
      const { service, update, stored } = world();

      const outcome = await service.notify('Q-4821', 'Jane', NOW);

      const detail = `LINE answered 400: ${REFUSAL}`;
      expect(update).toHaveBeenCalledExactlyOnceWith({ documentId: 'doc-1', data: { lineOutcome: 'failed', lineDetail: detail } });
      expect(stored).toMatchObject({ status: 'open', staffName: null, takenAt: null, lineOutcome: 'failed', lineDetail: detail });
      expect(outcome).toEqual({ reference: 'Q-4821', status: 'failed', message: `The LINE message for Q-4821 wasn't sent. ${detail}` });
      expect(outcome.message.startsWith("The LINE message for Q-4821 wasn't sent.")).toBe(true);
      // Nothing went out, so it is an error for the admin to read, not a warning on a message that did.
      expect(outcome).not.toHaveProperty('warning');
    });

    it("records that LINE couldn't be reached", async () => {
      useFetch(rejects(Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED 127.0.0.1:4010') })));
      const { service, update } = world();

      const outcome = await service.notify('Q-4821', 'Jane', NOW);

      expect(outcome.status).toBe('failed');
      expect(update.mock.calls[0][0].data).toEqual({ lineOutcome: 'failed', lineDetail: "LINE couldn't be reached: connect ECONNREFUSED 127.0.0.1:4010" });
    });

    it('lets the next Let them know send, and then marks the question taken, with the failure gone', async () => {
      useFetch(lineAnswers(500, { message: 'Try later' }));
      const w = world();
      expect((await w.service.notify('Q-4821', 'Jane', NOW)).status).toBe('failed');

      useFetch(lineAnswers());
      expect((await w.service.notify('Q-4821', 'Jane', NOW)).status).toBe('sent');

      expect(w.stored).toMatchObject({ status: 'taken', staffName: 'Jane', lineOutcome: 'sent', lineDetail: '' });
    });

    it('takes the token out of the detail, the message and every log, even when the error quotes it', async () => {
      // undici quotes a header value it refuses, Authorization included.
      useFetch(rejects(new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`)));
      const { service, update, strapi } = world();

      const outcome = await service.notify('Q-4821', 'Jane', NOW);

      expect(outcome.status).toBe('failed');
      expect(update.mock.calls[0][0].data.lineDetail).toBe(
        'LINE couldn\'t be reached: Headers.append: "Bearer [token]" is an invalid header value.'
      );
      const written = JSON.stringify([outcome, update.mock.calls, strapi.log.warn.mock.calls, strapi.log.info.mock.calls, strapi.log.error.mock.calls]);
      expect(written).not.toContain(TOKEN);
    });

    it('takes the token out before it cuts the detail, so no piece of it is left at the cut', async () => {
      // "LINE answered 400: " is 19 units, so the token starts at unit 489. Cut first, it would leave "test-chann" there.
      useFetch(lineAnswers(400, { message: `${'a'.repeat(470)}${TOKEN}` }));
      const { service, update } = world();

      await service.notify('Q-4821', 'Jane', NOW);

      const { lineDetail } = update.mock.calls[0][0].data;
      expect(lineDetail).toBe(`LINE answered 400: ${'a'.repeat(470)}[token]`);
      expect(lineDetail).not.toContain('test-c');
    });

    it('cuts the detail to 500 UTF-16 units, the length Strapi allows: 500 stay whole and 501 are cut', async () => {
      // "LINE answered 400: " is 19 units.
      for (const [message, detail] of [
        ['x'.repeat(481), `LINE answered 400: ${'x'.repeat(481)}`],
        ['x'.repeat(482), `LINE answered 400: ${'x'.repeat(480)}…`],
      ]) {
        useFetch(lineAnswers(400, { message }));
        const { service, update } = world();
        const outcome = await service.notify('Q-4821', 'Jane', NOW);
        const { lineDetail } = update.mock.calls[0][0].data;
        expect(lineDetail).toBe(detail);
        expect(lineDetail.length).toBeLessThanOrEqual(500);
        expect(outcome.message).toBe(`The LINE message for Q-4821 wasn't sent. ${detail}`);
      }
    });

    it('never splits an emoji when it cuts the detail', async () => {
      useFetch(lineAnswers(400, { message: '😀'.repeat(300) }));
      const { service, update } = world();

      await service.notify('Q-4821', 'Jane', NOW);

      const { lineDetail } = update.mock.calls[0][0].data;
      expect(lineDetail.length).toBeLessThanOrEqual(500);
      expect(lineDetail.endsWith('…')).toBe(true);
      expect(lineDetail).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });

    it('still answers failed, and logs that recording it failed too, when recording why LINE refused fails', async () => {
      useFetch(lineAnswers(400, { message: 'Bad request' }));
      const { service, update, strapi } = world();
      update.mockRejectedValueOnce(new Error('database is locked'));

      const outcome = await service.notify('Q-4821', 'Jane', NOW);

      expect(outcome).toEqual({ reference: 'Q-4821', status: 'failed', message: "The LINE message for Q-4821 wasn't sent. LINE answered 400: Bad request" });
      expect(strapi.log.error).toHaveBeenCalledExactlyOnceWith("[maison] The failed LINE message for Q-4821 couldn't be recorded: database is locked");
      expect(strapi.log.warn).toHaveBeenCalledExactlyOnceWith("[maison] The LINE message for Q-4821 wasn't sent. LINE answered 400: Bad request");
    });
  });

  describe('when nothing can be sent', () => {
    it('answers not_found for a reference no question has, and sends and writes nothing', async () => {
      const w = world({ question: null });

      expect(await w.service.notify('Q-4821', 'Jane', NOW)).toEqual({ reference: 'Q-4821', status: 'not_found', message: 'No question Q-4821.' });

      expectNothingDone(w);
    });

    it('answers not_found for another question’s reference', async () => {
      const w = world();
      expect(await w.service.notify('Q-9999', 'Jane', NOW)).toEqual({ reference: 'Q-9999', status: 'not_found', message: 'No question Q-9999.' });
      expectNothingDone(w);
    });

    it.each([
      ['by name, for the staff member who took it', { staffName: 'Jane' }, 'Jane has let the customer know already.'],
      ['by "Someone", when it has no name', { staffName: null }, 'Someone has let the customer know already.'],
      ['by "Someone", when its name is empty', { staffName: '' }, 'Someone has let the customer know already.'],
    ])('answers already_taken, %s, and sends and writes nothing', async (_label, fields, message) => {
      const w = world({ question: { ...TAKEN, ...fields } });

      // Whoever clicks, the message names whoever took it.
      expect(await w.service.notify('Q-4821', 'Tom', NOW)).toEqual({ reference: 'Q-4821', status: 'already_taken', message });

      expectNothingDone(w);
    });

    it('answers already_answered for an answered question, and sends and writes nothing', async () => {
      const w = world({ question: ANSWERED });

      expect(await w.service.notify('Q-4821', 'Jane', NOW)).toEqual({
        reference: 'Q-4821',
        status: 'already_answered',
        message: 'Question Q-4821 has been answered already.',
      });

      expectNothingDone(w);
    });

    it.each([
      ['no token is set', {}],
      ['the token is empty', { lineChannelAccessToken: '', lineApiBaseUrl: LINE_API }],
    ])('answers not_configured when %s, and sends and writes nothing', async (_label, config) => {
      const w = world({ config });

      expect(await w.service.notify('Q-4821', 'Jane', NOW)).toEqual({
        reference: 'Q-4821',
        status: 'not_configured',
        message: "LINE_CHANNEL_ACCESS_TOKEN isn't set: Strapi can't message customers on LINE.",
      });

      expectNothingDone(w);
      expect(w.strapi.log.warn).toHaveBeenCalledExactlyOnceWith("[maison] LINE_CHANNEL_ACCESS_TOKEN isn't set: Strapi can't message customers on LINE.");
    });

    it('checks the question before the token: a taken question is already_taken even with no token', async () => {
      const w = world({ question: TAKEN, config: {} });
      expect((await w.service.notify('Q-4821', 'Jane', NOW)).status).toBe('already_taken');
    });

    it('looks no piece up, and builds no message, for a question it will not send', async () => {
      const w = world({ question: ANSWERED });
      await w.service.notify('Q-4821', 'Jane', NOW);
      expect(w.findPiece).not.toHaveBeenCalled();
    });
  });

  describe('when LINE took the message but the question could not be updated', () => {
    it.each([
      ['an error', new Error('database is locked'), 'database is locked'],
      ['something that is not an error', 'boom', 'boom'],
    ])("answers sent, and says not to send it again: the update failed with %s", async (_label, failure, reason) => {
      const { service, update, strapi } = world();
      update.mockRejectedValueOnce(failure);

      const outcome = await service.notify('Q-4821', 'Jane', NOW);

      const message = `Sent the LINE message for Q-4821, but recording it failed (${reason}). Don't send it again.`;
      expect(outcome).toEqual({ reference: 'Q-4821', status: 'sent', message, warning: true });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(strapi.log.error).toHaveBeenCalledExactlyOnceWith(`[maison] ${message}`);
      expect(strapi.log.info).not.toHaveBeenCalled();
    });

    it('takes the token out of the reason', async () => {
      const { service, update, strapi } = world();
      update.mockRejectedValueOnce(new Error(`request to https://x.test/?access_token=${TOKEN} failed`));

      const outcome = await service.notify('Q-4821', 'Jane', NOW);

      expect(outcome.message).toBe(
        "Sent the LINE message for Q-4821, but recording it failed (request to https://x.test/?access_token=[token] failed). Don't send it again."
      );
      expect(JSON.stringify([outcome, strapi.log.error.mock.calls])).not.toContain(TOKEN);
    });
  });

  it('logs what it sent', async () => {
    const { service, strapi } = world();
    await service.notify('Q-4821', 'Jane', NOW);
    expect(strapi.log.info).toHaveBeenCalledExactlyOnceWith('[maison] Sent the LINE message for Q-4821.');
    expect(strapi.log.warn).not.toHaveBeenCalled();
    expect(strapi.log.error).not.toHaveBeenCalled();
  });

  it('logs a refusal as a warning', async () => {
    useFetch(lineAnswers(429, { message: 'You have reached your monthly limit.' }));
    const { service, strapi } = world();
    await service.notify('Q-4821', 'Jane', NOW);
    expect(strapi.log.warn).toHaveBeenCalledExactlyOnceWith(
      "[maison] The LINE message for Q-4821 wasn't sent. LINE answered 429: You have reached your monthly limit."
    );
    expect(strapi.log.info).not.toHaveBeenCalled();
  });
});

describe('questions.answer', () => {
  it("pushes the answer in the staff member's name, adds it to product knowledge in the question's language, and marks the question answered", async () => {
    const { service, update, createEntry, publishEntry } = world();

    const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

    const { url, init, body, message } = pushed();
    expect(url).toBe(`${LINE_API}/v2/bot/message/push`);
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
    expect(body.to).toBe(LINE_USER_ID);
    expect(body.messages).toHaveLength(1);
    expect(message.type).toBe('text');
    expect(message.text).toBe(answerText({ language: 'en', staffName: 'Jane', question: ASKED, productName: 'Jewelry Coffret', answer: TEXT }));
    expect(message.text).toBe(
      `Hello, this is Jane, a client advisor at Maison. Thank you for your question about the Jewelry Coffret: "Can the coffret hold a watch?"\n\n${TEXT}\n\nIf anything else comes to mind, just reply here.\nJane, Maison`
    );
    expect(createEntry).toHaveBeenCalledExactlyOnceWith({
      locale: 'en',
      data: { title: ASKED, answer: TEXT, category: 'sizing', productSlugs: ['jewelry-coffret'], keywords: '' },
    });
    expect(publishEntry).toHaveBeenCalledExactlyOnceWith({ documentId: 'k-new', locale: 'en' });
    expect(update).toHaveBeenCalledExactlyOnceWith({
      documentId: 'doc-1',
      data: {
        status: 'answered',
        staffName: 'Jane',
        answeredAt: NOW,
        answer: TEXT,
        knowledgeDocumentId: 'k-new',
        lineOutcome: 'sent',
        lineDetail: '',
      },
    });
    expect(outcome).toEqual({
      reference: 'Q-4821',
      status: 'sent',
      message: 'Sent the answer to Q-4821 on LINE. Added it to product knowledge.',
      knowledgeDocumentId: 'k-new',
    });
    expect(outcome).not.toHaveProperty('warning');
  });

  it('pushes first, then creates the entry, then publishes it, and records it all on the question last', async () => {
    const { service, update, createEntry, publishEntry } = world();

    await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

    expect(firstCall(fetchMock)).toBeLessThan(firstCall(createEntry));
    expect(firstCall(createEntry)).toBeLessThan(firstCall(publishEntry));
    expect(firstCall(publishEntry)).toBeLessThan(firstCall(update));
  });

  it.each([
    ['en' as const, 'Jewelry Coffret'],
    ['ja' as const, 'ジュエリー・コフレ'],
  ])('creates and publishes the entry in the question’s language, %s, and writes the message in it', async (language, productName) => {
    const { service, createEntry, publishEntry } = world({ question: { ...OPEN, language, question: '腕時計は入りますか？' } });

    await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

    expect(createEntry.mock.calls[0][0]).toMatchObject({ locale: language, data: { title: '腕時計は入りますか？' } });
    expect(publishEntry).toHaveBeenCalledExactlyOnceWith({ documentId: 'k-new', locale: language });
    expect(pushed().message.text).toBe(answerText({ language, staffName: 'Jane', question: '腕時計は入りますか？', productName, answer: TEXT }));
  });

  it('gives the entry the piece’s slug, as the question has it', async () => {
    // A piece that is no longer published has no name for the message, but the entry is still about it.
    const { service, createEntry } = world({ pieces: [] });

    await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

    expect(createEntry.mock.calls[0][0].data.productSlugs).toEqual(['jewelry-coffret']);
    expect(pushed().message.text).not.toContain('about the');
  });

  it('gives the entry no piece when the question is not about one, and leaves the piece out of the message', async () => {
    const { service, createEntry, findPiece } = world({ question: { ...OPEN, productSlug: null } });

    await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

    expect(createEntry.mock.calls[0][0].data.productSlugs).toEqual([]);
    expect(findPiece).not.toHaveBeenCalled();
    expect(pushed().message.text).toBe(answerText({ language: 'en', staffName: 'Jane', question: ASKED, productName: null, answer: TEXT }));
  });

  it("speaks for the team, and records no name, without a staff member's name", async () => {
    const { service, update } = world();

    expect((await service.answer('Q-4821', ADD_TO_KNOWLEDGE, null, NOW)).status).toBe('sent');

    expect(pushed().message.text.startsWith("Hello, this is Maison's client advisor team.")).toBe(true);
    expect(pushed().message.text.endsWith('\nMaison')).toBe(true);
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'answered', staffName: null });
  });

  it('cuts the entry’s title to the 200 UTF-16 units Strapi allows, and keeps the whole answer', async () => {
    const long = `Can the coffret hold ${'😀'.repeat(150)} a watch?`;
    const answer = 'y'.repeat(2000);
    const { service, createEntry } = world({ question: { ...OPEN, question: long } });

    await service.answer('Q-4821', { ...ADD_TO_KNOWLEDGE, text: answer }, 'Jane', NOW);

    const { title, answer: stored } = createEntry.mock.calls[0][0].data;
    expect(title).toBe(knowledgeTitleOf(long));
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.endsWith('…')).toBe(true);
    expect(stored).toBe(answer);
  });

  it('keeps the answer as it was written on the question', async () => {
    const { service, update } = world();
    await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);
    expect(update.mock.calls[0][0].data.answer).toBe(TEXT);
  });

  // The title is what customers see over the answer in the concierge, so staff can write it in place of the customer's words.
  describe('the title of the knowledge entry', () => {
    const TITLE = 'Does a watch fit in the coffret?';
    const titleOfEntry = (createEntry: World['createEntry']): string => createEntry.mock.calls[0][0].data.title;

    it("is the title staff wrote, in place of the customer's question", async () => {
      const { service, createEntry, publishEntry } = world();

      await service.answer('Q-4821', { ...ADD_TO_KNOWLEDGE, title: TITLE }, 'Jane', NOW);

      expect(createEntry).toHaveBeenCalledExactlyOnceWith({
        locale: 'en',
        data: { title: TITLE, answer: TEXT, category: 'sizing', productSlugs: ['jewelry-coffret'], keywords: '' },
      });
      expect(publishEntry).toHaveBeenCalledExactlyOnceWith({ documentId: 'k-new', locale: 'en' });
    });

    it("leaves the message to the customer quoting their own words, and the question's record without a title", async () => {
      const { service, update } = world();

      await service.answer('Q-4821', { ...ADD_TO_KNOWLEDGE, title: TITLE }, 'Jane', NOW);

      expect(pushed().message.text).toBe(answerText({ language: 'en', staffName: 'Jane', question: ASKED, productName: 'Jewelry Coffret', answer: TEXT }));
      expect(pushed().message.text).not.toContain(TITLE);
      expect(update.mock.calls[0][0].data).not.toHaveProperty('title');
    });

    it.each([
      ['given none', undefined],
      ['given a title of only spaces', '  \n '],
      ['given an empty title', ''],
    ])("is the customer's question when the service is %s", async (_label, title) => {
      const { service, createEntry } = world();

      await service.answer('Q-4821', { ...ADD_TO_KNOWLEDGE, title }, 'Jane', NOW);

      expect(titleOfEntry(createEntry)).toBe(ASKED);
    });

    it('is cut to the 200 UTF-16 units Strapi allows, as a question is: no emoji is split', async () => {
      const long = `Does a watch fit ${'😀'.repeat(150)} in the coffret?`;
      const { service, createEntry } = world();

      await service.answer('Q-4821', { ...ADD_TO_KNOWLEDGE, title: long }, 'Jane', NOW);

      const title = titleOfEntry(createEntry);
      expect(title).toBe(knowledgeTitleOf(long));
      expect(title.length).toBeLessThanOrEqual(200);
      expect(title.endsWith('…')).toBe(true);
      expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });

    it('has its whitespace collapsed and its ends trimmed, as a question does', async () => {
      const { service, createEntry } = world();
      await service.answer('Q-4821', { ...ADD_TO_KNOWLEDGE, title: '  Does a watch\n fit   in the coffret? ' }, 'Jane', NOW);
      expect(titleOfEntry(createEntry)).toBe(TITLE);
    });

    it('is written in the question’s language along with the entry', async () => {
      const { service, createEntry } = world({ question: { ...OPEN, language: 'ja', question: '腕時計は入りますか？' } });

      await service.answer('Q-4821', { ...ADD_TO_KNOWLEDGE, title: 'コフレに腕時計は入りますか' }, 'Jane', NOW);

      expect(createEntry.mock.calls[0][0]).toMatchObject({ locale: 'ja', data: { title: 'コフレに腕時計は入りますか' } });
    });

    it('is not used, and nothing is created, when the answer is not added to product knowledge', async () => {
      const { service, createEntry, publishEntry } = world();

      const outcome = await service.answer('Q-4821', { ...ONLY_SEND, title: TITLE }, 'Jane', NOW);

      expect(outcome).toEqual({ reference: 'Q-4821', status: 'sent', message: 'Sent the answer to Q-4821 on LINE.' });
      expect(createEntry).not.toHaveBeenCalled();
      expect(publishEntry).not.toHaveBeenCalled();
    });
  });

  describe('without adding it to product knowledge', () => {
    it('sends the answer and records it, and creates and publishes nothing', async () => {
      const { service, update, createEntry, publishEntry } = world();

      const outcome = await service.answer('Q-4821', ONLY_SEND, 'Jane', NOW);

      expect(createEntry).not.toHaveBeenCalled();
      expect(publishEntry).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledExactlyOnceWith({
        documentId: 'doc-1',
        data: { status: 'answered', staffName: 'Jane', answeredAt: NOW, answer: TEXT, lineOutcome: 'sent', lineDetail: '' },
      });
      expect(update.mock.calls[0][0].data).not.toHaveProperty('knowledgeDocumentId');
      expect(outcome).toEqual({ reference: 'Q-4821', status: 'sent', message: 'Sent the answer to Q-4821 on LINE.' });
      expect(outcome).not.toHaveProperty('knowledgeDocumentId');
      expect(outcome).not.toHaveProperty('warning');
    });

    it('creates nothing even when a category came with it', async () => {
      const { service, createEntry } = world();
      await service.answer('Q-4821', { text: TEXT, addToKnowledge: false, category: 'sizing' }, 'Jane', NOW);
      expect(createEntry).not.toHaveBeenCalled();
    });
  });

  it('can answer a question someone has taken, and the answer is in the name of whoever sends it', async () => {
    const { service, update, stored } = world({ question: TAKEN });

    const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Tom', NOW);

    expect(outcome.status).toBe('sent');
    expect(pushed().message.text).toContain('Hello, this is Tom, a client advisor at Maison.');
    // It leaves when it was taken alone, and who took it is replaced by who answered.
    expect(update.mock.calls[0][0].data).not.toHaveProperty('takenAt');
    expect(stored).toMatchObject({ status: 'answered', staffName: 'Tom', takenAt: '2026-10-01T05:35:00.000Z', answeredAt: NOW });
  });

  it('takes the time from the clock when it is not given one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { service, update } = world();

    await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane');

    expect(update.mock.calls[0][0].data.answeredAt).toEqual(NOW);
  });

  describe('when LINE does not take the answer', () => {
    it.each([
      ['open', OPEN],
      ['taken', TAKEN],
    ])('creates nothing and leaves the %s question as it was, with only why recorded', async (_label, question) => {
      useFetch(lineAnswers(400, { message: 'Bad request' }));
      const { service, update, createEntry, publishEntry, stored } = world({ question });

      const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      expect(outcome).toEqual({
        reference: 'Q-4821',
        status: 'failed',
        message: "The LINE message for Q-4821 wasn't sent. LINE answered 400: Bad request",
      });
      expect(createEntry).not.toHaveBeenCalled();
      expect(publishEntry).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledExactlyOnceWith({
        documentId: 'doc-1',
        data: { lineOutcome: 'failed', lineDetail: 'LINE answered 400: Bad request' },
      });
      expect(stored).toMatchObject({
        status: question.status,
        staffName: question.staffName,
        answer: null,
        answeredAt: null,
        knowledgeDocumentId: null,
        lineOutcome: 'failed',
      });
    });

    it('keeps the token out of the detail and the logs', async () => {
      useFetch(rejects(new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`)));
      const { service, update, strapi } = world();

      const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      expect(outcome.status).toBe('failed');
      expect(JSON.stringify([outcome, update.mock.calls, strapi.log.warn.mock.calls, strapi.log.error.mock.calls])).not.toContain(TOKEN);
      expect(update.mock.calls[0][0].data.lineDetail).toContain('Bearer [token]');
    });

    it('lets the next Answer send, and then answers the question', async () => {
      useFetch(lineAnswers(500, { message: 'Try later' }));
      const w = world();
      expect((await w.service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW)).status).toBe('failed');

      useFetch(lineAnswers());
      const outcome = await w.service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      expect(outcome).toMatchObject({ status: 'sent', knowledgeDocumentId: 'k-new' });
      expect(w.stored).toMatchObject({ status: 'answered', lineOutcome: 'sent', lineDetail: '', knowledgeDocumentId: 'k-new' });
      expect(w.createEntry).toHaveBeenCalledOnce();
    });
  });

  describe('when the entry could not be added to product knowledge', () => {
    it('still answers the question, without the entry, and says why it is not in product knowledge', async () => {
      const { service, update, createEntry, publishEntry, strapi } = world();
      createEntry.mockRejectedValueOnce(new Error('productSlugs contains "NOPE"; use product slugs like "weekender-50"'));

      const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      const message =
        'Sent the answer to Q-4821 on LINE. It couldn\'t be added to product knowledge: productSlugs contains "NOPE"; use product slugs like "weekender-50"';
      expect(outcome).toEqual({ reference: 'Q-4821', status: 'sent', message, warning: true });
      expect(outcome).not.toHaveProperty('knowledgeDocumentId');
      expect(publishEntry).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledExactlyOnceWith({
        documentId: 'doc-1',
        data: { status: 'answered', staffName: 'Jane', answeredAt: NOW, answer: TEXT, lineOutcome: 'sent', lineDetail: '' },
      });
      expect(strapi.log.warn).toHaveBeenCalledExactlyOnceWith(`[maison] ${message}`);
      expect(strapi.log.error).not.toHaveBeenCalled();
    });

    it('does not link an entry it created but could not publish: the question says it was not added', async () => {
      const { service, update, stored, publishEntry } = world();
      publishEntry.mockRejectedValueOnce(new Error('database is locked'));

      const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      expect(outcome).toEqual({
        reference: 'Q-4821',
        status: 'sent',
        message: "Sent the answer to Q-4821 on LINE. It couldn't be added to product knowledge: database is locked",
        warning: true,
      });
      expect(update.mock.calls[0][0].data).not.toHaveProperty('knowledgeDocumentId');
      expect(stored).toMatchObject({ status: 'answered', knowledgeDocumentId: null });
    });

    it('takes the token out of the reason', async () => {
      const { service, createEntry, strapi } = world();
      createEntry.mockRejectedValueOnce(new Error(`could not reach https://x.test/?access_token=${TOKEN}`));

      const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      expect(outcome.message).toBe("Sent the answer to Q-4821 on LINE. It couldn't be added to product knowledge: could not reach https://x.test/?access_token=[token]");
      expect(JSON.stringify([outcome, strapi.log.warn.mock.calls])).not.toContain(TOKEN);
    });
  });

  describe('when LINE took the answer but the question could not be updated', () => {
    it.each([
      ['an error', new Error('database is locked'), 'database is locked'],
      ['something that is not an error', 'boom', 'boom'],
    ])('answers sent, and says not to send it again: the update failed with %s', async (_label, failure, reason) => {
      const { service, update, strapi } = world();
      update.mockRejectedValueOnce(failure);

      const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      const message = `Sent the answer to Q-4821 on LINE, but recording it failed (${reason}). Don't send it again.`;
      expect(outcome).toEqual({ reference: 'Q-4821', status: 'sent', message, warning: true });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(strapi.log.error).toHaveBeenCalledExactlyOnceWith(`[maison] ${message}`);
      expect(strapi.log.info).not.toHaveBeenCalled();
    });

    it('says so without adding it to product knowledge either', async () => {
      const { service, update, createEntry } = world();
      update.mockRejectedValueOnce(new Error('database is locked'));

      const outcome = await service.answer('Q-4821', ONLY_SEND, 'Jane', NOW);

      expect(outcome.message).toBe("Sent the answer to Q-4821 on LINE, but recording it failed (database is locked). Don't send it again.");
      expect(outcome.warning).toBe(true);
      expect(createEntry).not.toHaveBeenCalled();
    });

    it('takes the token out of the reason', async () => {
      const { service, update, strapi } = world();
      update.mockRejectedValueOnce(new Error(`request to https://x.test/?access_token=${TOKEN} failed`));

      const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      expect(outcome.message).toContain('access_token=[token] failed');
      expect(JSON.stringify([outcome, strapi.log.error.mock.calls])).not.toContain(TOKEN);
    });
  });

  describe('when nothing can be sent', () => {
    it('answers not_found for a reference no question has, and sends and writes nothing', async () => {
      const w = world({ question: null });

      expect(await w.service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW)).toEqual({
        reference: 'Q-4821',
        status: 'not_found',
        message: 'No question Q-4821.',
      });

      expectNothingDone(w);
    });

    it('answers already_answered for an answered question, and sends and writes nothing', async () => {
      const w = world({ question: ANSWERED });

      expect(await w.service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW)).toEqual({
        reference: 'Q-4821',
        status: 'already_answered',
        message: 'Question Q-4821 has been answered already.',
      });

      expectNothingDone(w);
    });

    it.each([
      ['no token is set', {}],
      ['the token is empty', { lineChannelAccessToken: '', lineApiBaseUrl: LINE_API }],
    ])('answers not_configured when %s, and sends and writes nothing', async (_label, config) => {
      const w = world({ config });

      expect(await w.service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW)).toEqual({
        reference: 'Q-4821',
        status: 'not_configured',
        message: "LINE_CHANNEL_ACCESS_TOKEN isn't set: Strapi can't message customers on LINE.",
      });

      expectNothingDone(w);
    });

    it('checks the question before the token: an answered question is already_answered even with no token', async () => {
      const w = world({ question: ANSWERED, config: {} });
      expect((await w.service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW)).status).toBe('already_answered');
    });
  });

  it('logs what it sent, and that it added it to product knowledge', async () => {
    const { service, strapi } = world();
    await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);
    expect(strapi.log.info).toHaveBeenCalledExactlyOnceWith('[maison] Sent the answer to Q-4821 on LINE. Added it to product knowledge.');
    expect(strapi.log.warn).not.toHaveBeenCalled();
    expect(strapi.log.error).not.toHaveBeenCalled();
  });
});

describe("questions.answer, the question's inquiries", () => {
  it("marks the question's inquiries replied once the question is answered: with the staff's text, their name, and when", async () => {
    const { service, markQuestionReplied } = world();

    await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

    // The staff member's own words, and not the message LINE carried with its greeting and signature.
    expect(markQuestionReplied).toHaveBeenCalledExactlyOnceWith('Q-4821', { replyText: TEXT, repliedBy: 'Jane', at: NOW });
  });

  it('names Maison as who replied when the answer speaks for the team', async () => {
    const { service, markQuestionReplied } = world();

    await service.answer('Q-4821', ADD_TO_KNOWLEDGE, null, NOW);

    expect(markQuestionReplied).toHaveBeenCalledExactlyOnceWith('Q-4821', { replyText: TEXT, repliedBy: 'Maison', at: NOW });
  });

  it('marks them after the question itself is recorded as answered, not before', async () => {
    const { service, update, markQuestionReplied } = world();

    await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

    expect(firstCall(fetchMock)).toBeLessThan(firstCall(update));
    expect(firstCall(update)).toBeLessThan(firstCall(markQuestionReplied));
  });

  it.each([
    ['without adding the answer to product knowledge', ONLY_SEND],
    ['when the answer is added to product knowledge', ADD_TO_KNOWLEDGE],
  ])('marks them %s', async (_label, reply) => {
    const { service, markQuestionReplied } = world();
    expect((await service.answer('Q-4821', reply, 'Jane', NOW)).status).toBe('sent');
    expect(markQuestionReplied).toHaveBeenCalledOnce();
  });

  it('marks them when the answer was sent but could not be added to product knowledge', async () => {
    const { service, createEntry, markQuestionReplied } = world();
    createEntry.mockRejectedValueOnce(new Error('database is locked'));

    const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

    expect(outcome).toMatchObject({ status: 'sent', warning: true });
    expect(markQuestionReplied).toHaveBeenCalledExactlyOnceWith('Q-4821', { replyText: TEXT, repliedBy: 'Jane', at: NOW });
  });

  it.each([
    ['open', OPEN],
    ['taken', TAKEN],
  ])('marks nothing when LINE does not take the answer to the %s question: it is still waiting for one', async (_label, question) => {
    useFetch(lineAnswers(400, { message: 'Bad request' }));
    const { service, markQuestionReplied } = world({ question });

    expect((await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW)).status).toBe('failed');

    expect(markQuestionReplied).not.toHaveBeenCalled();
  });

  it('marks nothing when the question could not be recorded as answered: it still shows as open, and so must its inquiries', async () => {
    const { service, update, markQuestionReplied } = world();
    update.mockRejectedValueOnce(new Error('database is locked'));

    const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

    expect(outcome).toMatchObject({ status: 'sent', warning: true });
    expect(markQuestionReplied).not.toHaveBeenCalled();
  });

  it('marks nothing for a question that is answered already, or that is not there', async () => {
    for (const question of [ANSWERED, null]) {
      const w = world({ question });
      await w.service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);
      expect(w.markQuestionReplied).not.toHaveBeenCalled();
    }
  });

  it('marks nothing on Let them know: the customer has only been told that someone has the question', async () => {
    const { service, markQuestionReplied } = world();

    expect((await service.notify('Q-4821', 'Jane', NOW)).status).toBe('sent');

    expect(markQuestionReplied).not.toHaveBeenCalled();
  });

  describe('when marking them fails', () => {
    it.each([
      ['rejects with an error', () => Promise.reject(new Error('database is locked')), 'database is locked'],
      ['throws', () => { throw new Error('database is locked'); }, 'database is locked'],
      ['rejects with something that is not an error', () => Promise.reject('boom'), 'boom'],
    ])('still answers sent, with the outcome it would have had, and logs a warning: it %s', async (_label, fails, reason) => {
      const { service, markQuestionReplied, update, strapi } = world();
      markQuestionReplied.mockImplementationOnce(fails);

      const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      expect(outcome).toEqual({
        reference: 'Q-4821',
        status: 'sent',
        message: 'Sent the answer to Q-4821 on LINE. Added it to product knowledge.',
        knowledgeDocumentId: 'k-new',
      });
      expect(outcome).not.toHaveProperty('warning');
      expect(update).toHaveBeenCalledOnce();
      expect(strapi.log.warn).toHaveBeenCalledExactlyOnceWith(`[maison] Q-4821 is answered, but its inquiries couldn't be marked replied: ${reason}`);
      expect(strapi.log.error).not.toHaveBeenCalled();
    });

    it('still reports a knowledge entry that could not be added, as it does when nothing fails', async () => {
      const { service, createEntry, markQuestionReplied, strapi } = world();
      createEntry.mockRejectedValueOnce(new Error('disk is full'));
      markQuestionReplied.mockRejectedValueOnce(new Error('database is locked'));

      const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      expect(outcome).toEqual({
        reference: 'Q-4821',
        status: 'sent',
        message: "Sent the answer to Q-4821 on LINE. It couldn't be added to product knowledge: disk is full",
        warning: true,
      });
      expect(strapi.log.warn).toHaveBeenCalledTimes(2);
    });

    it('takes the token out of the reason it logs', async () => {
      const { service, markQuestionReplied, strapi } = world();
      markQuestionReplied.mockRejectedValueOnce(new Error(`request to https://x.test/?access_token=${TOKEN} failed`));

      const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

      expect(outcome.status).toBe('sent');
      expect(strapi.log.warn.mock.calls[0][0]).toContain('access_token=[token] failed');
      expect(JSON.stringify([outcome, strapi.log.warn.mock.calls, strapi.log.error.mock.calls])).not.toContain(TOKEN);
    });
  });
});

describe('a second click', () => {
  it('on Let them know sends nothing more: the question is taken, so it answers already_taken, naming who took it', async () => {
    const w = world();
    expect((await w.service.notify('Q-4821', 'Jane', NOW)).status).toBe('sent');
    expect(fetchMock).toHaveBeenCalledOnce();

    const second = await w.service.notify('Q-4821', 'Tom', NOW);

    expect(second).toEqual({ reference: 'Q-4821', status: 'already_taken', message: 'Jane has let the customer know already.' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(w.update).toHaveBeenCalledOnce();
    expect(w.stored).toMatchObject({ status: 'taken', staffName: 'Jane' });
  });

  it('on Answer sends and saves nothing more: the question is answered, so it answers already_answered', async () => {
    const w = world();
    expect((await w.service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW)).status).toBe('sent');

    const second = await w.service.answer('Q-4821', { ...ADD_TO_KNOWLEDGE, text: 'Another answer.' }, 'Tom', NOW);

    expect(second).toEqual({ reference: 'Q-4821', status: 'already_answered', message: 'Question Q-4821 has been answered already.' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(w.createEntry).toHaveBeenCalledOnce();
    expect(w.publishEntry).toHaveBeenCalledOnce();
    expect(w.update).toHaveBeenCalledOnce();
    expect(w.markQuestionReplied).toHaveBeenCalledOnce();
    expect(w.stored).toMatchObject({ status: 'answered', staffName: 'Jane', answer: TEXT });
  });

  it('on Let them know after the answer sends nothing: it answers already_answered', async () => {
    const w = world();
    await w.service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW);

    expect((await w.service.notify('Q-4821', 'Jane', NOW)).status).toBe('already_answered');

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('leaves Answer open after Let them know: one acknowledgement, then one answer', async () => {
    const w = world();
    expect((await w.service.notify('Q-4821', 'Jane', NOW)).status).toBe('sent');

    expect((await w.service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Jane', NOW)).status).toBe('sent');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(w.stored).toMatchObject({ status: 'answered', staffName: 'Jane', takenAt: NOW, answeredAt: NOW });
  });
});

describe('a made-up demo customer', () => {
  const DEMO_SUBJECT = 'line:Udec0de00000000000000000000000001';
  const DEMO_OPEN: Doc = { ...OPEN, customer: DEMO_SUBJECT };
  const DEMO_TAKEN: Doc = { ...TAKEN, customer: DEMO_SUBJECT, lineOutcome: 'demo', lineDetail: 'Demo customer: no LINE message' };

  it('Let them know makes no LINE call, marks the question taken, and records the demo outcome', async () => {
    const { service, update, stored } = world({ question: DEMO_OPEN });

    const outcome = await service.notify('Q-4821', 'Jane', NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      documentId: 'doc-1',
      data: { status: 'taken', staffName: 'Jane', takenAt: NOW, lineOutcome: 'demo', lineDetail: 'Demo customer: no LINE message' },
    });
    expect(stored).toMatchObject({ status: 'taken', staffName: 'Jane', lineOutcome: 'demo' });
    expect(outcome).toEqual({ reference: 'Q-4821', status: 'demo', message: 'Marked Q-4821 taken. Demo customer: no LINE message.' });
  });

  it('Answer makes no LINE call, still answers the question, adds the answer to product knowledge, and marks its inquiries replied as demo', async () => {
    const { service, update, createEntry, publishEntry, markQuestionReplied } = world({ question: DEMO_TAKEN });

    const outcome = await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Tom', NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(createEntry).toHaveBeenCalledOnce();
    expect(publishEntry).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      documentId: 'doc-1',
      data: {
        status: 'answered',
        staffName: 'Tom',
        answeredAt: NOW,
        answer: TEXT,
        knowledgeDocumentId: 'k-new',
        lineOutcome: 'demo',
        lineDetail: 'Demo customer: no LINE message',
      },
    });
    expect(markQuestionReplied).toHaveBeenCalledExactlyOnceWith('Q-4821', { replyText: TEXT, repliedBy: 'Tom', at: NOW, lineOutcome: 'demo' });
    expect(outcome).toEqual({
      reference: 'Q-4821',
      status: 'demo',
      message: 'Answered Q-4821 and added it to product knowledge. Demo customer: no LINE message.',
      knowledgeDocumentId: 'k-new',
    });
  });

  it('Answer without product knowledge says only that it answered', async () => {
    const { service } = world({ question: DEMO_OPEN });
    expect(await service.answer('Q-4821', ONLY_SEND, 'Tom', NOW)).toEqual({
      reference: 'Q-4821',
      status: 'demo',
      message: 'Answered Q-4821. Demo customer: no LINE message.',
    });
  });

  it('works without a token: no LINE message was ever going to go', async () => {
    const { service } = world({ question: DEMO_OPEN, config: {} });
    expect((await service.notify('Q-4821', 'Jane', NOW)).status).toBe('demo');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still refuses a question that is taken or answered already, as for anyone', async () => {
    expect((await world({ question: DEMO_TAKEN }).service.notify('Q-4821', 'Jane', NOW)).status).toBe('already_taken');
    const answered = { ...ANSWERED, customer: DEMO_SUBJECT };
    expect((await world({ question: answered }).service.answer('Q-4821', ONLY_SEND, 'Jane', NOW)).status).toBe('already_answered');
  });

  it('answers with a warning when the answer could not be added to product knowledge', async () => {
    const { service, createEntry } = world({ question: DEMO_OPEN });
    createEntry.mockRejectedValueOnce(new Error('database is locked'));
    expect(await service.answer('Q-4821', ADD_TO_KNOWLEDGE, 'Tom', NOW)).toEqual({
      reference: 'Q-4821',
      status: 'demo',
      message: "Answered Q-4821. Demo customer: no LINE message. It couldn't be added to product knowledge: database is locked",
      warning: true,
    });
  });
});
