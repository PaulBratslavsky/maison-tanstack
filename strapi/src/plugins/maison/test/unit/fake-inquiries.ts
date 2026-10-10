import { vi } from 'vitest';
import { UID } from '../../server/src/constants';
import inquiries from '../../server/src/services/inquiries';
import { matches } from './fake-filters';
import { fakeStrapi } from './fake-strapi';

/*
 * What the tests of the inquiries service share: the rows it works on, as the database holds them and as staff see them,
 * and the Document Service it reads and writes, as a small table.
 */

export type Doc = Record<string, any>;
export type Language = 'ja' | 'en';
/** A product in one language: published unless `status` says draft. */
export type Piece = { slug: string; name: string; locale: Language; status?: 'published' | 'draft' };

/** The customer as the session gives them: `line:U` and 32 hex characters. */
export const USER_ID = 'U4af49806290a28bb0a53ff1d09a9d588';
export const SUBJECT = `line:${USER_ID}`;
export const ASKED = 'Can the coffret hold a watch?';

export const COFFRET: Piece[] = [
  { slug: 'jewelry-coffret', name: 'ジュエリー・コフレ', locale: 'ja' },
  { slug: 'jewelry-coffret', name: 'Jewelry Coffret', locale: 'en' },
];

/** An inquiry right after the app logged it: in English, answered from knowledge, with nothing labelled yet. */
export const PENDING: Doc = {
  documentId: 'inq-1',
  customer: SUBJECT,
  message: ASKED,
  reply: 'Yes, a watch up to 42 mm fits.',
  language: 'en',
  knowledgeFound: true,
  handedOff: false,
  questionReference: null,
  productSlug: null,
  via: 'concierge',
  kind: null,
  sentimentScore: null,
  sentimentLabel: null,
  answered: null,
  reason: null,
  topic: null,
  analysisStatus: 'pending',
  analysisAttempts: 0,
  modelVersion: null,
  promptVersion: null,
  humanCorrected: false,
  queue: 'none',
  status: 'open',
  closeReason: null,
  replyText: null,
  repliedAt: null,
  repliedBy: null,
  lineOutcome: null,
  lineDetail: null,
  createdAt: '2026-10-03T01:12:00.000Z',
};

/** PENDING as staff see it: the customer masked, and nothing labelled, replied to or sent. */
export const PENDING_VIEW = {
  documentId: 'inq-1',
  createdAt: '2026-10-03T01:12:00.000Z',
  customer: 'line:U4af…88',
  message: ASKED,
  reply: 'Yes, a watch up to 42 mm fits.',
  language: 'en',
  product: null,
  knowledgeFound: true,
  handedOff: false,
  question: null,
  kind: null,
  sentimentScore: null,
  sentimentLabel: null,
  answered: null,
  reason: null,
  topic: null,
  analysisStatus: 'pending',
  analysisAttempts: 0,
  humanCorrected: false,
  queue: 'none',
  status: 'open',
  closeReason: null,
  replyText: null,
  repliedAt: null,
  repliedBy: null,
  line: null,
  yourLine: false,
};

/** The model labelled it a question the concierge did not answer, so it needs an answer. */
export const UNANSWERED: Doc = {
  ...PENDING,
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
  modelVersion: 'claude-haiku-4-5-20251001',
  promptVersion: 'inquiry-labels-1',
  queue: 'needs-answer',
};

/** A hand-off, and Q-4821 is its question. Nobody has labelled it, and it is in Needs an answer anyway. */
export const HANDED_OFF: Doc = { ...PENDING, documentId: 'inq-3', knowledgeFound: false, handedOff: true, questionReference: 'Q-4821', queue: 'needs-answer' };

/** The model labelled it a complaint about a piece. */
export const COMPLAINT: Doc = {
  ...PENDING,
  documentId: 'inq-4',
  message: 'The clasp of my coffret broke after a week.',
  productSlug: 'jewelry-coffret',
  kind: 'complaint',
  sentimentScore: -0.7,
  sentimentLabel: 'negative',
  answered: true,
  reason: 'The customer says a clasp broke.',
  topic: 'repairs',
  analysisStatus: 'analyzed',
  analysisAttempts: 1,
  queue: 'complaint',
};

/** An inquiry as the app logged it, with `fields` over it: one row per case a test tells apart. */
export const row = (documentId: string, fields: Doc = {}): Doc => ({ ...PENDING, documentId, ...fields });

export interface WorldOptions {
  /** The inquiries, as the database holds them. */
  rows?: Doc[];
  pieces?: Piece[];
  /** The questions there are, each with its status. */
  questions?: Array<{ reference: string; status: 'open' | 'taken' | 'answered' }>;
  config?: Record<string, unknown>;
}

/**
 * The Document Service as the inquiries service reads and writes it, as a small table. `findMany` and `count` keep the
 * rows that meet the filters they are given, `findOne` finds a row by its document ID, and `update` writes into the
 * row as the database would, so a second call sees what the first one did. A piece is found only in its own language,
 * and only in the status asked for. Every call is kept, for a test to read what was asked.
 */
export const world = ({ rows = [], pieces = [], questions = [], config = {} }: WorldOptions = {}) => {
  const stored: Doc[] = rows.map((row) => ({ ...row }));
  const findMany = vi.fn(async ({ filters }: Doc) => stored.filter((row) => matches(row, filters)).map((row) => ({ ...row })));
  const count = vi.fn(async ({ filters }: Doc) => stored.filter((row) => matches(row, filters)).length);
  const findOne = vi.fn(async ({ documentId }: Doc) => {
    const found = stored.find((row) => row.documentId === documentId);
    return found ? { ...found } : null;
  });
  const update = vi.fn(async ({ documentId, data }: { documentId: string; data: Doc }) =>
    Object.assign(stored.find((row) => row.documentId === documentId) ?? {}, data)
  );
  const findQuestions = vi.fn(async ({ filters }: Doc) => questions.filter((question) => matches(question, filters)));
  const findPiece = vi.fn(
    async ({ locale, status, filters }: Doc) =>
      pieces.find((piece) => piece.locale === locale && (piece.status ?? 'published') === status && piece.slug === filters?.slug?.$eq) ?? null
  );
  const documents = (uid: string) => {
    if (uid === UID.inquiry) return { findMany, count, findOne, update };
    if (uid === UID.question) return { findMany: findQuestions };
    if (uid === UID.product) return { findFirst: findPiece };
    throw new Error(`These tests have no ${uid}.`);
  };
  const strapi = fakeStrapi({ documents, config });
  return { service: inquiries({ strapi }), strapi, stored, findMany, count, findOne, update, findQuestions, findPiece };
};
