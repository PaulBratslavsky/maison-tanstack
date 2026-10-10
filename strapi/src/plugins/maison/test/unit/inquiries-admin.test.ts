import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOSE_REASON_OPTIONS,
  COUNTS,
  DEFAULT_FILTER,
  FILTERS,
  FILTER_LABELS,
  KIND_OPTIONS,
  LIST_LIMIT,
  REPLY_LIMIT,
  SENTIMENT_OPTIONS,
  canClose,
  canLabelAgain,
  canReplyTo,
  canSaveLabels,
  canSendReply,
  handOffText,
  insertSuggested,
  introText,
  isSummary,
  kindLabel,
  kindNeededNotice,
  labelBody,
  labelForm,
  labelNote,
  noTokenNotice,
  quotaText,
  replyBody,
  replyTooLong,
  sentimentText,
  statusLabel,
  suggestedReply,
  type StaffInquiry,
} from '../../admin/src/inquiries';
import { lineNote } from '../../admin/src/line-note';
import { YOUR_LINE_LABEL, yourLineBadge } from '../../admin/src/your-line';
import { CLOSE_REASONS, INQUIRY_FILTERS, INQUIRY_KINDS, INQUIRY_QUEUES, LOCALES, SENTIMENT_LABELS } from '../../server/src/constants';
import { suggestedReply as serverSuggestedReply } from '../../server/src/domain/inquiry-replies';
import { NO_TOKEN } from '../../server/src/domain/line-outcome';
import { changeLabelInput, closeInquiryInput, inquiryListInput, replyInquiryInput } from '../../server/src/mcp/schemas';
import { world, row, type Doc } from './fake-inquiries';
import { LINE_API, TOKEN, lineAnswers } from './fake-line';

/*
 * The Inquiries tab's rules, apart from React. Where a rule is "offer this button exactly when the server would take
 * it", the test asks the server's own service, with its own rows, so the page can't drift from what it sends.
 */

/** A question Strapi has under Questions, by the reference an inquiry's hand-off names. */
type Questions = Array<{ reference: string; status: 'open' | 'taken' | 'answered' }>;

/** The channel access token is set and LINE is a stand-in, so a reply the service sends goes nowhere. */
const WITH_TOKEN = { lineChannelAccessToken: TOKEN, lineApiBaseUrl: LINE_API };

beforeEach(() => vi.stubGlobal('fetch', lineAnswers()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The service over one inquiry, which is `fields` over a row the app just logged. */
const worldOf = (fields: Doc, questions: Questions = []) => world({ rows: [row('inq-x', fields)], questions, config: WITH_TOKEN });

/** The inquiry as the server's service shows it to staff: exactly what GET /maison/inquiries answers, and what the page reads. */
const viewOf = async (fields: Doc, questions: Questions = []): Promise<StaffInquiry> => {
  const result = await worldOf(fields, questions).service.list({ filter: 'all' });
  if (result.ok === false) throw new Error(result.message);
  return result.value[0] as unknown as StaffInquiry;
};

describe('FILTER_LABELS', () => {
  it('words the five filters, in the order of the pills', () => {
    expect(FILTER_LABELS).toEqual({
      'needs-answer': 'Needs an answer',
      complaint: 'Complaints',
      praise: 'Praise',
      'not-labelled': 'Not labelled',
      all: 'All',
    });
    expect(Object.keys(FILTER_LABELS)).toEqual([...FILTERS]);
  });

  it("are the server's filters, in the server's order, and every one is a filter the route takes", () => {
    expect([...FILTERS]).toEqual([...INQUIRY_FILTERS]);
    for (const filter of FILTERS) expect(inquiryListInput.safeParse({ filter }).success, filter).toBe(true);
  });

  it('open on Needs an answer, as the server does without a filter', () => {
    expect(DEFAULT_FILTER).toBe('needs-answer');
  });

  it('ask for as many rows as the route takes', () => {
    expect(inquiryListInput.safeParse({ filter: 'all', limit: LIST_LIMIT }).success).toBe(true);
    expect(LIST_LIMIT).toBe(50);
  });
});

describe('the four cards', () => {
  it('count the open inquiries of each queue, in the words of the first four pills', () => {
    expect(COUNTS).toEqual([
      { key: 'needsAnswer', label: 'Needs an answer' },
      { key: 'complaint', label: 'Complaints' },
      { key: 'praise', label: 'Praise' },
      { key: 'notLabelled', label: 'Not labelled' },
    ]);
  });

  it("read every number the server's summary has, and nothing it hasn't", async () => {
    const summary = await worldOf({}).service.summary();
    expect(COUNTS.map(({ key }) => key).sort()).toEqual(Object.keys(summary).sort());
    expect(isSummary(summary)).toBe(true);
  });
});

describe('isSummary', () => {
  const SUMMARY = { needsAnswer: 2, complaint: 0, praise: 1, notLabelled: 3 };

  it('takes the four counts', () => {
    expect(isSummary(SUMMARY)).toBe(true);
    expect(isSummary({ needsAnswer: 0, complaint: 0, praise: 0, notLabelled: 0 })).toBe(true);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string, as a misrouted page answers', '<html></html>'],
    ['a list', [2, 0, 1, 3]],
    ['an error body', { error: { code: 'forbidden' } }],
    ['a count missing', { needsAnswer: 2, complaint: 0, praise: 1 }],
    ['a count that is text', { ...SUMMARY, praise: '1' }],
    ['a count that is null', { ...SUMMARY, notLabelled: null }],
    ['a count that is not a whole number', { ...SUMMARY, complaint: 1.5 }],
  ])('refuses %s: the page would show an empty card', (_label, value) => {
    expect(isSummary(value)).toBe(false);
  });
});

describe('kindLabel', () => {
  it.each([
    ['question', 'Question'],
    ['complaint', 'Complaint'],
    ['praise', 'Praise'],
    ['other', 'Other'],
  ] as const)('words the kind %s as %s', (kind, label) => {
    expect(kindLabel(kind)).toBe(label);
  });

  it('says Not labelled for an inquiry with no kind', () => {
    expect(kindLabel(null)).toBe('Not labelled');
  });

  it('has a word for every kind the server records', () => {
    for (const kind of INQUIRY_KINDS) expect(kindLabel(kind), kind).not.toBe('Not labelled');
  });

  it('shows a kind it has no word for as it came, instead of failing the whole table', () => {
    expect(kindLabel('complaint-ish' as never)).toBe('complaint-ish');
  });
});

describe('the selects of Change label', () => {
  it("offer the server's kinds and sentiments, in the server's order, in words staff know", () => {
    expect(KIND_OPTIONS).toEqual([
      { value: 'question', label: 'Question' },
      { value: 'complaint', label: 'Complaint' },
      { value: 'praise', label: 'Praise' },
      { value: 'other', label: 'Other' },
    ]);
    expect(KIND_OPTIONS.map(({ value }) => value)).toEqual([...INQUIRY_KINDS]);
    expect(SENTIMENT_OPTIONS).toEqual([
      { value: 'positive', label: 'Positive' },
      { value: 'neutral', label: 'Neutral' },
      { value: 'negative', label: 'Negative' },
    ]);
    expect(SENTIMENT_OPTIONS.map(({ value }) => value)).toEqual([...SENTIMENT_LABELS]);
  });

  it('word a kind the same way the kind badge does', () => {
    for (const { value, label } of KIND_OPTIONS) expect(kindLabel(value), value).toBe(label);
  });
});

describe('sentimentText', () => {
  it('shows the label with the score when there are both', () => {
    expect(sentimentText(-0.6, 'negative')).toBe('negative (-0.6)');
    expect(sentimentText(0.85, 'positive')).toBe('positive (0.85)');
    expect(sentimentText(0.1, 'neutral')).toBe('neutral (0.1)');
  });

  // A person's label has no score: the server clears the model's when a person gives a sentiment.
  it('shows the label alone when there is no score', () => {
    expect(sentimentText(null, 'negative')).toBe('negative');
    expect(sentimentText(null, 'positive')).toBe('positive');
    expect(sentimentText(null, 'neutral')).toBe('neutral');
  });

  it('shows a dash when there is no label', () => {
    expect(sentimentText(null, null)).toBe('-');
  });

  it('shows a dash for a score without a label, which the server never answers: there is nothing to put it beside', () => {
    expect(sentimentText(-0.6, null)).toBe('-');
  });

  it.each([
    [0, 'neutral (0)'],
    [1, 'positive (1)'],
    [-1, 'negative (-1)'],
    [0.7333333333, 'positive (0.73)'],
    [-0.666666, 'negative (-0.67)'],
    [0.5, 'positive (0.5)'],
    // Rounds to zero, and never shows "-0".
    [-0.004, 'neutral (0)'],
  ] as const)('writes the score %s with at most two decimals, and no trailing zero: %s', (score, text) => {
    const label = text.split(' ')[0] as 'positive' | 'neutral' | 'negative';
    expect(sentimentText(score, label)).toBe(text);
  });

  it('shows the label alone for a score that is not a number', () => {
    expect(sentimentText(Number.NaN, 'positive')).toBe('positive');
    expect(sentimentText(Number.POSITIVE_INFINITY, 'positive')).toBe('positive');
  });

  it("writes every row the server answers: a model's labels, a person's, and none", async () => {
    const modelled = await viewOf({ sentimentScore: -0.6, sentimentLabel: 'negative', kind: 'complaint', analysisStatus: 'analyzed' });
    expect(sentimentText(modelled.sentimentScore, modelled.sentimentLabel)).toBe('negative (-0.6)');

    // Change label clears the model's score when a person gives a sentiment.
    const { service } = worldOf({ sentimentScore: -0.6, sentimentLabel: 'negative', kind: 'complaint', analysisStatus: 'analyzed' });
    const relabelled = await service.changeLabel('inq-x', { sentimentLabel: 'neutral' });
    if (relabelled.ok === false) throw new Error(relabelled.message);
    expect(sentimentText(relabelled.value.sentimentScore, relabelled.value.sentimentLabel)).toBe('neutral');

    const unlabelled = await viewOf({});
    expect(sentimentText(unlabelled.sentimentScore, unlabelled.sentimentLabel)).toBe('-');
  });
});

describe('statusLabel', () => {
  it('says Open for an inquiry nobody has dealt with', () => {
    expect(statusLabel({ status: 'open', repliedBy: null, closeReason: null })).toBe('Open');
  });

  it('names the staff member who replied', () => {
    expect(statusLabel({ status: 'replied', repliedBy: 'Jane', closeReason: null })).toBe('Replied by Jane');
  });

  it.each([null, ''])('says "staff" when a reply has no name (%j)', (repliedBy) => {
    expect(statusLabel({ status: 'replied', repliedBy, closeReason: null })).toBe('Replied by staff');
  });

  it.each([
    ['answered-elsewhere', 'Closed: answered elsewhere'],
    ['not-needed', 'Closed: not needed'],
    ['spam', 'Closed: spam'],
  ] as const)('writes out why an inquiry was closed: %s', (closeReason, text) => {
    expect(statusLabel({ status: 'closed', repliedBy: null, closeReason })).toBe(text);
  });

  it('says only Closed for a closed inquiry with no reason, or a reason it has no words for', () => {
    expect(statusLabel({ status: 'closed', repliedBy: null, closeReason: null })).toBe('Closed');
    expect(statusLabel({ status: 'closed', repliedBy: null, closeReason: 'too-old' as never })).toBe('Closed');
  });

  it('writes the status of a row the server answers after a reply and after a close', async () => {
    const replied = await worldOf({}).service.reply('inq-x', 'Thank you.', 'Jane');
    expect(replied.status).toBe('sent');
    const afterReply = await worldOf({ status: 'replied', repliedBy: 'Jane' }).service.list({ filter: 'all' });
    if (afterReply.ok === false) throw new Error(afterReply.message);
    expect(statusLabel(afterReply.value[0])).toBe('Replied by Jane');

    const closed = await worldOf({}).service.close('inq-x', 'not-needed');
    if (closed.ok === false) throw new Error(closed.message);
    expect(statusLabel(closed.value)).toBe('Closed: not needed');
  });
});

describe('CLOSE_REASON_OPTIONS', () => {
  it("offer the server's reasons, in its order, in words staff know", () => {
    expect(CLOSE_REASON_OPTIONS).toEqual([
      { value: 'answered-elsewhere', label: 'Answered elsewhere' },
      { value: 'not-needed', label: 'Not needed' },
      { value: 'spam', label: 'Spam' },
    ]);
    expect(CLOSE_REASON_OPTIONS.map(({ value }) => value)).toEqual([...CLOSE_REASONS]);
  });

  it('are all reasons the route takes', () => {
    for (const { value } of CLOSE_REASON_OPTIONS) expect(closeInquiryInput.safeParse({ reason: value }).success, value).toBe(true);
  });
});

describe('labelNote', () => {
  it.each([
    ['pending', false, 'Waiting to be labelled'],
    ['skipped', false, 'Labelling was off'],
    ['failed', false, 'Labelling failed'],
    ['analyzed', false, null],
    // A person's label wins over the model's, whatever the analysis says.
    ['pending', true, 'Label changed by staff'],
    ['skipped', true, 'Label changed by staff'],
    ['failed', true, 'Label changed by staff'],
    ['analyzed', true, 'Label changed by staff'],
  ] as const)('for an inquiry the model has %s, with humanCorrected %s: %j', (analysisStatus, humanCorrected, note) => {
    expect(labelNote({ analysisStatus, humanCorrected })).toBe(note);
  });

  it("explains every inquiry the server lists under Not labelled, so staff can tell why it is there", async () => {
    const rows = [
      row('pending-1'),
      row('skipped-1', { analysisStatus: 'skipped' }),
      row('failed-1', { analysisStatus: 'failed', analysisAttempts: 5 }),
      row('labelled-1', { analysisStatus: 'analyzed', kind: 'praise', queue: 'praise' }),
    ];
    const { service } = world({ rows });

    const result = await service.list({ filter: 'not-labelled' });

    if (result.ok === false) throw new Error(result.message);
    expect(result.value.map((view) => [view.documentId, labelNote(view as unknown as StaffInquiry)])).toEqual([
      ['pending-1', 'Waiting to be labelled'],
      ['skipped-1', 'Labelling was off'],
      ['failed-1', 'Labelling failed'],
    ]);
  });
});

describe('handOffText', () => {
  it('points an inquiry whose question is open or taken to Questions', () => {
    expect(handOffText({ reference: 'Q-4821', status: 'open' })).toBe('Q-4821 · answer it under Questions');
    expect(handOffText({ reference: 'Q-4821', status: 'taken' })).toBe('Q-4821 · answer it under Questions');
  });

  it('says so when the question has been answered under Questions', () => {
    expect(handOffText({ reference: 'Q-4821', status: 'answered' })).toBe('Q-4821 · answered under Questions');
  });

  it('says so when the question is not there any more, and does not send staff to look for it', () => {
    expect(handOffText({ reference: 'Q-4821', status: null })).toBe('Q-4821 · no longer under Questions');
  });
});

describe("lineNote, on an inquiry's row", () => {
  it('says nothing when there is no LINE message, or LINE took it', () => {
    expect(lineNote(null)).toBeNull();
    expect(lineNote({ outcome: 'sent', detail: null })).toBeNull();
  });

  it("gives LINE's own words, in red, when the message failed", () => {
    expect(lineNote({ outcome: 'failed', detail: 'LINE answered 400: The request body has 1 error(s)' })).toEqual({
      text: 'LINE message failed: LINE answered 400: The request body has 1 error(s)',
      tone: 'danger',
    });
  });

  it('still says it failed when LINE gave no words', () => {
    expect(lineNote({ outcome: 'failed', detail: null })?.text).toBe('LINE message failed.');
    expect(lineNote({ outcome: 'failed', detail: '' })?.text).toBe('LINE message failed.');
  });
});

/*
 * The buttons a row gets. Each is offered exactly when the server would take what the button sends, so a button never
 * leads to a refusal staff could have been spared, and is never held back when the server would have taken it.
 */
describe('Reply on LINE is offered', () => {
  const CASES: Array<[string, Doc, Questions]> = [
    ['an open inquiry', {}, []],
    ['an open complaint', { kind: 'complaint', queue: 'complaint', analysisStatus: 'analyzed' }, []],
    // The log keeps a question only when it is the customer's: a turn that handed off with none recorded is answered here.
    ['an open hand-off turn that recorded no question', { handedOff: true, questionReference: null, queue: 'needs-answer' }, []],
    ['an open hand-off whose question is open', { handedOff: true, questionReference: 'Q-4821', queue: 'needs-answer' }, [{ reference: 'Q-4821', status: 'open' }]],
    ['an open hand-off whose question is taken', { handedOff: true, questionReference: 'Q-4821', queue: 'needs-answer' }, [{ reference: 'Q-4821', status: 'taken' }]],
    ['an open hand-off whose question was answered', { handedOff: true, questionReference: 'Q-4821', queue: 'needs-answer' }, [{ reference: 'Q-4821', status: 'answered' }]],
    ['an open hand-off whose question is gone', { handedOff: true, questionReference: 'Q-4821', queue: 'needs-answer' }, []],
    ['a replied inquiry', { status: 'replied', repliedBy: 'Jane', replyText: 'Thank you.' }, []],
    ['a closed inquiry', { status: 'closed', closeReason: 'spam' }, []],
  ];

  it.each(CASES)('exactly when the server would send it: %s', async (_label, fields, questions) => {
    const view = await viewOf(fields, questions);

    const outcome = await worldOf(fields, questions).service.reply('inq-x', 'Thank you.', 'Jane');

    expect(canReplyTo(view)).toBe(outcome.status === 'sent');
  });

  it('only on an open inquiry that has no question', () => {
    expect(canReplyTo({ status: 'open', question: null })).toBe(true);
    expect(canReplyTo({ status: 'open', question: { reference: 'Q-4821', status: 'open' } })).toBe(false);
    expect(canReplyTo({ status: 'open', question: { reference: 'Q-4821', status: 'answered' } })).toBe(false);
    expect(canReplyTo({ status: 'open', question: { reference: 'Q-4821', status: null } })).toBe(false);
    expect(canReplyTo({ status: 'replied', question: null })).toBe(false);
    expect(canReplyTo({ status: 'closed', question: null })).toBe(false);
  });
});

describe('Close is offered', () => {
  const CASES: Array<[string, Doc]> = [
    ['an open inquiry', {}],
    ['an open hand-off', { handedOff: true, questionReference: 'Q-4821', queue: 'needs-answer' }],
    ['a replied inquiry', { status: 'replied', repliedBy: 'Jane' }],
    ['a closed inquiry', { status: 'closed', closeReason: 'spam' }],
  ];

  it.each(CASES)('exactly when the server would close it: %s', async (_label, fields) => {
    const view = await viewOf(fields);

    const closed = await worldOf(fields).service.close('inq-x', 'not-needed');

    expect(canClose(view)).toBe(closed.ok);
  });

  it('only on an open inquiry', () => {
    expect(canClose({ status: 'open' })).toBe(true);
    expect(canClose({ status: 'replied' })).toBe(false);
    expect(canClose({ status: 'closed' })).toBe(false);
  });
});

describe('Label again is offered', () => {
  const CASES: Array<[string, Doc]> = [
    ['a failed inquiry', { analysisStatus: 'failed', analysisAttempts: 2 }],
    ['a failed inquiry that used its attempts, which is parked until staff press it', { analysisStatus: 'failed', analysisAttempts: 5 }],
    ['a failed inquiry a person labelled', { analysisStatus: 'failed', analysisAttempts: 2, humanCorrected: true, kind: 'other' }],
    ['a pending inquiry', { analysisStatus: 'pending' }],
    ['a skipped inquiry', { analysisStatus: 'skipped' }],
    ['a labelled inquiry', { analysisStatus: 'analyzed', kind: 'praise', queue: 'praise', sentimentLabel: 'positive' }],
  ];

  it.each(CASES)('exactly when the server would take it: %s', async (_label, fields) => {
    const view = await viewOf(fields);

    const again = await worldOf(fields).service.labelAgain('inq-x');

    expect(canLabelAgain(view)).toBe(again.ok);
  });

  it('only on a failed inquiry that no person has labelled', () => {
    expect(canLabelAgain({ analysisStatus: 'failed', humanCorrected: false })).toBe(true);
    expect(canLabelAgain({ analysisStatus: 'failed', humanCorrected: true })).toBe(false);
    for (const analysisStatus of ['pending', 'analyzed', 'skipped'] as const) {
      expect(canLabelAgain({ analysisStatus, humanCorrected: false }), analysisStatus).toBe(false);
    }
  });
});

describe('the reply the dialog sends', () => {
  it('is the text, trimmed, with the line breaks and spaces inside it left alone', () => {
    expect(replyBody('  Thank you.\n\nWe will call you.  \n')).toEqual({ text: 'Thank you.\n\nWe will call you.' });
    expect(replyBody('Thank you.')).toEqual({ text: 'Thank you.' });
  });

  it('is a body the server takes, whatever the box held that Send on LINE allowed', () => {
    for (const text of ['x', ' Hello ', 'a\n\nb', 'x'.repeat(2000), ` ${'x'.repeat(2000)} `, '腕時計', '😀'.repeat(1000)]) {
      expect(canSendReply(text), text.slice(0, 10)).toBe(true);
      expect(replyInquiryInput.safeParse(replyBody(text)).success, text.slice(0, 10)).toBe(true);
    }
  });
});

describe('Send on LINE', () => {
  it.each([
    ['nothing written', false, ''],
    ['only spaces and line breaks', false, ' \n \t '],
    ['1 character', true, 'x'],
    ['2,000 characters', true, 'x'.repeat(2000)],
    ['2,000 characters between spaces and line breaks', true, `\n ${'x'.repeat(2000)} \n`],
    ['2,001 characters', false, 'x'.repeat(2001)],
    ['1,001 emoji, which are 2,002 units', false, '😀'.repeat(1001)],
    ['1,000 emoji, which are 2,000 units', true, '😀'.repeat(1000)],
  ])('with %s, enabled is %s', (_label, enabled, text) => {
    expect(canSendReply(text)).toBe(enabled);
  });

  it("has the server's limit of 2,000 characters", () => {
    expect(REPLY_LIMIT).toBe(2000);
    expect(replyTooLong('x'.repeat(2000))).toBe(false);
    expect(replyTooLong('x'.repeat(2001))).toBe(true);
    expect(replyTooLong(` ${'x'.repeat(2000)} `)).toBe(false);
  });

  // Enabled exactly when the server takes the body, so the dialog never sends what is refused and never holds back what is fine.
  it('is enabled exactly when the server takes the body', () => {
    const texts = ['', ' ', '\n\n', 'Yes.', 'x'.repeat(1999), 'x'.repeat(2000), 'x'.repeat(2001), ` ${'x'.repeat(2000)} `, ` ${'x'.repeat(2001)} `, '😀'.repeat(1000), '😀'.repeat(1001), '。'.repeat(2000)];
    for (const text of texts) {
      expect(canSendReply(text), JSON.stringify({ length: text.length, head: text.slice(0, 5) })).toBe(replyInquiryInput.safeParse(replyBody(text)).success);
    }
  });
});

describe('Use the suggested text', () => {
  it('puts the text in an empty box', () => {
    expect(insertSuggested('', 'We are sorry.')).toBe('We are sorry.');
    expect(insertSuggested('  \n ', 'We are sorry.')).toBe('We are sorry.');
  });

  it('adds the text after what staff have written, as a new paragraph, so nothing they typed is lost', () => {
    expect(insertSuggested('Dear customer,', 'We are sorry.')).toBe('Dear customer,\n\nWe are sorry.');
    expect(insertSuggested('Dear customer,\n\n', 'We are sorry.')).toBe('Dear customer,\n\nWe are sorry.');
  });
});

describe('suggestedReply, which the dialog bundles', () => {
  it.each(INQUIRY_QUEUES.flatMap((queue) => LOCALES.map((language) => [queue, language] as const)))(
    "is the server's text for the %s queue in %s",
    (queue, language) => {
      expect(suggestedReply(queue, language)).toBe(serverSuggestedReply(queue, language));
    }
  );

  it('suggests a text for a complaint and for praise, in both languages, and for nothing else', () => {
    for (const language of LOCALES) {
      expect(suggestedReply('complaint', language)).toEqual(expect.any(String));
      expect(suggestedReply('praise', language)).toEqual(expect.any(String));
      expect(suggestedReply('needs-answer', language)).toBeNull();
      expect(suggestedReply('none', language)).toBeNull();
    }
  });

  it('is a text the reply form takes, as it is', () => {
    for (const queue of ['complaint', 'praise'] as const) {
      for (const language of LOCALES) {
        const text = suggestedReply(queue, language) as string;
        expect(canSendReply(text), `${queue} ${language}`).toBe(true);
      }
    }
  });
});

describe('the labels the dialog of Change label sends', () => {
  const MODEL: Pick<StaffInquiry, 'kind' | 'sentimentLabel'> = { kind: 'question', sentimentLabel: 'neutral' };
  const UNLABELLED: Pick<StaffInquiry, 'kind' | 'sentimentLabel'> = { kind: null, sentimentLabel: null };

  it('starts at the inquiry\'s own labels, and at nothing chosen for a label it has not got', () => {
    expect(labelForm(MODEL)).toEqual({ kind: 'question', sentimentLabel: 'neutral' });
    expect(labelForm(UNLABELLED)).toEqual({ kind: '', sentimentLabel: '' });
    expect(labelForm({ kind: 'praise', sentimentLabel: null })).toEqual({ kind: 'praise', sentimentLabel: '' });
  });

  // The server clears the model's score when it is given a sentiment, so a person who only changes the kind must not send one.
  it('sends only what staff changed', () => {
    expect(labelBody({ kind: 'complaint', sentimentLabel: 'neutral' }, MODEL)).toEqual({ kind: 'complaint' });
    expect(labelBody({ kind: 'question', sentimentLabel: 'negative' }, MODEL)).toEqual({ sentimentLabel: 'negative' });
    expect(labelBody({ kind: 'complaint', sentimentLabel: 'negative' }, MODEL)).toEqual({ kind: 'complaint', sentimentLabel: 'negative' });
  });

  it('sends what staff picked for an inquiry with no labels', () => {
    expect(labelBody({ kind: 'praise', sentimentLabel: '' }, UNLABELLED)).toEqual({ kind: 'praise' });
    expect(labelBody({ kind: '', sentimentLabel: 'positive' }, UNLABELLED)).toEqual({ sentimentLabel: 'positive' });
    expect(labelBody({ kind: 'praise', sentimentLabel: 'positive' }, UNLABELLED)).toEqual({ kind: 'praise', sentimentLabel: 'positive' });
  });

  it('sends nothing when nothing changed, and leaves out a label that was not picked, or is not one', () => {
    expect(labelBody(labelForm(MODEL), MODEL)).toEqual({});
    expect(labelBody({ kind: '', sentimentLabel: '' }, UNLABELLED)).toEqual({});
    expect(labelBody({ kind: 'angry', sentimentLabel: '3' }, UNLABELLED)).toEqual({});
  });

  it('can be saved only when it changes something', () => {
    expect(canSaveLabels(labelForm(MODEL), MODEL)).toBe(false);
    expect(canSaveLabels({ kind: '', sentimentLabel: '' }, UNLABELLED)).toBe(false);
    expect(canSaveLabels({ kind: 'complaint', sentimentLabel: 'neutral' }, MODEL)).toBe(true);
    expect(canSaveLabels({ kind: 'question', sentimentLabel: 'negative' }, MODEL)).toBe(true);
    expect(canSaveLabels({ kind: 'praise', sentimentLabel: '' }, UNLABELLED)).toBe(true);
  });

  // The server refuses a sentiment alone for an inquiry with no kind ("Pick a kind too."): with no kind it is in no queue.
  it('needs a kind for an inquiry that has none, so a sentiment alone can not be saved', () => {
    expect(canSaveLabels({ kind: '', sentimentLabel: 'positive' }, UNLABELLED)).toBe(false);
    expect(canSaveLabels({ kind: 'angry', sentimentLabel: 'positive' }, UNLABELLED)).toBe(false);
    expect(canSaveLabels({ kind: 'praise', sentimentLabel: 'positive' }, UNLABELLED)).toBe(true);
    // An inquiry that has a kind already takes a sentiment alone, as it always did.
    expect(canSaveLabels({ kind: 'question', sentimentLabel: 'negative' }, MODEL)).toBe(true);
  });

  // The page's own rule and the server's are one: the route's input schema, then the service, for every pick of kind and sentiment.
  it('is saved exactly when the server takes the body, for every pick of kind and sentiment', async () => {
    const picks = ['', ...INQUIRY_KINDS, 'angry'];
    const sentiments = ['', ...SENTIMENT_LABELS, '3'];
    // A kind and no sentiment, a sentiment and no kind (rows a person labelled before the server asked for a kind), both, and neither.
    const rows: Array<Pick<StaffInquiry, 'kind' | 'sentimentLabel'>> = [MODEL, UNLABELLED, { kind: null, sentimentLabel: 'positive' }, { kind: 'other', sentimentLabel: null }];
    for (const row of rows) {
      for (const kind of picks) {
        for (const sentimentLabel of sentiments) {
          const form = { kind, sentimentLabel };
          const body = labelBody(form, row);
          const taken = changeLabelInput.safeParse(body).success && (await worldOf(row).service.changeLabel('inq-x', body)).ok;
          expect(canSaveLabels(form, row), JSON.stringify({ form, row })).toBe(taken);
        }
      }
    }
  });

  it("is a change the server makes: the row is the person's, with the queue following the kind", async () => {
    const { service } = worldOf({ kind: null, analysisStatus: 'pending' });
    const body = labelBody({ kind: 'complaint', sentimentLabel: 'negative' }, UNLABELLED);

    const result = await service.changeLabel('inq-x', body);

    if (result.ok === false) throw new Error(result.message);
    expect(result.value).toMatchObject({ kind: 'complaint', sentimentLabel: 'negative', humanCorrected: true, queue: 'complaint' });
  });

  // Save label is disabled for want of a kind, and the dialog says so under Kind, in the words the server refuses it with.
  describe('what the dialog says under Kind', () => {
    it('is "Pick a kind too." when staff pick only a sentiment for an inquiry that has no kind', () => {
      expect(kindNeededNotice({ kind: '', sentimentLabel: 'positive' }, UNLABELLED)).toBe('Pick a kind too.');
      expect(kindNeededNotice({ kind: 'angry', sentimentLabel: 'negative' }, UNLABELLED)).toBe('Pick a kind too.');
      expect(kindNeededNotice({ kind: '', sentimentLabel: 'neutral' }, { kind: null, sentimentLabel: 'positive' })).toBe('Pick a kind too.');
    });

    it('is nothing once a kind is picked, for an inquiry that has one, and while nothing is changed', () => {
      expect(kindNeededNotice({ kind: 'praise', sentimentLabel: 'positive' }, UNLABELLED)).toBeNull();
      expect(kindNeededNotice({ kind: 'praise', sentimentLabel: '' }, UNLABELLED)).toBeNull();
      expect(kindNeededNotice({ kind: '', sentimentLabel: 'negative' }, MODEL)).toBeNull();
      expect(kindNeededNotice({ kind: 'question', sentimentLabel: 'negative' }, MODEL)).toBeNull();
      expect(kindNeededNotice({ kind: '', sentimentLabel: '' }, UNLABELLED)).toBeNull();
      expect(kindNeededNotice(labelForm(MODEL), MODEL)).toBeNull();
      // A sentiment the inquiry has already is no change, so there is nothing to ask a kind for.
      expect(kindNeededNotice({ kind: '', sentimentLabel: 'positive' }, { kind: null, sentimentLabel: 'positive' })).toBeNull();
    });

    // Only the sentiment-alone rule disables Save label for a change: the notice shows exactly when it does.
    it('shows exactly when Save label is disabled for want of a kind, for every pick of kind and sentiment', () => {
      const picks = ['', ...INQUIRY_KINDS, 'angry'];
      const sentiments = ['', ...SENTIMENT_LABELS, '3'];
      const rows: Array<Pick<StaffInquiry, 'kind' | 'sentimentLabel'>> = [MODEL, UNLABELLED, { kind: null, sentimentLabel: 'positive' }, { kind: 'other', sentimentLabel: null }];
      for (const row of rows) {
        for (const kind of picks) {
          for (const sentimentLabel of sentiments) {
            const form = { kind, sentimentLabel };
            const changesSomething = Object.keys(labelBody(form, row)).length > 0;
            expect(kindNeededNotice(form, row) !== null, JSON.stringify({ form, row })).toBe(changesSomething && !canSaveLabels(form, row));
          }
        }
      }
    });

    it("is the server's own words for that refusal", async () => {
      const refused = await worldOf({ kind: null }).service.changeLabel('inq-x', { sentimentLabel: 'positive' });

      expect(refused).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(kindNeededNotice({ kind: '', sentimentLabel: 'positive' }, UNLABELLED)).toBe((refused as { message: string }).message);
    });
  });
});

describe('quotaText', () => {
  it('shows the messages sent this month, and the limit when there is one', () => {
    expect(quotaText({ configured: true, used: 12, limit: 200 })).toBe('LINE messages this month: 12 of 200');
    expect(quotaText({ configured: true, used: 0, limit: 200 })).toBe('LINE messages this month: 0 of 200');
  });

  it('shows only the messages sent when the channel has no limit', () => {
    expect(quotaText({ configured: true, used: 12, limit: null })).toBe('LINE messages this month: 12');
  });

  it('shows nothing when LINE gave no count: with no token, or no answer', () => {
    expect(quotaText({ configured: false, used: null, limit: null })).toBe('');
    expect(quotaText({ configured: true, used: null, limit: null })).toBe('');
    expect(quotaText({ configured: true, used: null, limit: 200 })).toBe('');
  });

  it('shows nothing for an answer that is not a count', () => {
    expect(quotaText(undefined as never)).toBe('');
    expect(quotaText({} as never)).toBe('');
    expect(quotaText({ configured: true, used: '12', limit: 200 } as never)).toBe('');
  });

  it('writes thousands with a comma', () => {
    expect(quotaText({ configured: true, used: 1234, limit: 5000 })).toBe('LINE messages this month: 1,234 of 5,000');
    expect(quotaText({ configured: true, used: 31200, limit: null })).toBe('LINE messages this month: 31,200');
  });

  it("writes what the server's quota route answers, with and without a token", async () => {
    // Without the channel access token, the service answers nothing to show.
    const without = await world({ rows: [] }).service.quota();
    expect(quotaText(without)).toBe('');

    // With it, LINE's two answers become the line above the table.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        new Response(JSON.stringify(url.endsWith('/consumption') ? { totalUsage: 12 } : { type: 'limited', value: 200 }), { status: 200 })
      )
    );
    const withToken = await world({ rows: [], config: WITH_TOKEN }).service.quota();
    expect(quotaText(withToken)).toBe('LINE messages this month: 12 of 200');
  });
});

describe('noTokenNotice', () => {
  it("is the server's own message about the missing token, when the quota route says there is none", () => {
    expect(noTokenNotice({ configured: false, used: null, limit: null })).toBe(NO_TOKEN);
  });

  // The dialog stays usable until the page knows better: the server refuses a reply it can't send, with its own message.
  it('is nothing when there is a token, whatever LINE answered about the quota', () => {
    expect(noTokenNotice({ configured: true, used: 12, limit: 200 })).toBeNull();
    expect(noTokenNotice({ configured: true, used: null, limit: null })).toBeNull();
  });

  it('is nothing before the quota has loaded, when it failed to load, and for an answer that is not a quota', () => {
    expect(noTokenNotice(null)).toBeNull();
    expect(noTokenNotice(undefined)).toBeNull();
    expect(noTokenNotice({} as never)).toBeNull();
    expect(noTokenNotice('<html></html>' as never)).toBeNull();
    expect(noTokenNotice({ used: null, limit: null } as never)).toBeNull();
  });

  // The notice is what Send on LINE would be refused with, so it shows exactly when the server would refuse for the token.
  it.each([
    ['no token', {}],
    ['an empty token', { lineChannelAccessToken: '', lineApiBaseUrl: LINE_API }],
    ['a token', WITH_TOKEN],
  ])('shows exactly when the server would refuse a reply for the token: %s', async (_label, config) => {
    const { service } = world({ rows: [row('inq-x')], config });

    const notice = noTokenNotice(await service.quota());
    const outcome = await service.reply('inq-x', 'Thank you.', 'Jane');

    expect(notice !== null).toBe(outcome.status === 'not_configured');
    if (outcome.status === 'not_configured') expect(notice).toBe(outcome.message);
  });
});

describe('introText', () => {
  it('says that a model labels each inquiry, and offers an admin who may change labels to change them', () => {
    expect(introText(true)).toBe('What customers ask the concierge, in queues. A model labels each inquiry, and you can change its label.');
  });

  // Change label is behind the same permission as Reply on LINE, so a view-only admin has no button for it.
  it("leaves out changing the label for an admin who can't: they have no button for it", () => {
    expect(introText(false)).toBe('What customers ask the concierge, in queues. A model labels each inquiry.');
    expect(introText(false)).not.toMatch(/change/i);
  });
});

describe("the row's \"Your LINE\" label", () => {
  const YOU_ID = `U${'5ca1ab1e'.repeat(4)}`;
  const withYou = { ...WITH_TOKEN, demoLineUserId: YOU_ID };

  // The page reads `yourLine` from the server's own view, so the label shows on exactly the rows the server marks.
  it("is on the presenter's own rows, as the server's view says, and on no other", async () => {
    const mine = await world({ rows: [row('inq-x', { customer: `line:${YOU_ID}` })], config: withYou }).service.list({ filter: 'all' });
    const theirs = await world({ rows: [row('inq-x')], config: withYou }).service.list({ filter: 'all' });
    if (mine.ok === false || theirs.ok === false) throw new Error('The list failed.');
    expect(yourLineBadge(mine.value[0] as unknown as StaffInquiry)?.label).toBe(YOUR_LINE_LABEL);
    expect(yourLineBadge(theirs.value[0] as unknown as StaffInquiry)).toBeNull();
  });

  it('is on no row when demoLineUserId is not set, so a Strapi without the setting shows no label', async () => {
    const view = await viewOf({ customer: `line:${YOU_ID}` });
    expect(view.yourLine).toBe(false);
    expect(yourLineBadge(view)).toBeNull();
  });
});
