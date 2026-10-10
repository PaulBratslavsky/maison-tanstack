import { describe, expect, it, vi } from 'vitest';
import { UID } from '../../server/src/constants';
import { staffAppointmentOutput } from '../../server/src/mcp/schemas';
import appointments from '../../server/src/services/appointments';
import questions from '../../server/src/services/questions';
import { COMPLAINT, HANDED_OFF, PENDING, row, world } from './fake-inquiries';
import { fakeStrapi } from './fake-strapi';

/*
 * `yourLine` on what staff see: true for the rows of the presenter's own LINE account (the plugin's demoLineUserId), so
 * the admin can label them, and false for every other customer, the made-up ones included. The ID itself is never in a view.
 */

/** The presenter's own LINE user ID, as demoLineUserId has it, and as a subject. */
const YOU_ID = `U${'5ca1ab1e'.repeat(4)}`;
const YOU = `line:${YOU_ID}`;
/** Another real customer, and one of the five made-up ones. */
const OTHER = `line:U${'a'.repeat(32)}`;
const DEMO = 'line:Udec0de00000000000000000000000003';
const WITH_YOU = { demoLineUserId: YOU_ID };

/** Whether any of the text is the presenter's ID, in full or by its distinctive middle. */
const showsYourId = (value: unknown): boolean => JSON.stringify(value).includes(YOU_ID) || JSON.stringify(value).includes('5ca1ab1e5ca1ab1e');

describe('appointments: yourLine on the board rows and the summary', () => {
  /** Draft appointments newest first: yours, another customer's and a made-up customer's. */
  const draft = (reference: string, customer: string, minute: number) => ({
    documentId: `doc-${reference}`, reference, customer, boutique: { documentId: 'b-ginza' }, products: [],
    requestedFor: '2030-01-19T05:00:00.000Z', customerNote: '', createdVia: 'app', createdAt: `2029-12-31T15:0${minute}:00.000Z`,
  });
  const DRAFTS = [draft('APT-3333', YOU, 3), draft('APT-2222', OTHER, 2), draft('APT-1111', DEMO, 1)];

  const documents = (uid: string) => {
    if (uid === UID.appointment) {
      return {
        count: vi.fn(async () => 3),
        findMany: vi.fn(async (query: { status: string; fields?: string[] }) => (query.status === 'published' || query.fields ? [] : DRAFTS)),
        findFirst: vi.fn(async () => DRAFTS[0]),
        findOne: vi.fn(async () => DRAFTS[0]),
        publish: vi.fn(async () => ({})),
      };
    }
    if (uid === UID.boutique) return { findMany: vi.fn(async () => [{ documentId: 'b-ginza', slug: 'ginza', name: 'Ginza Flagship' }]) };
    return { findMany: vi.fn(async () => []) };
  };
  const serviceWith = (config: Record<string, unknown>) => appointments({ strapi: fakeStrapi({ documents, config }) });

  it('is true on your own request only, and says so in the same row that says demoCustomer', async () => {
    const result = await serviceWith(WITH_YOU).listRequests({ status: 'all' });
    if (result.ok === false) throw new Error(result.message);
    expect(result.value.map((view) => [view.reference, view.customer, view.yourLine, view.demoCustomer])).toEqual([
      ['APT-3333', 'line:U5ca…1e', true, false],
      ['APT-2222', 'line:Uaaa…aa', false, false],
      ['APT-1111', 'line:Udec…03', false, true],
    ]);
  });

  it('is false on every row when demoLineUserId is not set, your own request included', async () => {
    for (const config of [{}, { demoLineUserId: null }, { demoLineUserId: '' }]) {
      const result = await serviceWith(config).listRequests({ status: 'all' });
      if (result.ok === false) throw new Error(result.message);
      expect(result.value.map((view) => view.yourLine), JSON.stringify(config)).toEqual([false, false, false]);
    }
  });

  it('is false on every row when demoLineUserId is not a LINE user ID, as the setting is then ignored', async () => {
    const result = await serviceWith({ demoLineUserId: 'not-a-line-user-id' }).listRequests({ status: 'all' });
    if (result.ok === false) throw new Error(result.message);
    expect(result.value.map((view) => view.yourLine)).toEqual([false, false, false]);
  });

  it("is true in Confirm's answer for your own request, the same as in the list", async () => {
    const result = await serviceWith(WITH_YOU).confirm('APT-3333');
    if (result.ok === false) throw new Error(result.message);
    expect(result.value.appointment).toMatchObject({ reference: 'APT-3333', yourLine: true, demoCustomer: false });
  });

  it("is on the homepage summary's newest rows, with the same value as the board's", async () => {
    const { recent } = await serviceWith(WITH_YOU).summarizeRequests(new Date('2029-12-31T16:00:00Z'));
    expect(recent.map((view) => [view.reference, view.yourLine])).toEqual([
      ['APT-3333', true],
      ['APT-2222', false],
      ['APT-1111', false],
    ]);
    for (const view of recent) expect(Object.keys(view)).toContain('yourLine');
  });

  it('never puts your LINE user ID in a view, a summary or an answer', async () => {
    const service = serviceWith(WITH_YOU);
    const listed = await service.listRequests({ status: 'all' });
    const confirmed = await service.confirm('APT-3333');
    const summary = await service.summarizeRequests(new Date('2029-12-31T16:00:00Z'));
    // The view says it is yours, and still never names the ID.
    expect(JSON.stringify(listed)).toContain('"yourLine":true');
    for (const answer of [listed, confirmed, summary]) {
      expect(showsYourId(answer)).toBe(false);
      expect(JSON.stringify(answer)).not.toMatch(/U[0-9a-f]{32}/);
      expect(JSON.stringify(answer)).not.toContain('demoLineUserId');
    }
  });
});

describe('the MCP output schema of a staff appointment: yourLine', () => {
  const view = {
    reference: 'APT-4821', status: 'requested', customer: 'line:U5ca…1e', boutique: null, requestedFor: '2030-01-12T14:00:00+09:00',
    products: [], note: '', createdVia: 'app', confirmationSent: false, demoCustomer: false, createdAt: '2026-10-01T09:00:00+09:00',
  };

  it.each([true, false])('accepts yourLine %s and keeps it in the answer', (yourLine) => {
    expect(staffAppointmentOutput.parse({ ...view, yourLine }).yourLine).toBe(yourLine);
  });

  it('requires yourLine to be a boolean, like demoCustomer, so a view that lacks it is caught', () => {
    expect(staffAppointmentOutput.safeParse(view).success).toBe(false);
    expect(staffAppointmentOutput.safeParse({ ...view, yourLine: 'yes' }).success).toBe(false);
    expect(staffAppointmentOutput.safeParse({ ...view, yourLine: null }).success).toBe(false);
  });

  it('describes yourLine in plain words, for a person or a model, without any LINE user ID', () => {
    const description = staffAppointmentOutput.shape.yourLine.description ?? '';
    expect(description).toMatch(/own LINE account/i);
    expect(description).not.toMatch(/U[0-9a-f]{32}/);
  });
});

describe('questions: yourLine on the Customer questions rows', () => {
  const asked = (reference: string, customer: string, createdAt: string) => ({
    documentId: `doc-${reference}`, reference, customer, customerName: null, question: 'Can the coffret hold a watch?', reason: 'no_answer',
    language: 'en', productSlug: null, status: 'open', staffName: null, takenAt: null, answeredAt: null, answer: null,
    knowledgeDocumentId: null, lineOutcome: null, lineDetail: null, createdAt,
  });
  const ROWS = [
    asked('Q-3333', YOU, '2026-10-03T03:00:00.000Z'),
    asked('Q-2222', OTHER, '2026-10-03T02:00:00.000Z'),
    asked('Q-1111', DEMO, '2026-10-03T01:00:00.000Z'),
  ];
  const listWith = async (config: Record<string, unknown>) => {
    const documents = () => ({ findMany: vi.fn(async () => ROWS) });
    const result = await questions({ strapi: fakeStrapi({ documents, config }) }).list({ status: 'all' });
    if (result.ok === false) throw new Error(result.message);
    return result.value;
  };

  it('is true on your own question only', async () => {
    const views = await listWith(WITH_YOU);
    expect(views.map((view) => [view.reference, view.customer, view.yourLine])).toEqual([
      ['Q-3333', 'line:U5ca…1e', true],
      ['Q-2222', 'line:Uaaa…aa', false],
      ['Q-1111', 'line:Udec…03', false],
    ]);
  });

  it('is false on every row when demoLineUserId is not set or is not a LINE user ID', async () => {
    for (const config of [{}, { demoLineUserId: null }, { demoLineUserId: 'not-a-line-user-id' }]) {
      expect((await listWith(config)).map((view) => view.yourLine), JSON.stringify(config)).toEqual([false, false, false]);
    }
  });

  it('never puts your LINE user ID in a view', async () => {
    const views = await listWith(WITH_YOU);
    expect(views.some((view) => view.yourLine)).toBe(true);
    expect(showsYourId(views)).toBe(false);
    expect(JSON.stringify(views)).not.toMatch(/U[0-9a-f]{32}/);
  });
});

describe('inquiries: yourLine on the Inquiries rows', () => {
  const rows = [
    row('inq-yours-complaint', { ...COMPLAINT, documentId: 'inq-yours-complaint', customer: YOU }),
    row('inq-yours-handoff', { ...HANDED_OFF, documentId: 'inq-yours-handoff', customer: YOU }),
    row('inq-other', { ...PENDING, documentId: 'inq-other', customer: OTHER }),
    row('inq-demo', { ...PENDING, documentId: 'inq-demo', customer: DEMO }),
  ];
  const listWith = async (config: Record<string, unknown>) => {
    const result = await world({ rows, config }).service.list({ filter: 'all' });
    if (result.ok === false) throw new Error(result.message);
    return result.value;
  };

  it('is true on every row of your own account, the complaint and the hand-off, and false on the rest', async () => {
    const views = await listWith(WITH_YOU);
    expect(views.map((view) => [view.documentId, view.yourLine])).toEqual([
      ['inq-yours-complaint', true],
      ['inq-yours-handoff', true],
      ['inq-other', false],
      ['inq-demo', false],
    ]);
  });

  it('is false on every row when demoLineUserId is not set or is not a LINE user ID', async () => {
    for (const config of [{}, { demoLineUserId: null }, { demoLineUserId: 'not-a-line-user-id' }]) {
      expect((await listWith(config)).map((view) => view.yourLine), JSON.stringify(config)).toEqual([false, false, false, false]);
    }
  });

  it("stays true in the row an action answers with, such as Close's", async () => {
    const { service } = world({ rows, config: WITH_YOU });
    const closed = await service.close('inq-yours-complaint', 'not-needed');
    if (closed.ok === false) throw new Error(closed.message);
    expect(closed.value).toMatchObject({ documentId: 'inq-yours-complaint', status: 'closed', yourLine: true });
    const other = await service.close('inq-other', 'not-needed');
    if (other.ok === false) throw new Error(other.message);
    expect(other.value.yourLine).toBe(false);
  });

  it('never puts your LINE user ID in a view', async () => {
    const views = await listWith(WITH_YOU);
    expect(views.some((view) => view.yourLine)).toBe(true);
    expect(showsYourId(views)).toBe(false);
    expect(JSON.stringify(views)).not.toMatch(/U[0-9a-f]{32}/);
  });
});
