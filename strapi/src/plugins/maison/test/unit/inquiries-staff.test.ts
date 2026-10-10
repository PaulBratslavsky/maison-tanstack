import { describe, expect, it } from 'vitest';
import { CLOSE_REASONS, INQUIRY_FILTERS, INQUIRY_KINDS, SENTIMENT_LABELS } from '../../server/src/constants';
import { COFFRET, COMPLAINT, HANDED_OFF, PENDING, PENDING_VIEW, UNANSWERED, USER_ID, row, world, type Doc } from './fake-inquiries';

type Service = ReturnType<typeof world>['service'];

/** The views a call answered, and nothing when it failed. */
const viewsOf = (result: Awaited<ReturnType<Service['list']>>) => (result.ok ? result.value : []);
const idsOf = (result: Awaited<ReturnType<Service['list']>>) => viewsOf(result).map((view) => view.documentId);

/** One row per case the filters tell apart. */
const TABLE: Doc[] = [
  row('answer-1', { queue: 'needs-answer', kind: 'question', answered: false, analysisStatus: 'analyzed' }),
  row('handoff-1', { queue: 'needs-answer', handedOff: true, questionReference: 'Q-4821' }),
  row('complaint-1', { queue: 'complaint', kind: 'complaint', analysisStatus: 'analyzed' }),
  row('praise-1', { queue: 'praise', kind: 'praise', analysisStatus: 'analyzed' }),
  row('plain-1', { queue: 'none', kind: 'other', analysisStatus: 'analyzed' }),
  row('failed-1', { analysisStatus: 'failed', analysisAttempts: 5 }),
  row('pending-1'),
  row('skipped-1', { analysisStatus: 'skipped', humanCorrected: true, kind: 'other' }),
  row('skipped-2', { analysisStatus: 'skipped' }),
  row('corrected-1', { humanCorrected: true, kind: 'other' }),
  row('replied-1', { queue: 'complaint', kind: 'complaint', analysisStatus: 'analyzed', status: 'replied' }),
  row('closed-1', { queue: 'needs-answer', status: 'closed', closeReason: 'spam' }),
];

describe('inquiries.list, the filters', () => {
  it.each([
    ['needs-answer', ['answer-1', 'handoff-1']],
    ['complaint', ['complaint-1']],
    ['praise', ['praise-1']],
    // Pending, skipped (AI was off) and failed, whatever the queue: a hand-off nobody has labelled is here too. A row a
    // person labelled is not, whatever its status.
    ['not-labelled', ['handoff-1', 'failed-1', 'pending-1', 'skipped-2']],
  ] as const)('%s shows the open rows in that queue, and no replied or closed one', async (filter, expected) => {
    const { service } = world({ rows: TABLE });
    expect(idsOf(await service.list({ filter }))).toEqual(expected);
  });

  it('all shows every row, whatever its queue or status, with no filter', async () => {
    const { service, findMany } = world({ rows: TABLE });

    expect(idsOf(await service.list({ filter: 'all' }))).toEqual(TABLE.map((candidate) => candidate.documentId));

    expect(findMany.mock.calls[0][0].filters).toEqual({});
  });

  it('shows Needs an answer when it is given no filter, as the page opens on it', async () => {
    const { service } = world({ rows: TABLE });
    expect(idsOf(await service.list())).toEqual(['answer-1', 'handoff-1']);
    expect(idsOf(await service.list({}))).toEqual(['answer-1', 'handoff-1']);
  });

  // The route checks the filter first. A caller that doesn't hears about it, and is never shown every row.
  it.each(['complaints', 'ALL', 'open', '', 'toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'refuses the filter "%s", which is not one of the five, and lists nothing',
    async (filter) => {
      const { service, findMany } = world({ rows: TABLE });

      const result = await service.list({ filter: filter as any });

      expect(result).toEqual({
        ok: false,
        code: 'invalid_input',
        message: expect.stringContaining(`Unknown filter "${filter}"`),
        hint: expect.stringContaining(INQUIRY_FILTERS.join(', ')),
      });
      expect(findMany).not.toHaveBeenCalled();
    }
  );

  it('puts the newest first, and shows 50 by default', async () => {
    const { service, findMany } = world();
    await service.list();
    expect(findMany.mock.calls[0][0]).toMatchObject({ sort: 'createdAt:desc', limit: 50 });
  });

  it('shows as many as it is asked for', async () => {
    const { service, findMany } = world();
    await service.list({ filter: 'complaint', limit: 5 });
    expect(findMany.mock.calls[0][0]).toMatchObject({ sort: 'createdAt:desc', limit: 5 });
  });

  it('keeps the order the Document Service gave', async () => {
    const rows = ['c-3', 'c-2', 'c-1'].map((documentId) => row(documentId, { queue: 'needs-answer' }));
    const { service } = world({ rows });
    expect(idsOf(await service.list())).toEqual(['c-3', 'c-2', 'c-1']);
  });

  it('answers an empty list as ok', async () => {
    expect(await world().service.list({ filter: 'all' })).toEqual({ ok: true, value: [] });
  });
});

describe('inquiries.list, a row as staff see it', () => {
  it('shows an inquiry nobody has labelled: the customer masked, and nothing labelled, replied to or sent', async () => {
    const { service } = world({ rows: [PENDING] });
    expect(await service.list({ filter: 'all' })).toEqual({ ok: true, value: [PENDING_VIEW] });
  });

  it('shows the same for a row that only has the fields every row has', async () => {
    const { documentId, customer, message, language, status, queue, analysisStatus, createdAt } = PENDING;
    const { service } = world({ rows: [{ documentId, customer, message, language, status, queue, analysisStatus, createdAt }] });
    expect(await service.list({ filter: 'all' })).toEqual({
      ok: true,
      value: [{ ...PENDING_VIEW, reply: null, knowledgeFound: false }],
    });
  });

  it("shows the model's labels: the kind, the score and the sentiment, whether it was answered, why and about what", async () => {
    const { service } = world({ rows: [UNANSWERED] });

    expect(await service.list()).toEqual({
      ok: true,
      value: [
        {
          ...PENDING_VIEW,
          documentId: 'inq-2',
          message: 'Do you deliver to Osaka by Friday?',
          reply: null,
          knowledgeFound: false,
          kind: 'question',
          sentimentScore: 0.1,
          sentimentLabel: 'neutral',
          answered: false,
          reason: 'The customer asks about delivery dates, and the concierge had no entry.',
          topic: 'delivery',
          analysisStatus: 'analyzed',
          analysisAttempts: 1,
          queue: 'needs-answer',
        },
      ],
    });
  });

  it('shows a score of 0 and an answered of false as they are, never as nothing', async () => {
    const { service } = world({ rows: [{ ...UNANSWERED, sentimentScore: 0, answered: false }] });
    const [view] = viewsOf(await service.list());
    expect(view.sentimentScore).toBe(0);
    expect(view.answered).toBe(false);
  });

  it('shows a reply from staff: who sent it, when, what, and that LINE took it', async () => {
    const replied = {
      ...COMPLAINT,
      status: 'replied',
      replyText: 'We are sorry. A member of our team will look into it.',
      repliedAt: '2026-10-03T03:00:00.000Z',
      repliedBy: 'Jane',
      lineOutcome: 'sent',
      lineDetail: '',
    };
    const { service } = world({ rows: [replied], pieces: COFFRET });

    const [view] = viewsOf(await service.list({ filter: 'all' }));

    expect(view).toMatchObject({
      status: 'replied',
      replyText: 'We are sorry. A member of our team will look into it.',
      repliedAt: '2026-10-03T03:00:00.000Z',
      repliedBy: 'Jane',
      line: { outcome: 'sent', detail: null },
    });
  });

  it('shows a closed row with the reason it was closed for', async () => {
    const { service } = world({ rows: [{ ...PENDING, status: 'closed', closeReason: 'spam' }] });
    expect(viewsOf(await service.list({ filter: 'all' }))[0]).toMatchObject({ status: 'closed', closeReason: 'spam' });
  });

  it('says when a person has corrected the labels', async () => {
    const { service } = world({ rows: [{ ...COMPLAINT, humanCorrected: true }] });
    expect(viewsOf(await service.list({ filter: 'all' }))[0].humanCorrected).toBe(true);
  });

  const REFUSED = 'LINE answered 400: The request body has 1 error(s)';
  it.each([
    ['a failed push, with the reason LINE gave', { lineOutcome: 'failed', lineDetail: REFUSED }, { outcome: 'failed', detail: REFUSED }],
    ['a sent message, with no detail', { lineOutcome: 'sent', lineDetail: null }, { outcome: 'sent', detail: null }],
    ['a sent message, with an empty detail', { lineOutcome: 'sent', lineDetail: '' }, { outcome: 'sent', detail: null }],
    ['no message yet', { lineOutcome: null, lineDetail: 'left over' }, null],
    ['no message yet, with the fields not even in the row', { lineOutcome: undefined, lineDetail: undefined }, null],
  ])('shows what LINE did: %s', async (_label, fields, line) => {
    const { service } = world({ rows: [{ ...PENDING, ...fields }] });
    expect(viewsOf(await service.list({ filter: 'all' }))[0].line).toEqual(line);
  });

  it.each([
    ['an ISO string already', '2026-10-03T01:12:00.000Z'],
    ['an ISO string with an offset', '2026-10-03T10:12:00+09:00'],
    ['a Date', new Date('2026-10-03T01:12:00.000Z')],
  ])('gives the times as ISO strings, from %s', async (_label, time) => {
    const { service } = world({ rows: [{ ...PENDING, createdAt: time, repliedAt: time }] });
    expect(viewsOf(await service.list({ filter: 'all' }))[0]).toMatchObject({
      createdAt: '2026-10-03T01:12:00.000Z',
      repliedAt: '2026-10-03T01:12:00.000Z',
    });
  });

  it("never shows the customer's full LINE ID, in any field", async () => {
    const { service } = world({ rows: [PENDING, HANDED_OFF, COMPLAINT], pieces: COFFRET, questions: [{ reference: 'Q-4821', status: 'open' }] });
    const result = await service.list({ filter: 'all' });
    expect(JSON.stringify(result)).not.toContain(USER_ID);
    expect(viewsOf(result).map((view) => view.customer)).toEqual(['line:U4af…88', 'line:U4af…88', 'line:U4af…88']);
  });

  it('shows a customer that is not a LINE subject as unknown, never as it was stored', async () => {
    const { service } = world({ rows: [{ ...PENDING, customer: 'someone@example.com' }] });
    const result = await service.list({ filter: 'all' });
    expect(viewsOf(result)[0].customer).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('someone@example.com');
  });
});

describe('inquiries.list, the piece', () => {
  it("names each inquiry's piece in the inquiry's own language", async () => {
    const english = { ...COMPLAINT, documentId: 'en', language: 'en' };
    const japanese = { ...COMPLAINT, documentId: 'ja', language: 'ja' };
    const { service } = world({ rows: [english, japanese], pieces: COFFRET });

    const views = viewsOf(await service.list({ filter: 'complaint' }));

    expect(views.map((view) => [view.documentId, view.language, view.product])).toEqual([
      ['en', 'en', { slug: 'jewelry-coffret', name: 'Jewelry Coffret' }],
      ['ja', 'ja', { slug: 'jewelry-coffret', name: 'ジュエリー・コフレ' }],
    ]);
  });

  it('looks each piece up once per language, however many inquiries are about it', async () => {
    const rows = [
      { ...COMPLAINT, documentId: 'a', language: 'en' },
      { ...COMPLAINT, documentId: 'b', language: 'en' },
      { ...COMPLAINT, documentId: 'c', language: 'ja' },
      { ...COMPLAINT, documentId: 'd', language: 'en' },
    ];
    const { service, findPiece } = world({ rows, pieces: COFFRET });

    const views = viewsOf(await service.list({ filter: 'complaint' }));

    expect(findPiece.mock.calls.map(([params]) => params.locale).sort()).toEqual(['en', 'ja']);
    expect(views.map((view) => view.product?.name)).toEqual(['Jewelry Coffret', 'Jewelry Coffret', 'ジュエリー・コフレ', 'Jewelry Coffret']);
  });

  it('names a piece in the default language when its inquiry has no version of it in its own', async () => {
    const { service } = world({ rows: [COMPLAINT], pieces: [COFFRET[0]] });
    expect(viewsOf(await service.list({ filter: 'complaint' }))[0].product).toEqual({ slug: 'jewelry-coffret', name: 'ジュエリー・コフレ' });
  });

  it('shows no piece for an inquiry that has none, and looks nothing up for it', async () => {
    const { service, findPiece } = world({ rows: [PENDING], pieces: COFFRET });
    expect(viewsOf(await service.list({ filter: 'all' }))[0].product).toBeNull();
    expect(findPiece).not.toHaveBeenCalled();
  });

  it('shows no piece when it is no longer published, and still lists the inquiry', async () => {
    const { service } = world({ rows: [COMPLAINT], pieces: COFFRET.map((piece) => ({ ...piece, status: 'draft' as const })) });
    const views = viewsOf(await service.list({ filter: 'complaint' }));
    expect(views).toHaveLength(1);
    expect(views[0].product).toBeNull();
  });
});

describe('inquiries.list, the question of a hand-off', () => {
  it("shows the question's reference with its status", async () => {
    const { service } = world({ rows: [HANDED_OFF], questions: [{ reference: 'Q-4821', status: 'taken' }] });
    expect(viewsOf(await service.list())[0].question).toEqual({ reference: 'Q-4821', status: 'taken' });
  });

  it.each(['open', 'taken', 'answered'] as const)('shows a question that is %s', async (status) => {
    const { service } = world({ rows: [HANDED_OFF], questions: [{ reference: 'Q-4821', status }] });
    expect(viewsOf(await service.list())[0].question).toEqual({ reference: 'Q-4821', status });
  });

  it('shows the reference with no status when the question no longer exists', async () => {
    const { service } = world({ rows: [HANDED_OFF], questions: [] });
    expect(viewsOf(await service.list())[0].question).toEqual({ reference: 'Q-4821', status: null });
  });

  it('shows no question for an inquiry that was not a hand-off', async () => {
    const { service } = world({ rows: [UNANSWERED] });
    expect(viewsOf(await service.list())[0].question).toBeNull();
  });

  it('looks the questions up in one query, for each reference once, whatever the number of inquiries', async () => {
    const rows = [
      row('a', { handedOff: true, questionReference: 'Q-1111', queue: 'needs-answer' }),
      row('b', { handedOff: true, questionReference: 'Q-1111', queue: 'needs-answer' }),
      row('c', { handedOff: true, questionReference: 'Q-2222', queue: 'needs-answer' }),
      row('d', { queue: 'needs-answer' }),
    ];
    const questions = [
      { reference: 'Q-1111', status: 'answered' as const },
      { reference: 'Q-2222', status: 'open' as const },
      { reference: 'Q-3333', status: 'open' as const },
    ];
    const { service, findQuestions } = world({ rows, questions });

    const views = viewsOf(await service.list());

    expect(findQuestions).toHaveBeenCalledOnce();
    expect(findQuestions.mock.calls[0][0].filters).toEqual({ reference: { $in: ['Q-1111', 'Q-2222'] } });
    expect(views.map((view) => view.question)).toEqual([
      { reference: 'Q-1111', status: 'answered' },
      { reference: 'Q-1111', status: 'answered' },
      { reference: 'Q-2222', status: 'open' },
      null,
    ]);
  });

  it('looks up no question when no inquiry has a reference', async () => {
    const { service, findQuestions } = world({ rows: [PENDING, UNANSWERED] });
    await service.list({ filter: 'all' });
    expect(findQuestions).not.toHaveBeenCalled();
  });
});

describe('inquiries.summary', () => {
  it('counts the open rows in each queue, and the open rows nobody has labelled', async () => {
    const { service } = world({ rows: TABLE });
    expect(await service.summary()).toEqual({ needsAnswer: 2, complaint: 1, praise: 1, notLabelled: 4 });
  });

  it('counts zero everywhere when there are no inquiries', async () => {
    expect(await world().service.summary()).toEqual({ needsAnswer: 0, complaint: 0, praise: 0, notLabelled: 0 });
  });

  it('leaves out every replied and closed row, in every count', async () => {
    const rows = ['replied', 'closed'].flatMap((status) => [
      row(`${status}-answer`, { status, queue: 'needs-answer' }),
      row(`${status}-complaint`, { status, queue: 'complaint', analysisStatus: 'analyzed' }),
      row(`${status}-praise`, { status, queue: 'praise', analysisStatus: 'analyzed' }),
      row(`${status}-pending`, { status }),
    ]);
    expect(await world({ rows }).service.summary()).toEqual({ needsAnswer: 0, complaint: 0, praise: 0, notLabelled: 0 });
  });

  it('counts a skipped row under Not labelled, and leaves out a row a person labelled', async () => {
    const rows = [row('skipped-1', { analysisStatus: 'skipped' }), row('corrected-1', { humanCorrected: true, kind: 'other' })];
    expect(await world({ rows }).service.summary()).toEqual({ needsAnswer: 0, complaint: 0, praise: 0, notLabelled: 1 });
  });

  it('counts a hand-off nobody has labelled under Needs an answer and under Not labelled', async () => {
    const { service } = world({ rows: [HANDED_OFF] });
    expect(await service.summary()).toEqual({ needsAnswer: 1, complaint: 0, praise: 0, notLabelled: 1 });
  });
});

describe('inquiries.close', () => {
  it('closes an open inquiry with the reason, and answers it as staff see it', async () => {
    const { service, update, stored } = world({ rows: [PENDING] });

    const result = await service.close('inq-1', 'not-needed');

    expect(update).toHaveBeenCalledExactlyOnceWith({ documentId: 'inq-1', data: { status: 'closed', closeReason: 'not-needed' } });
    expect(stored[0]).toMatchObject({ status: 'closed', closeReason: 'not-needed' });
    expect(result).toEqual({ ok: true, value: { ...PENDING_VIEW, status: 'closed', closeReason: 'not-needed' } });
  });

  it.each(CLOSE_REASONS)('records the reason %s', async (reason) => {
    const { service, update } = world({ rows: [PENDING] });
    await service.close('inq-1', reason);
    expect(update.mock.calls[0][0].data).toEqual({ status: 'closed', closeReason: reason });
  });

  it("answers the inquiry with its piece and its hand-off's question, as the list shows them", async () => {
    const { service } = world({
      rows: [{ ...HANDED_OFF, productSlug: 'jewelry-coffret' }],
      pieces: COFFRET,
      questions: [{ reference: 'Q-4821', status: 'open' }],
    });

    const result = await service.close('inq-3', 'answered-elsewhere');

    expect(result).toMatchObject({
      ok: true,
      value: {
        documentId: 'inq-3',
        status: 'closed',
        closeReason: 'answered-elsewhere',
        product: { slug: 'jewelry-coffret', name: 'Jewelry Coffret' },
        question: { reference: 'Q-4821', status: 'open' },
      },
    });
  });

  it('answers already_closed for a closed inquiry, and writes nothing: its first reason stays', async () => {
    const { service, update, stored } = world({ rows: [{ ...PENDING, status: 'closed', closeReason: 'spam' }] });

    const result = await service.close('inq-1', 'not-needed');

    expect(result).toEqual({ ok: false, code: 'already_closed', message: expect.any(String), hint: expect.any(String) });
    expect(update).not.toHaveBeenCalled();
    expect(stored[0].closeReason).toBe('spam');
  });

  it('answers already_replied for a replied inquiry, and writes nothing: the reply stays', async () => {
    const replied = {
      ...PENDING,
      status: 'replied',
      replyText: 'Yes, a watch up to 42 mm fits.',
      repliedAt: '2026-10-03T03:00:00.000Z',
      repliedBy: 'Jane',
      lineOutcome: 'sent',
    };
    const { service, update, stored } = world({ rows: [replied] });

    const result = await service.close('inq-1', 'not-needed');

    expect(result).toEqual({
      ok: false,
      code: 'already_replied',
      message: 'This inquiry has been replied to already.',
      hint: expect.any(String),
    });
    expect(update).not.toHaveBeenCalled();
    expect(stored[0]).toMatchObject({ status: 'replied', closeReason: null, replyText: 'Yes, a watch up to 42 mm fits.', repliedBy: 'Jane' });
  });

  it('closes only an open inquiry: every other status is refused, and no write is made', async () => {
    for (const [status, code] of [['replied', 'already_replied'], ['closed', 'already_closed']] as const) {
      const { service, update } = world({ rows: [{ ...PENDING, status }] });
      expect(await service.close('inq-1', 'spam')).toMatchObject({ ok: false, code });
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('answers not_found for an ID no inquiry has, and writes nothing', async () => {
    const { service, update, findOne } = world({ rows: [PENDING] });

    const result = await service.close('no-such-id', 'spam');

    expect(result).toEqual({ ok: false, code: 'not_found', message: expect.stringContaining('no-such-id'), hint: expect.any(String) });
    expect(findOne).toHaveBeenCalledExactlyOnceWith({ documentId: 'no-such-id' });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('inquiries.changeLabel', () => {
  it('sets the kind, marks the row corrected by a person, and recomputes the queue', async () => {
    // A question the concierge did not answer sits in Needs an answer. A person says it is praise.
    const { service, update, stored } = world({ rows: [UNANSWERED] });

    const result = await service.changeLabel('inq-2', { kind: 'praise' });

    expect(update).toHaveBeenCalledExactlyOnceWith({ documentId: 'inq-2', data: { kind: 'praise', humanCorrected: true, queue: 'praise' } });
    expect(stored[0]).toMatchObject({ kind: 'praise', humanCorrected: true, queue: 'praise' });
    expect(result).toMatchObject({
      ok: true,
      value: { documentId: 'inq-2', kind: 'praise', humanCorrected: true, queue: 'praise', analysisStatus: 'analyzed' },
    });
  });

  it("keeps the model's sentiment and score when only the kind changes", async () => {
    const { service } = world({ rows: [UNANSWERED] });
    expect(await service.changeLabel('inq-2', { kind: 'praise' })).toMatchObject({
      ok: true,
      value: { sentimentLabel: 'neutral', sentimentScore: 0.1 },
    });
  });

  it('sets the sentiment alone, clears the score the model gave, and leaves the kind, the reason, the topic and the queue as they were', async () => {
    const { service, update } = world({ rows: [COMPLAINT] });

    const result = await service.changeLabel('inq-4', { sentimentLabel: 'neutral' });

    // A person gave a label, not a score, so the model's number must not sit beside it.
    expect(update).toHaveBeenCalledExactlyOnceWith({
      documentId: 'inq-4',
      data: { sentimentLabel: 'neutral', sentimentScore: null, humanCorrected: true, queue: 'complaint' },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'complaint',
        sentimentScore: null,
        sentimentLabel: 'neutral',
        reason: 'The customer says a clasp broke.',
        topic: 'repairs',
        queue: 'complaint',
        humanCorrected: true,
      },
    });
  });

  it('sets both together, and clears the score', async () => {
    const { service, update } = world({ rows: [COMPLAINT] });

    await service.changeLabel('inq-4', { kind: 'praise', sentimentLabel: 'positive' });

    expect(update.mock.calls[0][0].data).toEqual({
      kind: 'praise',
      sentimentLabel: 'positive',
      sentimentScore: null,
      humanCorrected: true,
      queue: 'praise',
    });
  });

  it.each(SENTIMENT_LABELS)('accepts the sentiment %s, with no score beside it', async (sentimentLabel) => {
    const { service } = world({ rows: [COMPLAINT] });
    expect(await service.changeLabel('inq-4', { sentimentLabel })).toMatchObject({ ok: true, value: { sentimentLabel, sentimentScore: null } });
  });

  describe('the queue', () => {
    it.each(INQUIRY_KINDS)('keeps a hand-off in Needs an answer when a person labels it %s', async (kind) => {
      const { service, update } = world({ rows: [HANDED_OFF] });

      const result = await service.changeLabel('inq-3', { kind });

      expect(update.mock.calls[0][0].data.queue).toBe('needs-answer');
      expect(result).toMatchObject({ ok: true, value: { kind, queue: 'needs-answer', handedOff: true } });
    });

    it.each([
      ['question', false, 'needs-answer'],
      ['question', true, 'none'],
      ['complaint', true, 'complaint'],
      ['complaint', false, 'complaint'],
      ['praise', true, 'praise'],
      ['other', false, 'none'],
    ] as const)("puts a person's %s on a row with answered %s in the %s queue", async (kind, answered, queue) => {
      const { service } = world({ rows: [{ ...UNANSWERED, kind: 'other', answered, queue: 'none' }] });
      expect(await service.changeLabel('inq-2', { kind })).toMatchObject({ ok: true, value: { kind, queue } });
    });

    // An unlabelled row has no `answered`: a person who labels it Question (with AI off, the only way to label) mustn't lose it.
    it.each(['pending', 'skipped', 'failed'])('puts a %s row a person labels Question in Needs an answer, as nobody has said it was answered', async (analysisStatus) => {
      const { service, update, stored } = world({ rows: [{ ...PENDING, analysisStatus }] });

      const result = await service.changeLabel('inq-1', { kind: 'question' });

      expect(update.mock.calls[0][0].data.queue).toBe('needs-answer');
      expect(stored[0]).toMatchObject({ kind: 'question', humanCorrected: true, queue: 'needs-answer' });
      expect(result).toMatchObject({ ok: true, value: { kind: 'question', queue: 'needs-answer', analysisStatus, humanCorrected: true } });
    });

    it('lists it under Needs an answer and counts it there, and no longer under Not labelled', async () => {
      const { service } = world({ rows: [{ ...PENDING, analysisStatus: 'skipped' }] });

      await service.changeLabel('inq-1', { kind: 'question' });

      expect(idsOf(await service.list({ filter: 'needs-answer' }))).toEqual(['inq-1']);
      expect(idsOf(await service.list({ filter: 'not-labelled' }))).toEqual([]);
      expect(await service.summary()).toEqual({ needsAnswer: 1, complaint: 0, praise: 0, notLabelled: 0 });
    });

    it('recomputes the queue from the sentiment alone: it follows the kind the row already has', async () => {
      const { service } = world({ rows: [UNANSWERED] });
      expect(await service.changeLabel('inq-2', { sentimentLabel: 'negative' })).toMatchObject({ ok: true, value: { kind: 'question', queue: 'needs-answer' } });
    });
  });

  describe('the analysis status', () => {
    // `skipped` says AI was off when the sweep saw the row, and only the sweep sets it: a person's label never changes it.
    it.each(['pending', 'failed', 'analyzed', 'skipped'])('leaves a %s row as it was, with its attempts', async (analysisStatus) => {
      const { service, stored, update } = world({ rows: [{ ...PENDING, analysisStatus, analysisAttempts: 2 }] });

      const result = await service.changeLabel('inq-1', { kind: 'other' });

      expect(update.mock.calls[0][0].data).not.toHaveProperty('analysisStatus');
      expect(stored[0]).toMatchObject({ analysisStatus, analysisAttempts: 2, humanCorrected: true });
      expect(result).toMatchObject({ ok: true, value: { analysisStatus, analysisAttempts: 2, humanCorrected: true } });
    });

    // The row is corrected by a person now, and the sweep never picks that.
    it.each(['pending', 'failed', 'skipped'])('takes a %s row out of Not labelled', async (analysisStatus) => {
      const { service } = world({ rows: [{ ...PENDING, analysisStatus }] });
      expect(idsOf(await service.list({ filter: 'not-labelled' }))).toEqual(['inq-1']);

      await service.changeLabel('inq-1', { kind: 'other' });

      expect(idsOf(await service.list({ filter: 'not-labelled' }))).toEqual([]);
    });
  });

  it.each([
    ['nothing', {}],
    ['a kind and a sentiment that are both left out', { kind: undefined, sentimentLabel: undefined }],
  ])('answers invalid_input for %s, and reads and writes nothing', async (_label, labels) => {
    const { service, findOne, update } = world({ rows: [UNANSWERED] });

    const result = await service.changeLabel('inq-2', labels);

    expect(result).toEqual({ ok: false, code: 'invalid_input', message: 'Give a kind, a sentiment, or both.', hint: expect.any(String) });
    expect(findOne).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  // A row with no kind is in no queue, and a person's label takes it out of Not labelled: a sentiment alone would hide it.
  describe('a sentiment alone, for a row that has no kind', () => {
    it.each(SENTIMENT_LABELS)('refuses %s with invalid_input and "Pick a kind too.", and writes nothing', async (sentimentLabel) => {
      const { service, update, stored } = world({ rows: [PENDING] });

      const result = await service.changeLabel('inq-1', { sentimentLabel });

      expect(result).toEqual({ ok: false, code: 'invalid_input', message: 'Pick a kind too.', hint: expect.any(String) });
      expect(update).not.toHaveBeenCalled();
      expect(stored[0]).toMatchObject({ sentimentLabel: null, humanCorrected: false, queue: 'none' });
    });

    it.each(['pending', 'skipped', 'failed'])('refuses it on a %s row, which stays under Not labelled where it was', async (analysisStatus) => {
      const { service } = world({ rows: [{ ...PENDING, analysisStatus }] });

      const result = await service.changeLabel('inq-1', { sentimentLabel: 'negative' });

      expect(result).toMatchObject({ ok: false, code: 'invalid_input', message: 'Pick a kind too.' });
      expect(idsOf(await service.list({ filter: 'not-labelled' }))).toEqual(['inq-1']);
    });

    it('refuses it when the kind is missing from the row altogether, as well as null', async () => {
      const { service, update } = world({ rows: [{ ...PENDING, kind: undefined }] });

      expect(await service.changeLabel('inq-1', { sentimentLabel: 'negative' })).toMatchObject({ ok: false, code: 'invalid_input', message: 'Pick a kind too.' });
      expect(update).not.toHaveBeenCalled();
    });

    it('takes it together with a kind', async () => {
      const { service } = world({ rows: [PENDING] });

      expect(await service.changeLabel('inq-1', { kind: 'complaint', sentimentLabel: 'negative' })).toMatchObject({
        ok: true,
        value: { kind: 'complaint', sentimentLabel: 'negative', sentimentScore: null, humanCorrected: true, queue: 'complaint' },
      });
    });

    it('takes it for a row a person gave a kind before: the row has one now', async () => {
      const { service } = world({ rows: [{ ...PENDING, kind: 'other', humanCorrected: true }] });

      expect(await service.changeLabel('inq-1', { sentimentLabel: 'positive' })).toMatchObject({
        ok: true,
        value: { kind: 'other', sentimentLabel: 'positive', queue: 'none' },
      });
    });
  });

  it('answers not_found for an ID no inquiry has, and writes nothing', async () => {
    const { service, update } = world({ rows: [UNANSWERED] });

    const result = await service.changeLabel('no-such-id', { kind: 'praise' });

    expect(result).toEqual({ ok: false, code: 'not_found', message: expect.stringContaining('no-such-id'), hint: expect.any(String) });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('inquiries.labelAgain', () => {
  const FAILED: Doc = { ...PENDING, analysisStatus: 'failed', analysisAttempts: 5 };

  it('puts a failed inquiry back to pending with no attempts, for the next sweep', async () => {
    const { service, update, stored } = world({ rows: [FAILED] });

    const result = await service.labelAgain('inq-1');

    expect(update).toHaveBeenCalledExactlyOnceWith({ documentId: 'inq-1', data: { analysisStatus: 'pending', analysisAttempts: 0 } });
    expect(stored[0]).toMatchObject({ analysisStatus: 'pending', analysisAttempts: 0 });
    expect(result).toEqual({ ok: true, value: { ...PENDING_VIEW, analysisStatus: 'pending', analysisAttempts: 0 } });
  });

  it.each(['pending', 'analyzed', 'skipped'])('answers not_failed for a %s inquiry, and writes nothing', async (analysisStatus) => {
    const { service, update } = world({ rows: [{ ...PENDING, analysisStatus, analysisAttempts: 1 }] });

    const result = await service.labelAgain('inq-1');

    expect(result).toEqual({ ok: false, code: 'not_failed', message: expect.any(String), hint: expect.any(String) });
    expect(update).not.toHaveBeenCalled();
  });

  // The sweep never picks a row a person labelled, so putting it back to pending would look as if it worked and change nothing.
  it.each(['failed', 'pending', 'skipped', 'analyzed'])('refuses a %s inquiry a person labelled, and writes nothing', async (analysisStatus) => {
    const rows = [{ ...PENDING, analysisStatus, analysisAttempts: 5, humanCorrected: true, kind: 'other' }];
    const { service, update, stored } = world({ rows });

    const result = await service.labelAgain('inq-1');

    expect(result).toEqual({
      ok: false,
      code: 'not_failed',
      message: "A person labelled this inquiry, so it isn't labelled again.",
      hint: 'Use Change label to change its labels.',
    });
    expect(update).not.toHaveBeenCalled();
    expect(stored[0]).toMatchObject({ analysisStatus, analysisAttempts: 5, humanCorrected: true });
  });

  it('answers not_found for an ID no inquiry has, and writes nothing', async () => {
    const { service, update } = world({ rows: [FAILED] });

    const result = await service.labelAgain('no-such-id');

    expect(result).toEqual({ ok: false, code: 'not_found', message: expect.stringContaining('no-such-id'), hint: expect.any(String) });
    expect(update).not.toHaveBeenCalled();
  });

  it('lists the row under Not labelled again, as pending', async () => {
    const { service } = world({ rows: [FAILED] });
    await service.labelAgain('inq-1');
    expect(idsOf(await service.list({ filter: 'not-labelled' }))).toEqual(['inq-1']);
  });
});

describe('inquiries.markQuestionReplied', () => {
  const AT = new Date('2026-10-03T03:00:00.000Z');
  const REPLY = { replyText: 'Yes, a watch up to 42 mm fits.', repliedBy: 'Jane', at: AT };
  const handedOff = (documentId: string, fields: Doc = {}): Doc => row(documentId, { handedOff: true, questionReference: 'Q-4821', queue: 'needs-answer', ...fields });

  it('marks every open inquiry of the question replied: the answer, when, by whom, and that LINE took it', async () => {
    const { service, update, stored } = world({ rows: [handedOff('h-1'), handedOff('h-2')] });

    await expect(service.markQuestionReplied('Q-4821', REPLY)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(2);
    for (const documentId of ['h-1', 'h-2']) {
      expect(update).toHaveBeenCalledWith({
        documentId,
        data: { status: 'replied', replyText: REPLY.replyText, repliedAt: AT, repliedBy: 'Jane', lineOutcome: 'sent' },
      });
    }
    expect(stored.map((entry) => entry.status)).toEqual(['replied', 'replied']);
  });

  it('asks for the open inquiries of that question, and no others', async () => {
    const { service, findMany } = world({ rows: [handedOff('h-1')] });
    await service.markQuestionReplied('Q-4821', REPLY);
    expect(findMany).toHaveBeenCalledExactlyOnceWith({ filters: { questionReference: { $eq: 'Q-4821' }, status: { $eq: 'open' } } });
  });

  it("leaves alone the inquiries of other questions, and those that are replied or closed already", async () => {
    const rows = [
      handedOff('open'),
      handedOff('other-question', { questionReference: 'Q-9999' }),
      handedOff('closed', { status: 'closed', closeReason: 'spam' }),
      handedOff('replied', { status: 'replied', replyText: 'Sent from elsewhere.', repliedBy: 'Tom' }),
      row('no-question'),
    ];
    const { service, update, stored } = world({ rows });

    await service.markQuestionReplied('Q-4821', REPLY);

    expect(update).toHaveBeenCalledExactlyOnceWith({ documentId: 'open', data: expect.objectContaining({ status: 'replied' }) });
    const byId = Object.fromEntries(stored.map((entry) => [entry.documentId, entry]));
    expect(byId['other-question']).toMatchObject({ status: 'open', replyText: null });
    expect(byId.closed).toMatchObject({ status: 'closed', closeReason: 'spam', replyText: null });
    expect(byId.replied).toMatchObject({ status: 'replied', replyText: 'Sent from elsewhere.', repliedBy: 'Tom' });
    expect(byId['no-question']).toMatchObject({ status: 'open' });
  });

  it('does nothing, and resolves, when no open inquiry has the question', async () => {
    const { service, update } = world({ rows: [row('plain')] });
    await expect(service.markQuestionReplied('Q-4821', REPLY)).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('takes the inquiries out of every list, with the reply on them', async () => {
    const { service } = world({ rows: [handedOff('h-1')] });
    expect(idsOf(await service.list({ filter: 'needs-answer' }))).toEqual(['h-1']);

    await service.markQuestionReplied('Q-4821', REPLY);

    expect(idsOf(await service.list({ filter: 'needs-answer' }))).toEqual([]);
    expect(viewsOf(await service.list({ filter: 'all' }))[0]).toMatchObject({
      status: 'replied',
      replyText: REPLY.replyText,
      repliedAt: '2026-10-03T03:00:00.000Z',
      repliedBy: 'Jane',
      line: { outcome: 'sent', detail: null },
    });
  });

  it("records the demo outcome, with its plain detail, when the question was a made-up demo customer's", async () => {
    const { service, update } = world({ rows: [handedOff('h-1')] });

    await service.markQuestionReplied('Q-4821', { ...REPLY, lineOutcome: 'demo' });

    expect(update).toHaveBeenCalledExactlyOnceWith({
      documentId: 'h-1',
      data: {
        status: 'replied',
        replyText: REPLY.replyText,
        repliedAt: AT,
        repliedBy: 'Jane',
        lineOutcome: 'demo',
        lineDetail: 'Demo customer: no LINE message',
      },
    });
  });

  it('rejects when a write fails, for the caller to log', async () => {
    const { service, update } = world({ rows: [handedOff('h-1')] });
    update.mockRejectedValueOnce(new Error('database is locked'));
    await expect(service.markQuestionReplied('Q-4821', REPLY)).rejects.toThrow('database is locked');
  });
});
