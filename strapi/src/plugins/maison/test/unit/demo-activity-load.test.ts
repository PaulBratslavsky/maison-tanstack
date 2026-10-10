import { afterEach, describe, expect, it, vi } from 'vitest';
import activity from '../../server/seed/activity.json';
import content from '../../server/seed/content.json';
import { UID } from '../../server/src/constants';
import { HAND_OFF_LOGGED_AFTER_MS, hoursBefore } from '../../server/src/domain/demo-activity';
import { zonedParts } from '../../server/src/domain/hours';
import { startDemoActivity } from '../../server/src/services/demo-activity';
import seedService from '../../server/src/services/seed';
import { fakeStrapi } from './fake-strapi';

const SUBJECTS = activity.customers.map((customer) => customer.subject);
const subjectOf = (key: string) => activity.customers.find((customer) => customer.key === key)?.subject;
const STOCK = Object.entries(content.stock).flatMap(([productSlug, perBoutique]) =>
  Object.entries(perBoutique).map(([boutiqueSlug, quantity]) => ({ productSlug, boutiqueSlug, quantity }))
);
// Monday 5 October 2026, 21:00 in Tokyo.
const NOW = new Date('2026-10-05T12:00:00.000Z');

type Counts = Partial<Record<string, number>>;

/**
 * A Strapi with the demo catalog loaded (or `boutiques`, `stock` in its place) and `counts` rows for the demo customers. It
 * records each count, each create, each request and confirmation the appointments service is asked for, and each row whose
 * received time is set. A request answers APT-1001, APT-1002 and so on, or `refuseRequest`'s failure for that one.
 */
const strapiWith = ({
  counts = {},
  boutiques = content.boutiques,
  stock = STOCK,
  refuseRequest,
  config = {},
  openRequests = 0,
  requestGate,
}: {
  counts?: Counts;
  boutiques?: typeof content.boutiques;
  stock?: typeof STOCK;
  refuseRequest?: number;
  /** The maison plugin's config: demoLineUserId, and the LINE token its customer name is asked for with. */
  config?: Record<string, unknown>;
  /** What countOpenRequests answers for your own LINE account. */
  openRequests?: number;
  /** When given, each request waits for it, so a test can see what else runs meanwhile. */
  requestGate?: Promise<void>;
} = {}) => {
  /** Every request, confirm and create, in the order they ran. */
  const events: string[] = [];
  const openRequestsAsked: string[] = [];
  const counted: Array<{ uid: string; params: any }> = [];
  const created: Array<{ uid: string; data: any; documentId: string }> = [];
  const requested: any[] = [];
  const confirmed: string[] = [];
  const received: Array<{ uid: string; where: any; createdAt: Date }> = [];
  const documents = (uid: string) => ({
    count: async (params: any) => {
      counted.push({ uid, params });
      // The demo customers' rows: `counts`, and what this load added. A question reference is free unless a question has it.
      if (!params?.filters?.customer) return 0;
      return (counts[uid] ?? 0) + created.filter((row) => row.uid === uid).length + (uid === UID.appointment ? requested.length : 0);
    },
    findMany: async () => {
      if (uid === UID.boutique) return boutiques.map(({ slug, openingHours }) => ({ slug, openingHours }));
      if (uid === UID.product) return content.products.map(({ slug }) => ({ slug }));
      if (uid === UID.stockLevel) return stock;
      return [];
    },
    create: async ({ data }: { data: any }) => {
      const documentId = `${uid.split('.').pop()}-${created.length + 1}`;
      created.push({ uid, data, documentId });
      events.push(`create ${uid.split('.').pop()}${data.handedOff === false ? ' (standalone)' : ''}`);
      return { documentId };
    },
  });
  const appointments = {
    request: async (input: any) => {
      requested.push(input);
      events.push('request');
      if (requestGate) await requestGate;
      if (requested.length === refuseRequest) return { ok: false, code: 'boutique_closed', message: 'Ginza is not open then.', hint: '' };
      return { ok: true, value: { reference: `APT-${1000 + requested.length}` } };
    },
    countOpenRequests: async (subject: string) => {
      openRequestsAsked.push(subject);
      return openRequests;
    },
    confirm: async (reference: string) => {
      confirmed.push(reference);
      events.push('confirm');
      return { ok: true, value: { appointment: { reference, confirmationSent: false }, alreadyConfirmed: false } };
    },
  };
  const strapi = {
    ...fakeStrapi({ services: { appointments }, documents, config }),
    db: {
      query: (uid: string) => ({
        updateMany: async ({ where, data }: { where: any; data: { createdAt: Date } }) => {
          received.push({ uid, where, createdAt: data.createdAt });
          return { count: 1 };
        },
      }),
    },
  } as any;
  return { strapi, counted, created, requested, confirmed, received, events, openRequestsAsked };
};

const load = (strapi: any) => seedService({ strapi }).loadDemoActivity(NOW);
const NOTHING = { created: false, customers: 0, appointments: 0, confirmed: 0, questions: 0, inquiries: 0 };

describe('loadDemoActivity: when it adds nothing', () => {
  it.each([
    ['an appointment', UID.appointment],
    ['a question', UID.question],
    ['an inquiry', UID.inquiry],
  ])('adds nothing when one of the demo customers has %s already', async (_what, uid) => {
    const { strapi, created, requested, confirmed, received } = strapiWith({ counts: { [uid]: 1 } });
    expect(await load(strapi)).toEqual({ ok: true, value: NOTHING });
    expect([created, requested, confirmed, received]).toEqual([[], [], [], []]);
  });

  it("counts only the five demo customers' rows, so anyone else's activity never stops it", async () => {
    const { strapi, counted } = strapiWith();
    await load(strapi);
    for (const uid of [UID.appointment, UID.question, UID.inquiry]) {
      const reads = counted.filter((call) => call.uid === uid && call.params?.filters?.customer);
      expect(reads, uid).toHaveLength(1);
      expect(reads[0].params.filters).toEqual({ customer: { $in: SUBJECTS } });
    }
  });

  it('answers not_found and adds nothing when the demo catalog is not loaded', async () => {
    const { strapi, created, requested } = strapiWith({ boutiques: [] });
    const result = await load(strapi);
    expect(result).toMatchObject({ ok: false, code: 'not_found' });
    expect((result as { message: string }).message).toMatch(/Load demo catalog/);
    expect([created, requested]).toEqual([[], []]);
  });

  it('answers not_found and adds nothing when a boutique has no piece in stock', async () => {
    const { strapi, created, requested } = strapiWith({ stock: STOCK.filter((level) => level.boutiqueSlug !== 'osaka') });
    const result = await load(strapi);
    expect(result).toMatchObject({ ok: false, code: 'not_found' });
    expect((result as { message: string }).message).toMatch(/osaka/i);
    expect([created, requested]).toEqual([[], []]);
  });

  it('adds it once when pressed twice at the same moment: the second press answers already_loading and starts nothing', async () => {
    const { strapi, requested } = strapiWith();
    const service = seedService({ strapi });
    const [first, second] = await Promise.all([service.loadDemoActivity(NOW), service.loadDemoActivity(NOW)]);
    expect(first).toEqual({ ok: true, value: expect.objectContaining({ created: true }) });
    expect(second).toMatchObject({ ok: false, code: 'already_loading' });
    expect(requested).toHaveLength(5);
  });

  it('stops with a message that says to reset when a request is refused partway', async () => {
    const { strapi } = strapiWith({ refuseRequest: 3 });
    await expect(load(strapi)).rejects.toThrow(/Ginza is not open then\..*Reset demo activity/);
  });
});

describe('loadDemoActivity: what it adds', () => {
  it('answers what it added: five requests, two of them confirmed, five questions and ten inquiries, from five customers', async () => {
    const { strapi } = strapiWith();
    expect(await load(strapi)).toEqual({
      ok: true,
      value: { created: true, customers: 5, appointments: 5, confirmed: 2, questions: 5, inquiries: 10 },
    });
  });

  it("requests each visit through the appointments service, as its customer, in its language, made the seed's way, with its note", async () => {
    const { strapi, requested } = strapiWith();
    await load(strapi);
    expect(requested).toHaveLength(5);
    activity.appointments.forEach((visit, index) => {
      const input = requested[index];
      expect(input).toMatchObject({
        subject: subjectOf(visit.customer),
        boutique: visit.boutique,
        productSlugs: visit.pieces,
        createdVia: visit.createdVia,
        locale: visit.language,
        now: NOW,
      });
      expect(input.note ?? null, visit.customer).toBe(visit.note ?? null);
      const days = (Date.parse(`${zonedParts(new Date(input.requestedFor), 'Asia/Tokyo').isoDate}T00:00:00Z`) - Date.parse('2026-10-05T00:00:00Z')) / 86_400_000;
      expect(days, visit.customer).toBeGreaterThanOrEqual(2);
      expect(days, visit.customer).toBeLessThanOrEqual(13);
    });
  });

  it('confirms the two visits the seed marks confirmed, through the same service as the board', async () => {
    const { strapi, confirmed } = strapiWith();
    await load(strapi);
    const references = activity.appointments.flatMap((visit, index) => (visit.confirmed ? [`APT-${1001 + index}`] : []));
    expect(confirmed).toEqual(references);
  });

  it("records each question as the customer's, named, with a reference from the generator, and as far along as the seed says", async () => {
    const { strapi, created } = strapiWith();
    await load(strapi);
    const questions = created.filter((row) => row.uid === UID.question);
    expect(questions).toHaveLength(5);
    activity.questions.forEach((seed, index) => {
      const { data } = questions[index];
      expect(data.reference).toMatch(/^Q-\d{4}$/);
      expect(data).toMatchObject({
        customer: subjectOf(seed.customer),
        customerName: activity.customers.find((customer) => customer.key === seed.customer)?.name,
        question: seed.question,
        reason: seed.reason,
        language: seed.language,
        productSlug: seed.productSlug ?? null,
        status: seed.status,
      });
      if (seed.status === 'taken') expect(data).toMatchObject({ staffName: seed.staffName, takenAt: hoursBefore(NOW, seed.takenHoursAgo as number) });
      if (seed.status === 'answered') {
        expect(data).toMatchObject({ staffName: seed.staffName, answer: seed.answer, answeredAt: hoursBefore(NOW, seed.answeredHoursAgo as number) });
      }
      // Nothing went out on LINE, so nothing says it did, and an answer that never became knowledge leaves Reset nothing extra.
      expect(data).not.toHaveProperty('lineOutcome');
      expect(data).not.toHaveProperty('knowledgeDocumentId');
    });
  });

  it("logs each question's hand-off as the concierge's turn, linked to the question, in Needs an answer, and replied for the answered one", async () => {
    const { strapi, created } = strapiWith();
    await load(strapi);
    const questions = created.filter((row) => row.uid === UID.question);
    const handOffs = created.filter((row) => row.uid === UID.inquiry && row.data.handedOff);
    expect(handOffs).toHaveLength(5);
    activity.questions.forEach((seed, index) => {
      const { data } = handOffs.find((row) => row.data.questionReference === questions[index].data.reference) ?? { data: {} };
      expect(data).toMatchObject({
        customer: subjectOf(seed.customer),
        message: seed.question,
        reply: seed.handOff.reply,
        language: seed.language,
        knowledgeFound: false,
        handedOff: true,
        questionReference: questions[index].data.reference,
        productSlug: seed.productSlug ?? null,
        via: 'concierge',
        kind: 'question',
        queue: 'needs-answer',
        analysisStatus: 'analyzed',
        modelVersion: 'demo-seed',
        status: seed.status === 'answered' ? 'replied' : 'open',
      });
      expect(data).not.toHaveProperty('promptVersion');
      if (seed.status === 'answered') {
        expect(data).toMatchObject({ replyText: seed.answer, repliedBy: seed.staffName, repliedAt: hoursBefore(NOW, seed.answeredHoursAgo as number) });
        expect(data).not.toHaveProperty('lineOutcome');
      }
    });
  });

  it('logs the five standalone turns, four labelled with their queues and one pending for the sweep', async () => {
    const { strapi, created } = strapiWith();
    await load(strapi);
    const standalone = created.filter((row) => row.uid === UID.inquiry && !row.data.handedOff);
    expect(standalone.map(({ data }) => [data.kind ?? null, data.queue, data.analysisStatus])).toEqual(
      activity.inquiries.map((seed) =>
        seed.labels === null
          ? [null, 'none', 'pending']
          : [seed.labels.kind, { complaint: 'complaint', praise: 'praise', question: 'none' }[seed.labels.kind as string], 'analyzed']
      )
    );
    for (const { data } of standalone) expect(data).toMatchObject({ via: 'concierge', handedOff: false, status: 'open' });
  });

  it('sets when each row came in from its hoursAgo, every row of a confirmed visit by its reference, and a hand-off 15 seconds after its question', async () => {
    const { strapi, created, received } = strapiWith();
    await load(strapi);
    const at = (uid: string, where: any) => received.find((row) => row.uid === uid && JSON.stringify(row.where) === JSON.stringify(where))?.createdAt;

    activity.appointments.forEach((visit, index) => {
      expect(at(UID.appointment, { reference: `APT-${1001 + index}` }), visit.customer).toEqual(hoursBefore(NOW, visit.hoursAgo));
    });
    const questions = created.filter((row) => row.uid === UID.question);
    const inquiries = created.filter((row) => row.uid === UID.inquiry);
    const handOffOf = (reference: string) => inquiries.find((row) => row.data.questionReference === reference);
    const standalone = inquiries.filter((row) => !row.data.handedOff);
    activity.questions.forEach((seed, index) => {
      const asked = hoursBefore(NOW, seed.hoursAgo);
      expect(at(UID.question, { documentId: questions[index].documentId })).toEqual(asked);
      expect(at(UID.inquiry, { documentId: handOffOf(questions[index].data.reference)?.documentId })).toEqual(
        new Date(asked.getTime() + HAND_OFF_LOGGED_AFTER_MS)
      );
    });
    activity.inquiries.forEach((seed, index) => {
      expect(at(UID.inquiry, { documentId: standalone[index].documentId })).toEqual(hoursBefore(NOW, seed.hoursAgo));
    });
    expect(received).toHaveLength(20);
  });
});

describe('startDemoActivity: Load demo activity answers at once', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A promise and the function that settles it, so a test decides when a request may go on. */
  const gate = () => {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => (open = resolve));
    return { promise, open };
  };

  it('answers started, with the counts it will add, before the writes are done, and finishes them in the background', async () => {
    const wait = gate();
    const { strapi, requested } = strapiWith({ requestGate: wait.promise });

    const started = await startDemoActivity(strapi, NOW);

    expect(started).toMatchObject({ ok: true, value: { started: true, counts: { appointments: 5, questions: 5, inquiries: 10 } } });
    expect(requested).toHaveLength(1); // the first request is waiting
    wait.open();
    expect(await (started as any).value.done).toEqual({ created: true, customers: 5, appointments: 5, confirmed: 2, questions: 5, inquiries: 10 });
    expect(requested).toHaveLength(5);
    expect(strapi.log.info).toHaveBeenCalledWith(expect.stringMatching(/^\[maison\] Loaded demo activity: /));
  });

  it('answers already_loading to a press while a load is running, and starts nothing', async () => {
    const wait = gate();
    const { strapi, requested, created } = strapiWith({ requestGate: wait.promise });
    const first = await startDemoActivity(strapi, NOW);

    const second = await startDemoActivity(strapi, NOW);

    expect(second).toMatchObject({ ok: false, code: 'already_loading' });
    expect((second as { message: string }).message).toBe('Demo activity is still loading from the last press: the lists fill in over the next few seconds.');
    wait.open();
    await (first as any).value.done;
    expect(requested).toHaveLength(5);
    expect(created.filter((row) => row.uid === UID.question)).toHaveLength(5);
  });

  it('lets the next press load once the last one ended, whether it finished or failed', async () => {
    const failing = strapiWith({ refuseRequest: 1 });
    const failed = await startDemoActivity(failing.strapi, NOW);
    await expect((failed as any).value.done).rejects.toThrow(/Reset demo activity/);
    const next = await startDemoActivity(strapiWith().strapi, NOW);
    expect(next).toMatchObject({ ok: true, value: { started: true } });
    await (next as any).value.done;
  });

  it('runs the planning first, so an error such as "load the catalog first" still comes back on the press', async () => {
    const { strapi, requested } = strapiWith({ boutiques: [] });
    expect(await startDemoActivity(strapi, NOW)).toMatchObject({ ok: false, code: 'not_found' });
    expect(requested).toEqual([]);
    // The flag is clear again: the next press plans afresh.
    expect(await startDemoActivity(strapiWith({ counts: { [UID.question]: 1 } }).strapi, NOW)).toEqual({
      ok: true,
      value: { started: false, result: { created: false, customers: 0, appointments: 0, confirmed: 0, questions: 0, inquiries: 0 } },
    });
  });

  it('logs a failure in the background as an error that says to reset, and never lets it escape', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { strapi } = strapiWith({ refuseRequest: 2 });
      const started = await startDemoActivity(strapi, NOW);
      await (started as any).value.done.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(strapi.log.error).toHaveBeenCalledWith(
        '[maison] Loading the demo activity stopped partway: Ginza is not open then. Press Reset demo activity, then Load demo activity again.'
      );
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('runs the visits, the questions and the standalone inquiries at the same time, each in its own order', async () => {
    const wait = gate();
    const { strapi, events } = strapiWith({ requestGate: wait.promise });
    const started = await startDemoActivity(strapi, NOW);
    // While the first visit waits, the other two chains have written.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events.filter((event) => event === 'request')).toHaveLength(1);
    expect(events.filter((event) => event === 'create question').length).toBeGreaterThan(0);
    expect(events.filter((event) => event === 'create inquiry (standalone)').length).toBeGreaterThan(0);
    wait.open();
    await (started as any).value.done;
    // Each question is followed by its hand-off before the next question.
    const chain = events.filter((event) => event === 'create question' || event === 'create inquiry');
    expect(chain).toEqual(Array.from({ length: 5 }, () => ['create question', 'create inquiry']).flat());
  });
});

describe('loadDemoActivity: the items for your own LINE account (demoLineUserId)', () => {
  const USER_ID = `U${'0123456789abcdef'.repeat(2)}`;
  const YOU = `line:${USER_ID}`;
  const TOKEN = 'test-channel-token';
  const LINE_API = 'http://127.0.0.1:4010';
  const mine = <T extends { owner?: string }>(items: T[]) => items.flatMap((item, index) => (item.owner === 'you' ? [index] : []));

  /** LINE's Get profile answers with this display name. */
  const profileAnswers = (displayName: string) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ displayName }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('gives you one waiting request, one open question and one complaint, and the made-up customers the rest', async () => {
    profileAnswers('Paul B.');
    const { strapi, requested, created, openRequestsAsked } = strapiWith({
      config: { demoLineUserId: USER_ID, lineChannelAccessToken: TOKEN, lineApiBaseUrl: LINE_API },
    });
    await load(strapi);

    const [visit] = mine(activity.appointments);
    expect(requested.map((input) => input.subject)).toEqual(
      activity.appointments.map((seed, index) => (index === visit ? YOU : subjectOf(seed.customer)))
    );
    expect(openRequestsAsked).toEqual([YOU]);

    const questions = created.filter((row) => row.uid === UID.question);
    const [question] = mine(activity.questions);
    expect(questions.map((row) => row.data.customer)).toEqual(
      activity.questions.map((seed, index) => (index === question ? YOU : subjectOf(seed.customer)))
    );
    expect(questions[question].data).toMatchObject({ status: 'open', reason: 'no_answer', customerName: 'Paul B.' });

    const handOff = created.find((row) => row.uid === UID.inquiry && row.data.questionReference === questions[question].data.reference);
    expect(handOff?.data.customer).toBe(YOU);

    const standalone = created.filter((row) => row.uid === UID.inquiry && !row.data.handedOff);
    const [complaint] = mine(activity.inquiries);
    expect(standalone.map((row) => row.data.customer)).toEqual(
      activity.inquiries.map((seed, index) => (index === complaint ? YOU : subjectOf(seed.customer)))
    );
    expect(standalone[complaint].data).toMatchObject({ kind: 'complaint', status: 'open' });
  });

  it("asks LINE for your display name with the channel's token, and never logs your user ID", async () => {
    const fetchMock = profileAnswers('Paul B.');
    const { strapi } = strapiWith({ config: { demoLineUserId: USER_ID, lineChannelAccessToken: TOKEN, lineApiBaseUrl: LINE_API } });
    await load(strapi);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(`${LINE_API}/v2/bot/profile/${USER_ID}`);
    const logged = JSON.stringify([strapi.log.info.mock.calls, strapi.log.warn.mock.calls, strapi.log.error.mock.calls]);
    expect(logged).not.toContain(USER_ID.slice(1));
  });

  it("names your question null without a token, and asks LINE nothing", async () => {
    const fetchMock = profileAnswers('Paul B.');
    const { strapi, created } = strapiWith({ config: { demoLineUserId: USER_ID } });
    await load(strapi);
    expect(fetchMock).not.toHaveBeenCalled();
    const yours = created.find((row) => row.uid === UID.question && row.data.customer === YOU);
    expect(yours?.data.customerName).toBeNull();
  });

  it("leaves your request with its made-up customer, and says so in the log, when you have 3 open requests already", async () => {
    const { strapi, requested, created } = strapiWith({ config: { demoLineUserId: USER_ID }, openRequests: 3 });
    await load(strapi);
    expect(requested.map((input) => input.subject)).toEqual(activity.appointments.map((seed) => subjectOf(seed.customer)));
    expect(strapi.log.warn).toHaveBeenCalledWith(
      '[maison] Your demo LINE account (MAISON_DEMO_LINE_USER_ID) already has 3 open requests, so its request went to a made-up customer.'
    );
    // Your question and your complaint are still yours.
    expect(created.filter((row) => row.data.customer === YOU && !row.data.handedOff).map((row) => row.uid).sort()).toEqual([UID.inquiry, UID.question].sort());
  });

  it("gives nothing to anyone but the five made-up customers when it isn't set, and asks nothing about open requests", async () => {
    const { strapi, requested, created, openRequestsAsked } = strapiWith();
    await load(strapi);
    for (const subject of [...requested.map((input) => input.subject), ...created.map((row) => row.data.customer)]) {
      expect(SUBJECTS).toContain(subject);
    }
    expect(openRequestsAsked).toEqual([]);
  });

  it("checks only the five made-up customers' rows, so your own activity never blocks a load", async () => {
    const { strapi, counted } = strapiWith({ config: { demoLineUserId: USER_ID } });
    await load(strapi);
    for (const call of counted.filter((entry) => entry.params?.filters?.customer)) {
      expect(call.params.filters).toEqual({ customer: { $in: SUBJECTS } });
    }
  });

  it('adds your items only in the same load as the made-up set: nothing when that set is there already', async () => {
    const { strapi, requested, created } = strapiWith({ config: { demoLineUserId: USER_ID }, counts: { [UID.inquiry]: 1 } });
    expect(await load(strapi)).toEqual({ ok: true, value: NOTHING });
    expect([requested, created]).toEqual([[], []]);
  });
});
