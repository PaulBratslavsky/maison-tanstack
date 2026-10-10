import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inquiryReplyText } from '../../server/src/domain/inquiry-replies';
import { COMPLAINT, HANDED_OFF, PENDING, UNANSWERED, USER_ID, row, world as inquiriesWorld, type Doc, type WorldOptions } from './fake-inquiries';
import { LINE_API, TOKEN, lineAnswers } from './fake-line';

const NOW = new Date('2026-10-03T03:00:00.000Z');
const WITH_TOKEN = { lineChannelAccessToken: TOKEN, lineApiBaseUrl: LINE_API };
const TEXT = 'We are sorry about the clasp. A member of our team will call you tomorrow.';
const NO_TOKEN_MESSAGE = "LINE_CHANNEL_ACCESS_TOKEN isn't set: Strapi can't message customers on LINE.";

/** An inquiry the concierge's customer wrote in Japanese. */
const JAPANESE: Doc = { ...COMPLAINT, language: 'ja', message: 'ストラップが切れてしまいました。', productSlug: null };

/** The inquiries service over its rows, with the channel access token set unless a test says otherwise. */
const world = ({ config = WITH_TOKEN, ...options }: WorldOptions = {}) => inquiriesWorld({ config, ...options });
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

/** Nothing went out to LINE, and nothing was written. */
const expectNothingDone = ({ update }: World) => {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
};

// Nothing here reaches LINE: every test starts with fetch stubbed to answer 200 itself, and the API address is this machine's.
beforeEach(() => useFetch(lineAnswers()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('inquiries.reply', () => {
  it("pushes one text message to the customer's LINE user, and records the reply: who sent it, when, and that LINE took it", async () => {
    const { service, findOne, update } = world({ rows: [COMPLAINT] });

    const outcome = await service.reply('inq-4', TEXT, 'Jane', NOW);

    const { url, init, body, message } = pushed();
    expect(url).toBe(`${LINE_API}/v2/bot/message/push`);
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
    expect(body.to).toBe(USER_ID);
    expect(body.messages).toHaveLength(1);
    expect(message.type).toBe('text');
    expect(message.text).toBe(inquiryReplyText({ language: 'en', message: COMPLAINT.message, text: TEXT }));
    expect(message.text).toBe(`About your message: "The clasp of my coffret broke after a week."\n\n${TEXT}\n\nMaison`);
    expect(findOne).toHaveBeenCalledExactlyOnceWith({ documentId: 'inq-4' });
    expect(update).toHaveBeenCalledExactlyOnceWith({
      documentId: 'inq-4',
      data: { status: 'replied', replyText: TEXT, repliedAt: NOW, repliedBy: 'Jane', lineOutcome: 'sent', lineDetail: '' },
    });
    expect(outcome).toEqual({ documentId: 'inq-4', status: 'sent', message: 'Sent the reply on LINE.' });
    expect(outcome).not.toHaveProperty('warning');
  });

  it("writes in the inquiry's language: a customer who wrote in Japanese gets the Japanese form", async () => {
    const { service } = world({ rows: [JAPANESE] });

    expect((await service.reply('inq-4', 'ご連絡ありがとうございます。', 'Jane', NOW)).status).toBe('sent');

    expect(pushed().message.text).toBe(inquiryReplyText({ language: 'ja', message: JAPANESE.message, text: 'ご連絡ありがとうございます。' }));
    expect(pushed().message.text).toBe('「ストラップが切れてしまいました。」についてのお問い合わせへのご返信です。\n\nご連絡ありがとうございます。\n\nMaison');
  });

  it("quotes the customer's own message, cut to 80 characters on one line", async () => {
    const message = `The clasp of my coffret broke after a week,\n\nand the lining of the lid has come away too. ${'It was a gift. '.repeat(10)}`;
    const { service } = world({ rows: [{ ...COMPLAINT, message }] });

    await service.reply('inq-4', TEXT, 'Jane', NOW);

    expect(pushed().message.text).toBe(
      `About your message: "The clasp of my coffret broke after a week, and the lining of the lid has come …"\n\n${TEXT}\n\nMaison`
    );
  });

  it('trims the text, and sends and records it trimmed', async () => {
    const { service, update } = world({ rows: [COMPLAINT] });

    await service.reply('inq-4', `  ${TEXT}\n`, 'Jane', NOW);

    expect(pushed().message.text).toBe(`About your message: "${COMPLAINT.message}"\n\n${TEXT}\n\nMaison`);
    expect(update.mock.calls[0][0].data.replyText).toBe(TEXT);
  });

  it("sends the text as Maison's own and never in the staff member's name: the name is recorded, not sent", async () => {
    const { service } = world({ rows: [COMPLAINT] });

    await service.reply('inq-4', TEXT, 'Jane', NOW);

    expect(pushed().message.text).not.toContain('Jane');
    expect(pushed().message.text.endsWith('\n\nMaison')).toBe(true);
  });

  it('records Maison as who replied when it has no staff name', async () => {
    const { service, update } = world({ rows: [COMPLAINT] });

    expect((await service.reply('inq-4', TEXT, null, NOW)).status).toBe('sent');

    expect(update.mock.calls[0][0].data.repliedBy).toBe('Maison');
  });

  it('takes the time from the clock when it is not given one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { service, update } = world({ rows: [COMPLAINT] });

    await service.reply('inq-4', TEXT, 'Jane');

    expect(update.mock.calls[0][0].data.repliedAt).toEqual(NOW);
  });

  // Reply on LINE is for any open inquiry, labelled or not: staff decide what is worth a reply.
  it.each([
    ['an inquiry nobody has labelled', PENDING],
    ['a question the concierge did not answer', UNANSWERED],
    ['a complaint', COMPLAINT],
    ['praise', { ...PENDING, kind: 'praise', queue: 'praise', analysisStatus: 'analyzed' }],
    ['an inquiry whose labels a person changed', { ...PENDING, kind: 'other', humanCorrected: true }],
  ])('replies to %s', async (_label, inquiry) => {
    const { service, stored } = world({ rows: [inquiry] });

    expect((await service.reply(inquiry.documentId, TEXT, 'Jane', NOW)).status).toBe('sent');

    expect(stored[0]).toMatchObject({ status: 'replied', replyText: TEXT });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // Only a recorded question sends staff to Questions. A turn that handed off, but whose question was never recorded
  // (the log keeps a question only when it is this customer's), has none to answer there.
  it('replies to an inquiry that handed off with no question recorded: it has no question to answer under Questions', async () => {
    const { service } = world({ rows: [{ ...HANDED_OFF, questionReference: null }] });
    expect((await service.reply('inq-3', TEXT, 'Jane', NOW)).status).toBe('sent');
  });

  it('leaves the other rows and the labels as they are: it writes the reply and nothing else', async () => {
    const { service, update, stored } = world({ rows: [COMPLAINT, PENDING] });

    await service.reply('inq-4', TEXT, 'Jane', NOW);

    expect(Object.keys(update.mock.calls[0][0].data).sort()).toEqual(['lineDetail', 'lineOutcome', 'repliedAt', 'repliedBy', 'replyText', 'status']);
    expect(stored[0]).toMatchObject({ kind: 'complaint', queue: 'complaint', humanCorrected: false, analysisStatus: 'analyzed', closeReason: null });
    expect(stored[1]).toMatchObject({ status: 'open', replyText: null });
  });

  it('shows the row as replied once it is: out of its queue and every count, with the reply on it', async () => {
    const { service } = world({ rows: [COMPLAINT, UNANSWERED] });
    expect(await service.summary()).toMatchObject({ complaint: 1, needsAnswer: 1 });

    await service.reply('inq-4', TEXT, 'Jane', NOW);

    expect(await service.summary()).toEqual({ needsAnswer: 1, complaint: 0, praise: 0, notLabelled: 0 });
    expect(await service.list({ filter: 'complaint' })).toEqual({ ok: true, value: [] });
    const listed = await service.list({ filter: 'all' });
    expect(listed.ok && listed.value.find((view) => view.documentId === 'inq-4')).toMatchObject({
      status: 'replied',
      replyText: TEXT,
      repliedAt: '2026-10-03T03:00:00.000Z',
      repliedBy: 'Jane',
      line: { outcome: 'sent', detail: null },
    });
  });

  describe('when LINE does not take the message', () => {
    const REFUSAL = "The property, 'to', in the request body is invalid (line 1, column 6)";

    it('records why, leaves the inquiry open with nothing else changed, and answers failed', async () => {
      useFetch(lineAnswers(400, { message: REFUSAL }));
      const { service, update, stored } = world({ rows: [COMPLAINT] });

      const outcome = await service.reply('inq-4', TEXT, 'Jane', NOW);

      const detail = `LINE answered 400: ${REFUSAL}`;
      expect(update).toHaveBeenCalledExactlyOnceWith({ documentId: 'inq-4', data: { lineOutcome: 'failed', lineDetail: detail } });
      expect(stored[0]).toMatchObject({ status: 'open', replyText: null, repliedAt: null, repliedBy: null, lineOutcome: 'failed', lineDetail: detail });
      expect(outcome).toEqual({ documentId: 'inq-4', status: 'failed', message: `The reply wasn't sent. ${detail}` });
      // Nothing went out, so it is an error for staff to read, not a warning on a message that did.
      expect(outcome).not.toHaveProperty('warning');
    });

    it('shows staff what LINE said, on the open inquiry', async () => {
      useFetch(lineAnswers(400, { message: REFUSAL }));
      const { service } = world({ rows: [COMPLAINT] });

      await service.reply('inq-4', TEXT, 'Jane', NOW);

      const listed = await service.list({ filter: 'complaint' });
      expect(listed.ok && listed.value).toMatchObject([
        { documentId: 'inq-4', status: 'open', replyText: null, line: { outcome: 'failed', detail: `LINE answered 400: ${REFUSAL}` } },
      ]);
    });

    it("records that LINE couldn't be reached", async () => {
      useFetch(rejects(Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED 127.0.0.1:4010') })));
      const { service, update } = world({ rows: [COMPLAINT] });

      const outcome = await service.reply('inq-4', TEXT, 'Jane', NOW);

      expect(outcome.status).toBe('failed');
      expect(update.mock.calls[0][0].data).toEqual({ lineOutcome: 'failed', lineDetail: "LINE couldn't be reached: connect ECONNREFUSED 127.0.0.1:4010" });
    });

    it('lets the next Send go out, and then replies, with the failure gone from the row', async () => {
      useFetch(lineAnswers(500, { message: 'Try later' }));
      const w = world({ rows: [COMPLAINT] });
      expect((await w.service.reply('inq-4', TEXT, 'Jane', NOW)).status).toBe('failed');

      useFetch(lineAnswers());
      expect((await w.service.reply('inq-4', TEXT, 'Jane', NOW)).status).toBe('sent');

      expect(w.stored[0]).toMatchObject({ status: 'replied', repliedBy: 'Jane', lineOutcome: 'sent', lineDetail: '' });
      const listed = await w.service.list({ filter: 'all' });
      expect(listed.ok && listed.value[0].line).toEqual({ outcome: 'sent', detail: null });
    });

    it('takes the token out of the detail, the message and every log, even when the error quotes it', async () => {
      // undici quotes a header value it refuses, Authorization included.
      useFetch(rejects(new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`)));
      const { service, update, strapi } = world({ rows: [COMPLAINT] });

      const outcome = await service.reply('inq-4', TEXT, 'Jane', NOW);

      expect(outcome.status).toBe('failed');
      expect(update.mock.calls[0][0].data.lineDetail).toBe('LINE couldn\'t be reached: Headers.append: "Bearer [token]" is an invalid header value.');
      const written = JSON.stringify([outcome, update.mock.calls, strapi.log.warn.mock.calls, strapi.log.info.mock.calls, strapi.log.error.mock.calls]);
      expect(written).not.toContain(TOKEN);
    });

    it('takes the token out before it cuts the detail, so no piece of it is left at the cut', async () => {
      // "LINE answered 400: " is 19 units, so the token starts at unit 489. Cut first, it would leave "test-chann" there.
      useFetch(lineAnswers(400, { message: `${'a'.repeat(470)}${TOKEN}` }));
      const { service, update } = world({ rows: [COMPLAINT] });

      await service.reply('inq-4', TEXT, 'Jane', NOW);

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
        const { service, update } = world({ rows: [COMPLAINT] });
        const outcome = await service.reply('inq-4', TEXT, 'Jane', NOW);
        const { lineDetail } = update.mock.calls[0][0].data;
        expect(lineDetail).toBe(detail);
        expect(lineDetail.length).toBeLessThanOrEqual(500);
        expect(outcome.message).toBe(`The reply wasn't sent. ${detail}`);
      }
    });

    it('never splits an emoji when it cuts the detail', async () => {
      useFetch(lineAnswers(400, { message: '😀'.repeat(300) }));
      const { service, update } = world({ rows: [COMPLAINT] });

      await service.reply('inq-4', TEXT, 'Jane', NOW);

      const { lineDetail } = update.mock.calls[0][0].data;
      expect(lineDetail.length).toBeLessThanOrEqual(500);
      expect(lineDetail.endsWith('…')).toBe(true);
      expect(lineDetail).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });

    it('still answers failed, and logs that recording it failed too, when recording why LINE refused fails', async () => {
      useFetch(lineAnswers(400, { message: 'Bad request' }));
      const { service, update, strapi } = world({ rows: [COMPLAINT] });
      update.mockRejectedValueOnce(new Error('database is locked'));

      const outcome = await service.reply('inq-4', TEXT, 'Jane', NOW);

      expect(outcome).toEqual({ documentId: 'inq-4', status: 'failed', message: "The reply wasn't sent. LINE answered 400: Bad request" });
      expect(strapi.log.error).toHaveBeenCalledExactlyOnceWith("[maison] The failed LINE reply to inquiry inq-4 couldn't be recorded: database is locked");
      expect(strapi.log.warn).toHaveBeenCalledExactlyOnceWith("[maison] The reply to inquiry inq-4 wasn't sent. LINE answered 400: Bad request");
    });

    it('logs a refusal as a warning, with what LINE said, and not as a sent reply', async () => {
      useFetch(lineAnswers(429, { message: 'You have reached your monthly limit.' }));
      const { service, strapi } = world({ rows: [COMPLAINT] });

      await service.reply('inq-4', TEXT, 'Jane', NOW);

      expect(strapi.log.warn).toHaveBeenCalledExactlyOnceWith(
        "[maison] The reply to inquiry inq-4 wasn't sent. LINE answered 429: You have reached your monthly limit."
      );
      expect(strapi.log.info).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  describe('when nothing can be sent', () => {
    it('answers not_found for an ID no inquiry has, and sends and writes nothing', async () => {
      const w = world({ rows: [COMPLAINT] });

      expect(await w.service.reply('no-such-id', TEXT, 'Jane', NOW)).toEqual({
        documentId: 'no-such-id',
        status: 'not_found',
        message: 'No inquiry "no-such-id".',
      });

      expectNothingDone(w);
    });

    it('answers already_closed for a closed inquiry, and sends and writes nothing: its reason stays', async () => {
      const w = world({ rows: [{ ...COMPLAINT, status: 'closed', closeReason: 'spam' }] });

      expect(await w.service.reply('inq-4', TEXT, 'Jane', NOW)).toEqual({
        documentId: 'inq-4',
        status: 'already_closed',
        message: 'This inquiry is closed already.',
      });

      expectNothingDone(w);
      expect(w.stored[0]).toMatchObject({ status: 'closed', closeReason: 'spam' });
    });

    it('answers already_replied for a replied inquiry, and sends and writes nothing: the first reply stays', async () => {
      const replied = { ...COMPLAINT, status: 'replied', replyText: 'Sent already.', repliedAt: '2026-10-03T02:00:00.000Z', repliedBy: 'Tom', lineOutcome: 'sent' };
      const w = world({ rows: [replied] });

      expect(await w.service.reply('inq-4', TEXT, 'Jane', NOW)).toEqual({
        documentId: 'inq-4',
        status: 'already_replied',
        message: 'This inquiry has been replied to already.',
      });

      expectNothingDone(w);
      expect(w.stored[0]).toMatchObject({ status: 'replied', replyText: 'Sent already.', repliedBy: 'Tom' });
    });

    it.each(['Q-4821', 'Q-1234'])('refuses a hand-off with the question %s, and sends and writes nothing: it is answered under Questions', async (reference) => {
      const w = world({ rows: [{ ...HANDED_OFF, questionReference: reference }] });

      expect(await w.service.reply('inq-3', TEXT, 'Jane', NOW)).toEqual({
        documentId: 'inq-3',
        status: 'use_question',
        message: `Answer it under Questions (${reference}).`,
      });

      expectNothingDone(w);
    });

    // The rule is the reference on the row, so it never depends on what became of the question, and never looks it up.
    it.each([
      ['open', [{ reference: 'Q-4821', status: 'open' as const }]],
      ['answered', [{ reference: 'Q-4821', status: 'answered' as const }]],
      ['deleted', []],
    ])('refuses a hand-off whose question is %s the same way', async (_label, questions) => {
      const w = world({ rows: [HANDED_OFF], questions });

      expect(await w.service.reply('inq-3', TEXT, 'Jane', NOW)).toMatchObject({ status: 'use_question', message: 'Answer it under Questions (Q-4821).' });

      expectNothingDone(w);
      expect(w.findQuestions).not.toHaveBeenCalled();
    });

    it.each([
      ['no token is set', {}],
      ['the token is empty', { lineChannelAccessToken: '', lineApiBaseUrl: LINE_API }],
      ['the token is null', { lineChannelAccessToken: null, lineApiBaseUrl: LINE_API }],
    ])('answers not_configured when %s, and sends and records nothing', async (_label, config) => {
      const w = world({ rows: [COMPLAINT], config });

      expect(await w.service.reply('inq-4', TEXT, 'Jane', NOW)).toEqual({
        documentId: 'inq-4',
        status: 'not_configured',
        message: NO_TOKEN_MESSAGE,
      });

      expectNothingDone(w);
      expect(w.stored[0]).toMatchObject({ status: 'open', lineOutcome: null, lineDetail: null });
      expect(w.strapi.log.warn).toHaveBeenCalledExactlyOnceWith(`[maison] ${NO_TOKEN_MESSAGE}`);
    });

    // The inquiry is looked at before the token: what staff can fix comes first, and a refusal never depends on the setup.
    it.each([
      ['a missing inquiry is not_found', [], 'not_found'],
      ['a closed inquiry is already_closed', [{ ...COMPLAINT, status: 'closed' }], 'already_closed'],
      ['a replied inquiry is already_replied', [{ ...COMPLAINT, status: 'replied' }], 'already_replied'],
      ['a hand-off is use_question', [HANDED_OFF], 'use_question'],
    ])('checks the inquiry before the token: %s even with no token', async (_label, rows, status) => {
      const w = world({ rows, config: {} });
      expect((await w.service.reply(rows[0]?.documentId ?? 'inq-4', TEXT, 'Jane', NOW)).status).toBe(status);
      expect(w.strapi.log.warn).not.toHaveBeenCalled();
    });

    it.each([
      ['closed', 'already_closed'],
      ['replied', 'already_replied'],
    ])('answers %s before use_question for a hand-off: its state says more than where it is answered', async (state, status) => {
      const w = world({ rows: [{ ...HANDED_OFF, status: state }] });
      expect((await w.service.reply('inq-3', TEXT, 'Jane', NOW)).status).toBe(status);
      expectNothingDone(w);
    });
  });

  describe('when LINE took the message but the inquiry could not be updated', () => {
    it.each([
      ['an error', new Error('database is locked'), 'database is locked'],
      ['something that is not an error', 'boom', 'boom'],
    ])("answers sent with a warning, and says not to send it again: the update failed with %s", async (_label, failure, reason) => {
      const { service, update, strapi } = world({ rows: [COMPLAINT] });
      update.mockRejectedValueOnce(failure);

      const outcome = await service.reply('inq-4', TEXT, 'Jane', NOW);

      const message = `Sent the reply on LINE, but recording it failed (${reason}). Don't send it again.`;
      expect(outcome).toEqual({ documentId: 'inq-4', status: 'sent', message, warning: true });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(strapi.log.error).toHaveBeenCalledExactlyOnceWith(`[maison] Inquiry inq-4: ${message}`);
      expect(strapi.log.info).not.toHaveBeenCalled();
    });

    it('takes the token out of the reason', async () => {
      const { service, update, strapi } = world({ rows: [COMPLAINT] });
      update.mockRejectedValueOnce(new Error(`request to https://x.test/?access_token=${TOKEN} failed`));

      const outcome = await service.reply('inq-4', TEXT, 'Jane', NOW);

      expect(outcome.message).toBe("Sent the reply on LINE, but recording it failed (request to https://x.test/?access_token=[token] failed). Don't send it again.");
      expect(JSON.stringify([outcome, strapi.log.error.mock.calls])).not.toContain(TOKEN);
    });
  });

  it('logs what it sent, naming the inquiry and nothing of the customer or the reply', async () => {
    const { service, strapi } = world({ rows: [COMPLAINT] });

    await service.reply('inq-4', TEXT, 'Jane', NOW);

    expect(strapi.log.info).toHaveBeenCalledExactlyOnceWith('[maison] Sent the reply to inquiry inq-4 on LINE.');
    expect(strapi.log.warn).not.toHaveBeenCalled();
    expect(strapi.log.error).not.toHaveBeenCalled();
    expect(JSON.stringify(strapi.log.info.mock.calls)).not.toContain(USER_ID);
  });
});

describe('a second click on Send', () => {
  it('sends and saves nothing more: the inquiry is replied, so it answers already_replied', async () => {
    const w = world({ rows: [COMPLAINT] });
    expect((await w.service.reply('inq-4', TEXT, 'Jane', NOW)).status).toBe('sent');

    const second = await w.service.reply('inq-4', 'Another reply.', 'Tom', NOW);

    expect(second).toEqual({ documentId: 'inq-4', status: 'already_replied', message: 'This inquiry has been replied to already.' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(w.update).toHaveBeenCalledOnce();
    expect(w.stored[0]).toMatchObject({ status: 'replied', replyText: TEXT, repliedBy: 'Jane' });
  });

  it('after Close sends nothing: it answers already_closed', async () => {
    const w = world({ rows: [COMPLAINT] });
    expect((await w.service.close('inq-4', 'not-needed')).ok).toBe(true);

    expect((await w.service.reply('inq-4', TEXT, 'Jane', NOW)).status).toBe('already_closed');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('before Close leaves the reply as it was: Close answers already_replied', async () => {
    const w = world({ rows: [COMPLAINT] });
    await w.service.reply('inq-4', TEXT, 'Jane', NOW);

    expect(await w.service.close('inq-4', 'not-needed')).toMatchObject({ ok: false, code: 'already_replied' });

    expect(w.stored[0]).toMatchObject({ status: 'replied', closeReason: null });
  });

  it('does not touch the other inquiries of the same customer', async () => {
    const w = world({ rows: [COMPLAINT, row('inq-9', { message: 'Another question.', queue: 'needs-answer' })] });

    await w.service.reply('inq-4', TEXT, 'Jane', NOW);

    expect(w.stored[1]).toMatchObject({ status: 'open', replyText: null });
  });
});

describe('inquiries.quota', () => {
  /** `fetch` as LINE answers the month's total and its limit. */
  const usageAnswers = (consumption: unknown = { totalUsage: 12 }, quota: unknown = { type: 'limited', value: 200 }) =>
    vi.fn(async (url: string, _init: RequestInit) => new Response(JSON.stringify(url.endsWith('/quota/consumption') ? consumption : quota), { status: 200 }));

  it("answers that it is configured, with the month's total and the limit from LINE, asked with the token at the configured address", async () => {
    useFetch(usageAnswers());
    const { service } = world();

    expect(await service.quota()).toEqual({ configured: true, used: 12, limit: 200 });

    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([`${LINE_API}/v2/bot/message/quota`, `${LINE_API}/v2/bot/message/quota/consumption`]);
    for (const [, init] of fetchMock.mock.calls) expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('answers a total and no limit for a channel that has none', async () => {
    useFetch(usageAnswers({ totalUsage: 7 }, { type: 'none' }));
    expect(await world().service.quota()).toEqual({ configured: true, used: 7, limit: null });
  });

  it.each([
    ['no token is set', {}],
    ['the token is empty', { lineChannelAccessToken: '', lineApiBaseUrl: LINE_API }],
  ])('answers that it is not configured, with no total and no limit, and asks LINE nothing, when %s', async (_label, config) => {
    const { service, strapi } = world({ config });

    expect(await service.quota()).toEqual({ configured: false, used: null, limit: null });

    expect(fetchMock).not.toHaveBeenCalled();
    // The page asks all the time: a missing token is not worth a log line each time.
    expect(strapi.log.warn).not.toHaveBeenCalled();
  });

  it('answers configured, with no total and no limit, when LINE does not answer, and never throws', async () => {
    useFetch(rejects(new TypeError('fetch failed')));
    expect(await world().service.quota()).toEqual({ configured: true, used: null, limit: null });
  });

  it('answers configured, with no total and no limit, when LINE refuses the token, and logs nothing: the page asks all the time', async () => {
    useFetch(vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ message: 'Authentication failed' }), { status: 401 })));
    const { service, strapi } = world();

    expect(await service.quota()).toEqual({ configured: true, used: null, limit: null });

    for (const log of [strapi.log.warn, strapi.log.error, strapi.log.info]) expect(log).not.toHaveBeenCalled();
  });
});

describe('Reply on LINE to a made-up demo customer', () => {
  const DEMO: Doc = { ...COMPLAINT, customer: 'line:Udec0de00000000000000000000000004' };

  it('makes no LINE call, still marks the inquiry replied, and records the demo outcome', async () => {
    const { service, update, stored } = world({ rows: [DEMO] });

    const outcome = await service.reply('inq-4', `  ${TEXT}\n`, 'Jane', NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      documentId: 'inq-4',
      data: { status: 'replied', replyText: TEXT, repliedAt: NOW, repliedBy: 'Jane', lineOutcome: 'demo', lineDetail: 'Demo customer: no LINE message' },
    });
    expect(stored[0]).toMatchObject({ status: 'replied', lineOutcome: 'demo' });
    expect(outcome).toEqual({ documentId: 'inq-4', status: 'demo', message: 'Marked it replied. Demo customer: no LINE message.' });
  });

  it('shows staff the demo outcome on the row, never as a failure', async () => {
    const w = world({ rows: [DEMO] });
    await w.service.reply('inq-4', TEXT, 'Jane', NOW);
    const listed = await w.service.list({ filter: 'all' });
    expect(listed.ok && listed.value[0].line).toEqual({ outcome: 'demo', detail: 'Demo customer: no LINE message' });
  });

  it('works without a token: no LINE message was ever going to go', async () => {
    const { service } = world({ rows: [DEMO], config: {} });
    expect((await service.reply('inq-4', TEXT, 'Jane', NOW)).status).toBe('demo');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still refuses a hand-off, a closed and a replied inquiry, as for anyone', async () => {
    const customer = DEMO.customer;
    expect((await world({ rows: [{ ...HANDED_OFF, customer, documentId: 'inq-4' }] }).service.reply('inq-4', TEXT, 'Jane', NOW)).status).toBe('use_question');
    expect((await world({ rows: [{ ...DEMO, status: 'closed' }] }).service.reply('inq-4', TEXT, 'Jane', NOW)).status).toBe('already_closed');
    expect((await world({ rows: [{ ...DEMO, status: 'replied' }] }).service.reply('inq-4', TEXT, 'Jane', NOW)).status).toBe('already_replied');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
