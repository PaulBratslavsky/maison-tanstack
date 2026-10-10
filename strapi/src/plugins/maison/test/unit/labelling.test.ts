import { describe, expect, it, vi } from 'vitest';
import { LABEL_BATCH, UID } from '../../server/src/constants';
import labelling from '../../server/src/services/labelling';
import { matches } from './fake-filters';
import { fakeStrapi } from './fake-strapi';

/*
 * The labelling service so far is a stub: with AI off it marks every pending inquiry skipped, as the original does,
 * and with AI on it does nothing yet. Phase 5 replaces the stub with TanStack AI and ports the tests that call a model.
 */

type Doc = Record<string, any>;

const USER_ID = 'U4af49806290a28bb0a53ff1d09a9d588';
const AI_ON = { aiProvider: 'anthropic', aiApiKey: 'a-test-key' };
const AI_OFF = { aiProvider: 'anthropic', aiApiKey: null };

const minute = (n: number) => `2026-10-03T01:${String(n).padStart(2, '0')}:00.000Z`;

/** An inquiry the app logged, with nothing labelled yet, unless `fields` says otherwise. */
const row = (documentId: string, fields: Doc = {}): Doc => ({
  documentId,
  customer: `line:${USER_ID}`,
  message: `Message of ${documentId}`,
  reply: 'A reply.',
  language: 'en',
  knowledgeFound: true,
  handedOff: false,
  questionReference: null,
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
  createdAt: minute(1),
  ...fields,
});

/**
 * The Document Service as the stub reads and writes it, as a small table. `findMany` keeps the rows that meet the
 * filters, and `update` writes into the row as the database would. Every call is kept, for a test to read what was asked.
 */
const world = ({ rows = [], config = { ...AI_OFF } }: { rows?: Doc[]; config?: Doc } = {}) => {
  const stored: Doc[] = rows.map((candidate) => ({ ...candidate }));
  const findMany = vi.fn(async ({ filters, limit }: Doc) => {
    const found = stored.filter((candidate) => matches(candidate, filters));
    return found.slice(0, limit).map((candidate) => ({ ...candidate }));
  });
  const update = vi.fn(async ({ documentId, data }: { documentId: string; data: Doc }) =>
    Object.assign(stored.find((candidate) => candidate.documentId === documentId) ?? {}, data)
  );
  const documents = (uid: string) => {
    if (uid === UID.inquiry) return { findMany, update };
    throw new Error(`These tests have no ${uid}.`);
  };
  const strapi = fakeStrapi({ documents, config });
  return { service: labelling({ strapi }), strapi, config, stored, findMany, update };
};

describe('labelling.sweep, with AI off', () => {
  const TABLE = [
    row('pending-1', { createdAt: minute(1) }),
    row('pending-2', { createdAt: minute(2) }),
    row('pending-3', { createdAt: minute(3) }),
    row('analyzed', { analysisStatus: 'analyzed', kind: 'praise', createdAt: minute(4) }),
    row('failed', { analysisStatus: 'failed', analysisAttempts: 2, createdAt: minute(5) }),
    row('skipped', { analysisStatus: 'skipped', createdAt: minute(6) }),
  ];

  it.each([
    ['anthropic with no key', AI_OFF],
    ['ollama with neither a key nor a host', { aiProvider: 'ollama', aiApiKey: null, aiBaseUrl: null }],
    ['an empty key, as an empty AI_API_KEY in an env file gives', { aiProvider: 'anthropic', aiApiKey: '' }],
  ])('marks every pending row skipped with %s', async (_what, config) => {
    const { service, stored } = world({ rows: TABLE, config });

    const result = await service.sweep();

    expect(result).toEqual({ labelled: 0, failed: 0, skipped: 3 });
    expect(stored.map((candidate) => [candidate.documentId, candidate.analysisStatus])).toEqual([
      ['pending-1', 'skipped'],
      ['pending-2', 'skipped'],
      ['pending-3', 'skipped'],
      ['analyzed', 'analyzed'],
      ['failed', 'failed'],
      ['skipped', 'skipped'],
    ]);
  });

  it('writes nothing but the status: no label, no queue, no attempts', async () => {
    const { service, update } = world({ rows: [row('pending-1')] });

    await service.sweep();

    expect(update).toHaveBeenCalledExactlyOnceWith({ documentId: 'pending-1', data: { analysisStatus: 'skipped' } });
  });

  it('marks every pending row, however many there are, and not only one batch', async () => {
    const rows = Array.from({ length: LABEL_BATCH * 3 + 1 }, (_, number) => row(`pending-${number}`));
    const { service, stored } = world({ rows });

    expect(await service.sweep()).toEqual({ labelled: 0, failed: 0, skipped: rows.length });
    expect(stored.every((candidate) => candidate.analysisStatus === 'skipped')).toBe(true);
  });

  it('marks a pending row a person labelled too: skipped says only that AI was off', async () => {
    const { service, stored } = world({ rows: [row('pending-1', { humanCorrected: true, kind: 'praise' })] });

    expect(await service.sweep()).toEqual({ labelled: 0, failed: 0, skipped: 1 });
    expect(stored[0]).toMatchObject({ analysisStatus: 'skipped', humanCorrected: true, kind: 'praise' });
  });

  it('says nothing, and answers zero everywhere, when no row is pending', async () => {
    const { service, strapi } = world({ rows: [TABLE[3], TABLE[4], TABLE[5]] });

    expect(await service.sweep()).toEqual({ labelled: 0, failed: 0, skipped: 0 });
    expect(strapi.log.info).not.toHaveBeenCalled();
  });

  it('reads the settings on every sweep, so a key set later is seen without a restart', async () => {
    const { service, config, stored } = world({ rows: [row('pending-1')] });

    await service.sweep();
    expect(stored[0].analysisStatus).toBe('skipped');

    stored.push(row('pending-2', { createdAt: minute(2) }));
    Object.assign(config, AI_ON);
    expect(await service.sweep()).toEqual({ labelled: 0, failed: 0, skipped: 0 });
    expect(stored[1].analysisStatus).toBe('pending');
  });
});

describe('labelling.sweep, with AI on', () => {
  it.each([
    ['a key', AI_ON],
    ['an Ollama host', { aiProvider: 'ollama', aiApiKey: null, aiBaseUrl: 'http://127.0.0.1:11434' }],
  ])('changes no row with %s, and answers zero everywhere', async (_what, config) => {
    const { service, stored, update } = world({ rows: [row('pending-1'), row('failed', { analysisStatus: 'failed' })], config });

    expect(await service.sweep()).toEqual({ labelled: 0, failed: 0, skipped: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(stored.map((candidate) => candidate.analysisStatus)).toEqual(['pending', 'failed']);
  });

  it('logs one line that labelling arrives in phase 5, and only once however many sweeps run', async () => {
    const { service, strapi } = world({ config: AI_ON });

    await service.sweep();
    await service.sweep();
    await service.sweep();

    expect(strapi.log.info).toHaveBeenCalledExactlyOnceWith(
      '[maison] AI is set, but labelling by a model arrives in phase 5. Until then, new inquiries stay pending.'
    );
  });
});

describe('labelling.sweep, overlap', () => {
  it('answers busy, and does nothing, when another sweep is running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service, update, findMany } = world({ rows: [row('inq-1')] });
    update.mockImplementationOnce(async () => {
      await gate;
      return {};
    });

    const first = service.sweep();
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    const second = await service.sweep();

    expect(second).toEqual({ labelled: 0, failed: 0, skipped: 0, busy: true });
    expect(findMany).toHaveBeenCalledOnce();

    release();
    expect(await first).toEqual({ labelled: 0, failed: 0, skipped: 1 });
  });

  it('runs again after a sweep that crashed', async () => {
    const { service, findMany } = world({ rows: [row('inq-1')] });
    findMany.mockRejectedValueOnce(new Error('The database is down.'));

    await expect(service.sweep()).rejects.toThrow('The database is down.');

    expect(await service.sweep()).toEqual({ labelled: 0, failed: 0, skipped: 1 });
  });
});

describe('labelling.sweep, the log', () => {
  it('gives one summary line when it skipped something', async () => {
    const { service, strapi } = world({ rows: [row('inq-1'), row('inq-2')] });

    await service.sweep();

    expect(strapi.log.info).toHaveBeenCalledExactlyOnceWith('[maison] Labelling sweep: 0 labelled, 0 failed, 2 skipped.');
  });

  it('says nothing when it was busy', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service, strapi, update } = world({ rows: [row('inq-1')] });
    update.mockImplementationOnce(async () => {
      await gate;
      return {};
    });
    const first = service.sweep();
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());

    await service.sweep();
    expect(strapi.log.info).not.toHaveBeenCalled();

    release();
    await first;
  });
});
