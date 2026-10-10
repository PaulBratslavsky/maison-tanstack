import { afterEach, describe, expect, it, vi } from 'vitest';
import { UID } from '../../server/src/constants';
import appointments from '../../server/src/services/appointments';
import questions from '../../server/src/services/questions';
import { matches } from './fake-filters';
import { COMPLAINT, HANDED_OFF, PENDING, PENDING_VIEW, SUBJECT, UNANSWERED, row, world } from './fake-inquiries';
import { fakeStrapi } from './fake-strapi';

type Doc = Record<string, any>;

// Tokyo's 6 October starts at 15:00 UTC on the 5th. A row at 15:30Z is 00:30 on the 6th there, and one at 14:30Z is 23:30 on the 5th.
const AFTER_MIDNIGHT = '2026-10-05T15:30:00.000Z';
const BEFORE_MIDNIGHT = '2026-10-05T14:30:00.000Z';
const TOKYO_MIDNIGHT = '2026-10-05T15:00:00.000Z';

const originalZone = process.env.TZ;
afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

/** The server's own time zone changes what `new Date(…).getDate()` says, and must change nothing the filters do. */
const SERVER_ZONES = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'];

describe("the test stand-in's $gte", () => {
  it('keeps a row at or after the moment, compared as text the way $lt is, and never a row with no value', () => {
    expect(matches({ createdAt: AFTER_MIDNIGHT }, { createdAt: { $gte: TOKYO_MIDNIGHT } })).toBe(true);
    expect(matches({ createdAt: TOKYO_MIDNIGHT }, { createdAt: { $gte: TOKYO_MIDNIGHT } })).toBe(true);
    expect(matches({ createdAt: BEFORE_MIDNIGHT }, { createdAt: { $gte: TOKYO_MIDNIGHT } })).toBe(false);
    expect(matches({ createdAt: null }, { createdAt: { $gte: TOKYO_MIDNIGHT } })).toBe(false);
    expect(matches({}, { createdAt: { $gte: TOKYO_MIDNIGHT } })).toBe(false);
  });
});

describe("the test stand-in with more than one operator in a condition", () => {
  const INSIDE = '2026-10-10T05:00:00.000Z';
  const START = '2026-10-10T00:00:00.000Z';
  const END = '2026-10-11T00:00:00.000Z';
  const AFTER = '2026-10-11T05:00:00.000Z';
  const BEFORE = '2026-10-09T05:00:00.000Z';

  it('needs every operator to hold: $gte and $lt keep a row from the start up to, not including, the end', () => {
    const day = { requestedFor: { $gte: START, $lt: END } };
    expect(matches({ requestedFor: INSIDE }, day)).toBe(true);
    expect(matches({ requestedFor: START }, day)).toBe(true);
    expect(matches({ requestedFor: END }, day)).toBe(false);
    expect(matches({ requestedFor: AFTER }, day)).toBe(false);
    expect(matches({ requestedFor: BEFORE }, day)).toBe(false);
    expect(matches({ requestedFor: null }, day)).toBe(false);
  });

  it('needs every operator to hold: $gte and $lte keep a row from the start up to and including the end', () => {
    const day = { requestedFor: { $gte: START, $lte: END } };
    expect(matches({ requestedFor: INSIDE }, day)).toBe(true);
    expect(matches({ requestedFor: START }, day)).toBe(true);
    expect(matches({ requestedFor: END }, day)).toBe(true);
    expect(matches({ requestedFor: AFTER }, day)).toBe(false);
    expect(matches({ requestedFor: BEFORE }, day)).toBe(false);
    expect(matches({ requestedFor: undefined }, day)).toBe(false);
  });

  it('still refuses an operator it does not know, wherever it is in the condition', () => {
    expect(() => matches({ requestedFor: INSIDE }, { requestedFor: { $gte: START, $startsWith: 'x' } })).toThrow(/\$startsWith/);
  });
});

describe('inquiries.list, since and kind', () => {
  const TABLE: Doc[] = [
    row('complaint-open', { queue: 'complaint', kind: 'complaint', analysisStatus: 'analyzed', createdAt: AFTER_MIDNIGHT }),
    row('complaint-replied', { queue: 'complaint', kind: 'complaint', analysisStatus: 'analyzed', status: 'replied', createdAt: AFTER_MIDNIGHT }),
    row('complaint-closed', { queue: 'complaint', kind: 'complaint', analysisStatus: 'analyzed', status: 'closed', closeReason: 'spam', createdAt: AFTER_MIDNIGHT }),
    row('complaint-old', { queue: 'complaint', kind: 'complaint', analysisStatus: 'analyzed', createdAt: BEFORE_MIDNIGHT }),
    row('praise-new', { queue: 'praise', kind: 'praise', analysisStatus: 'analyzed', createdAt: AFTER_MIDNIGHT }),
    row('question-new', { queue: 'needs-answer', kind: 'question', analysisStatus: 'analyzed', createdAt: AFTER_MIDNIGHT }),
  ];
  const idsOf = (result: { ok: boolean; value?: Array<{ documentId: string }> }) => (result.ok ? result.value!.map((view) => view.documentId) : []);

  it('lists every complaint of the week, replied and closed ones too, with the All filter and a kind', async () => {
    const { service } = world({ rows: TABLE });
    const result = await service.list({ filter: 'all', kind: 'complaint', since: '2026-10-06' });
    expect(idsOf(result)).toEqual(['complaint-open', 'complaint-replied', 'complaint-closed']);
  });

  it('adds the kind to the filter own conditions, as flat keys with no $and', async () => {
    const { service, findMany } = world();
    await service.list({ filter: 'complaint', kind: 'complaint' });
    await service.list({ filter: 'all', kind: 'praise', since: '2026-10-06' });
    expect(findMany.mock.calls[0][0].filters).toEqual({ status: { $eq: 'open' }, queue: { $eq: 'complaint' }, kind: { $eq: 'complaint' } });
    expect(findMany.mock.calls[1][0].filters).toEqual({ kind: { $eq: 'praise' }, createdAt: { $gte: TOKYO_MIDNIGHT } });
  });

  it('starts since at the beginning of that day in the plugin zone: 00:30 in Tokyo is in, 23:30 the evening before is not', async () => {
    for (const zone of SERVER_ZONES) {
      process.env.TZ = zone;
      const { service } = world({ rows: TABLE });
      expect(idsOf(await service.list({ filter: 'all', since: '2026-10-06' })), zone).toEqual([
        'complaint-open', 'complaint-replied', 'complaint-closed', 'praise-new', 'question-new',
      ]);
      expect(idsOf(await service.list({ filter: 'all', since: '2026-10-05' })), zone).toContain('complaint-old');
    }
  });

  it('uses the zone the plugin is set to, not Tokyo only', async () => {
    const { service, findMany } = world({ config: { timezone: 'UTC' } });
    await service.list({ filter: 'all', since: '2026-10-06' });
    expect(findMany.mock.calls[0][0].filters).toEqual({ createdAt: { $gte: '2026-10-06T00:00:00.000Z' } });
  });

  it('adds nothing for a filter with neither, so the tab lists what it always has', async () => {
    const { service, findMany } = world();
    await service.list({ filter: 'needs-answer' });
    expect(findMany.mock.calls[0][0].filters).toEqual({ status: { $eq: 'open' }, queue: { $eq: 'needs-answer' } });
  });

  it.each(['2026-02-30', '2026-10-6', 'yesterday', '', '2026-10-06T00:00:00Z', 42])('refuses the since "%s", which is not a real date, and lists nothing', async (since) => {
    const { service, findMany } = world({ rows: TABLE });
    const result = await service.list({ filter: 'all', since: since as any });
    expect(result).toEqual({ ok: false, code: 'invalid_input', message: expect.stringContaining(`"${since}"`), hint: expect.stringContaining('YYYY-MM-DD') });
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each(['rant', 'COMPLAINT', '', 'toString', '__proto__'])('refuses the kind "%s", which is not one of the four, and lists nothing', async (kind) => {
    const { service, findMany } = world({ rows: TABLE });
    const result = await service.list({ filter: 'all', kind: kind as any });
    expect(result).toEqual({ ok: false, code: 'invalid_input', message: expect.stringContaining(`Unknown kind "${kind}"`), hint: expect.stringContaining('question, complaint, praise, other') });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('inquiries.view', () => {
  it('gives one inquiry as staff see it', async () => {
    const { service } = world({ rows: [PENDING, COMPLAINT] });
    expect(await service.view('inq-1')).toEqual({ ok: true, value: PENDING_VIEW });
  });

  it('gives its product name and its linked question, as the list does', async () => {
    const { service } = world({
      rows: [HANDED_OFF, { ...COMPLAINT, productSlug: 'jewelry-coffret' }],
      pieces: [{ slug: 'jewelry-coffret', name: 'Jewelry Coffret', locale: 'en' }],
      questions: [{ reference: 'Q-4821', status: 'open' }],
    });
    expect(await service.view('inq-3')).toMatchObject({ ok: true, value: { documentId: 'inq-3', question: { reference: 'Q-4821', status: 'open' } } });
    expect(await service.view('inq-4')).toMatchObject({ ok: true, value: { product: { slug: 'jewelry-coffret', name: 'Jewelry Coffret' } } });
  });

  it('answers not_found for an inquiry that is not there, and never an empty view', async () => {
    const { service } = world({ rows: [UNANSWERED] });
    expect(await service.view('inq-9')).toEqual({
      ok: false,
      code: 'not_found',
      message: 'No inquiry "inq-9".',
      hint: expect.stringContaining('Reload the Inquiries tab'),
    });
  });
});

/** The questions as the Document Service holds them: a table `findMany` filters the way the database would. */
const questionsWorld = (rows: Doc[], config: Doc = {}) => {
  const findMany = vi.fn(async ({ filters }: Doc) => rows.filter((candidate) => matches(candidate, filters)).map((candidate) => ({ ...candidate })));
  const documents = (uid: string) => {
    if (uid === UID.question) return { findMany };
    throw new Error(`These tests have no ${uid}.`);
  };
  return { service: questions({ strapi: fakeStrapi({ documents, config }) }), findMany };
};

const question = (reference: string, fields: Doc = {}): Doc => ({
  reference,
  customer: SUBJECT,
  customerName: null,
  question: 'Can the coffret hold a watch?',
  reason: 'no_answer',
  language: 'en',
  productSlug: null,
  status: 'open',
  createdAt: AFTER_MIDNIGHT,
  ...fields,
});

describe('questions.list, since and reference', () => {
  const TABLE = [
    question('Q-1001'),
    question('Q-1002', { status: 'taken' }),
    question('Q-1003', { status: 'answered' }),
    question('Q-1004', { createdAt: BEFORE_MIDNIGHT }),
  ];
  const referencesOf = (result: { ok: boolean; value?: Array<{ reference: string }> }) => (result.ok ? result.value!.map((view) => view.reference) : []);

  it('starts since at the beginning of that day in the plugin zone, whatever zone the server is in', async () => {
    for (const zone of SERVER_ZONES) {
      process.env.TZ = zone;
      const { service } = questionsWorld(TABLE);
      expect(referencesOf(await service.list({ status: 'all', since: '2026-10-06' })), zone).toEqual(['Q-1001', 'Q-1002', 'Q-1003']);
      expect(referencesOf(await service.list({ status: 'all', since: '2026-10-05' })), zone).toContain('Q-1004');
    }
  });

  it('keeps the status filter beside since', async () => {
    const { service, findMany } = questionsWorld(TABLE);
    expect(referencesOf(await service.list({ since: '2026-10-06' }))).toEqual(['Q-1001', 'Q-1002']);
    expect(findMany.mock.calls[0][0].filters).toEqual({ status: { $in: ['open', 'taken'] }, createdAt: { $gte: TOKYO_MIDNIGHT } });
  });

  it('finds one question by its reference whatever its status, answered ones too', async () => {
    const { service, findMany } = questionsWorld(TABLE);
    expect(referencesOf(await service.list({ reference: 'Q-1003' }))).toEqual(['Q-1003']);
    expect(referencesOf(await service.list({ reference: 'Q-1003', status: 'open' }))).toEqual(['Q-1003']);
    expect(findMany.mock.calls[0][0].filters).toEqual({ reference: { $eq: 'Q-1003' } });
  });

  it('finds nothing for a reference no question has, as an empty list', async () => {
    const { service } = questionsWorld(TABLE);
    expect(await service.list({ reference: 'Q-4812' })).toEqual({ ok: true, value: [] });
  });

  it('adds nothing for neither, so the Questions tab lists what it always has', async () => {
    const { service, findMany } = questionsWorld(TABLE);
    await service.list();
    expect(findMany.mock.calls[0][0].filters).toEqual({ status: { $in: ['open', 'taken'] } });
  });

  it.each(['2026-02-30', '2026-10-6', 'yesterday', '', 42])('refuses the since "%s", which is not a real date, and lists nothing', async (since) => {
    const { service, findMany } = questionsWorld(TABLE);
    const result = await service.list({ since: since as any });
    expect(result).toEqual({ ok: false, code: 'invalid_input', message: expect.stringContaining(`"${since}"`), hint: expect.stringContaining('YYYY-MM-DD') });
    expect(findMany).not.toHaveBeenCalled();
  });
});

/** An appointment draft as the Document Service holds it, with its relations as documentIds. */
const draft = (reference: string, fields: Doc = {}): Doc => ({
  documentId: `doc-${reference}`,
  reference,
  customer: SUBJECT,
  requestedFor: '2026-09-20T05:00:00.000Z',
  customerNote: 'For my father.',
  createdVia: 'concierge',
  createdAt: '2026-09-10T01:00:00.000Z',
  boutique: { documentId: 'b-ginza' },
  products: [{ documentId: 'p-weekender' }],
  ...fields,
});

/**
 * The Document Service as listRequests reads it. A draft query keeps the rows that meet every condition of its $and, and
 * a published query answers the confirmed documents. Every draft query is kept, for a test to read what was asked.
 */
const requestsWorld = (rows: Doc[], confirmed: string[] = []) => {
  // The board's requested view also holds `documentId: { $notIn }`, which the shared stand-in has no use for elsewhere.
  const meets = (candidate: Doc, condition: Doc) =>
    condition.documentId?.$notIn ? !condition.documentId.$notIn.includes(candidate.documentId) : matches(candidate, condition);
  const drafts = vi.fn(async ({ filters }: Doc) => rows.filter((candidate) => ((filters?.$and ?? []) as Doc[]).every((condition) => meets(candidate, condition))));
  const labelOf = (name: string) => async ({ filters }: Doc) => (filters.documentId.$in as string[]).map((documentId) => ({ documentId, slug: name, name }));
  const documents = (uid: string) => {
    if (uid === UID.appointment) {
      return {
        findMany: async (query: Doc) =>
          query.status === 'published' ? rows.filter((candidate) => confirmed.includes(candidate.documentId)).map(({ documentId }) => ({ documentId })) : drafts(query),
      };
    }
    if (uid === UID.notification) return { findMany: async () => [] };
    if (uid === UID.boutique) return { findMany: labelOf('Ginza Flagship') };
    if (uid === UID.product) return { findMany: labelOf('Weekender 50') };
    throw new Error(`These tests have no ${uid}.`);
  };
  return { service: appointments({ strapi: fakeStrapi({ documents }) }), drafts };
};

describe('appointments.listRequests, reference', () => {
  // A confirmed request whose visit is long past, and a waiting one whose visit is ahead: the board's views list only the second.
  const NOW = new Date('2026-10-06T01:00:00.000Z');
  const TABLE = [
    draft('APT-1001', { requestedFor: '2026-09-20T05:00:00.000Z' }),
    draft('APT-1002', { requestedFor: '2026-10-20T05:00:00.000Z' }),
  ];
  const referencesOf = (result: { ok: boolean; value?: Array<{ reference: string }> }) => (result.ok ? result.value!.map((view) => view.reference) : []);

  it('finds one request by its reference whatever its status or its visit date: confirmed and past ones too', async () => {
    const { service } = requestsWorld(TABLE, ['doc-APT-1001']);
    const result = await service.listRequests({ reference: 'APT-1001', now: NOW });
    expect(referencesOf(result)).toEqual(['APT-1001']);
    expect(result).toMatchObject({ ok: true, value: [{ status: 'confirmed', boutique: { name: 'Ginza Flagship' } }] });
  });

  it('makes the status filter all when there is a reference, even when a status is given', async () => {
    const { service, drafts } = requestsWorld(TABLE, ['doc-APT-1001']);
    expect(referencesOf(await service.listRequests({ reference: 'APT-1001', status: 'requested', now: NOW }))).toEqual(['APT-1001']);
    expect(referencesOf(await service.listRequests({ reference: 'APT-1002', status: 'confirmed', now: NOW }))).toEqual(['APT-1002']);
    expect(drafts.mock.calls[0][0].filters).toEqual({ $and: [{ reference: { $eq: 'APT-1001' } }] });
    expect(drafts.mock.calls[0][0].sort).toBe('createdAt:desc');
  });

  it('answers an empty list for a reference no request has', async () => {
    const { service } = requestsWorld(TABLE);
    expect(await service.listRequests({ reference: 'APT-4812', now: NOW })).toEqual({ ok: true, value: [] });
  });

  it('lists only the waiting requests with a visit ahead when there is no reference, as the board does', async () => {
    const { service } = requestsWorld(TABLE, ['doc-APT-1001']);
    expect(referencesOf(await service.listRequests({ now: NOW }))).toEqual(['APT-1002']);
  });
});
