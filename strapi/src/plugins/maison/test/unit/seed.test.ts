import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import content from '../../server/seed/content.json';
import knowledge from '../../server/seed/knowledge.json';
import seedService, { imageMimeType } from '../../server/src/services/seed';

// The service finds its images from the bundled dist/ layout, so from the source tree they aren't there.
// Stand in for the file system: these tests only look at what gets uploaded.
vi.mock('node:fs/promises', () => ({ stat: async () => ({ size: 1024 }) }));

describe('imageMimeType', () => {
  it('maps each supported extension to its image type', () => {
    expect(imageMimeType('product-weekender-50.jpg')).toBe('image/jpeg');
    expect(imageMimeType('collection-voyage.jpeg')).toBe('image/jpeg');
    expect(imageMimeType('boutique-ginza.png')).toBe('image/png');
    expect(imageMimeType('boutique-osaka.webp')).toBe('image/webp');
  });

  it('ignores the case of the extension', () => {
    expect(imageMimeType('IMG_0042.JPG')).toBe('image/jpeg');
    expect(imageMimeType('logo.Png')).toBe('image/png');
  });

  it('goes by the last extension only', () => {
    expect(imageMimeType('photo.png.jpg')).toBe('image/jpeg');
  });

  it('throws a clear error for any other extension, naming the file and what is allowed', () => {
    for (const fileName of ['notes.txt', 'photo.gif', 'photo.jpg.bak', 'no-extension']) {
      expect(() => imageMimeType(fileName)).toThrow(`Unsupported seed image "${fileName}"`);
    }
    expect(() => imageMimeType('photo.gif')).toThrow('.jpg, .jpeg, .png, .webp');
  });
});

describe('loadDemoCatalog', () => {
  it('uploads every catalog image with the type of its file extension', async () => {
    const upload = vi.fn(async (_args: { files: { originalFilename: string; mimetype: string } }) => [{ id: 1 }]);
    const documents = {
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => 0,
      create: async () => ({ documentId: 'doc' }),
      update: async () => ({}),
      publish: async () => ({}),
    };
    const strapi = {
      plugin: (id: string) => ({
        service: () => (id === 'upload' ? { upload } : { findByCode: async () => ({}), create: async () => ({}) }),
      }),
      documents: () => documents,
    } as any;

    await seedService({ strapi }).loadDemoCatalog();

    const uploaded = upload.mock.calls.map(([{ files }]) => [files.originalFilename, files.mimetype]);
    expect(uploaded).toHaveLength(content.boutiques.length + content.collections.length + content.products.length);

    // The expected types are spelled out here, not taken from imageMimeType, so a wrong mapping can't agree with itself.
    const typeOf: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    for (const [fileName, mimetype] of uploaded) expect(mimetype, fileName).toBe(typeOf[path.extname(fileName)]);
  });
});

describe('loadDemoCatalog and the product knowledge', () => {
  const KNOWLEDGE = 'plugin::maison.knowledge';
  const QUESTION = 'plugin::maison.question';
  const seed = knowledge.entries;

  /** A seed entry's English fields, spelled out here rather than taken from the code under test. */
  const english = ({ category, productSlugs, title, answer, keywords }: (typeof seed)[number]) => ({ category, productSlugs, title, answer, keywords });

  /** A seed entry's Japanese version, as the seed file has it. Read loosely so that a seed without one fails at run time. */
  const japanese = (entry: (typeof seed)[number]) => (entry as { ja?: unknown }).ja;

  /** A knowledge document's versions, by locale. */
  type Versions = Record<string, Record<string, unknown>>;
  type Call = { uid: string; method: string; params: any };

  /** The sixteen seed entries in English only, as Strapi Cloud has them: k1 to k16, in the seed's order. */
  const englishOnly = (): Record<string, Versions> => Object.fromEntries(seed.map((entry, index) => [`k${index + 1}`, { en: english(entry) }]));

  /**
   * A Strapi whose catalog is there, holding these knowledge documents, and questions whose answers created the entries
   * in `answers`. A read answers as Strapi does for the filters the loader may use, a title or a documentId in a list
   * (and a question's knowledgeDocumentId), and throws for any other, so a read the fake can't answer fails the test.
   * It records every knowledge and question call in order, and each create answers a documentId of its own.
   */
  const strapiHolding = (held: Record<string, Versions> = {}, answers: string[] = []) => {
    const store = new Map(Object.entries(held).map(([documentId, versions]) => [documentId, { ...versions }]));
    const calls: Call[] = [];
    let created = 0;
    const listed = (condition: any, field: string): unknown[] => {
      if (!Array.isArray(condition?.$in) || Object.keys(condition).length !== 1) {
        throw new Error(`The fake can't filter ${field} by ${JSON.stringify(condition)}.`);
      }
      return condition.$in;
    };
    const matches = (documentId: string, version: Record<string, unknown>, filters: Record<string, unknown> = {}) =>
      Object.entries(filters).every(([field, condition]) => {
        if (field === 'documentId') return listed(condition, field).includes(documentId);
        if (field === 'title') return listed(condition, field).includes(version.title);
        throw new Error(`The fake can't filter knowledge by ${field}.`);
      });
    const documents = (uid: string) => ({
      findFirst: async () => ({ documentId: 'the-catalog' }),
      count: async (params: any) => {
        calls.push({ uid, method: 'count', params });
        return [...store.values()].filter((versions) => params.locale in versions).length;
      },
      findMany: async (params: any) => {
        calls.push({ uid, method: 'findMany', params });
        if (uid === QUESTION) {
          const wanted = listed(params.filters?.knowledgeDocumentId, 'knowledgeDocumentId');
          return answers.filter((documentId) => wanted.includes(documentId)).map((knowledgeDocumentId) => ({ knowledgeDocumentId }));
        }
        return [...store.entries()]
          .filter(([documentId, versions]) => params.locale in versions && matches(documentId, versions[params.locale], params.filters))
          .map(([documentId, versions]) => ({ documentId, title: versions[params.locale].title }));
      },
      create: async (params: any) => {
        calls.push({ uid, method: 'create', params });
        created += 1;
        const documentId = `doc-${created}`;
        store.set(documentId, { [params.locale]: params.data });
        return { documentId };
      },
      update: async (params: any) => {
        calls.push({ uid, method: 'update', params });
        const versions = store.get(params.documentId);
        if (!versions) throw new Error(`No document ${params.documentId}.`);
        versions[params.locale] = { ...versions[params.locale], ...params.data };
        return {};
      },
      publish: async (params: any) => {
        calls.push({ uid, method: 'publish', params });
        return {};
      },
    });
    const strapi = {
      plugin: (id: string) => ({
        service: () => (id === 'upload' ? { upload: async () => [{ id: 1 }] } : { findByCode: async () => ({}), create: async () => ({}) }),
      }),
      documents,
    } as any;
    return { strapi, calls, store };
  };

  /** What the loader wrote to knowledge: each create, update and publish, with its arguments. */
  const writes = (calls: Call[]) =>
    calls.filter(({ uid, method }) => uid === KNOWLEDGE && ['create', 'update', 'publish'].includes(method)).map(({ method, params }) => [method, params]);

  const catalogThere = { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0 };

  /**
   * The Japanese versions were written as they should be: one update with the seed's ja fields and then one publish in ja
   * for each document, in no other order, and nothing else.
   */
  const expectJapaneseWrites = (written: Array<[string, any]>, expected: Array<{ documentId: string; data: unknown }>) => {
    expect(written).toHaveLength(expected.length * 2);
    for (const { documentId, data } of expected) {
      const own = written.filter(([, params]) => params.documentId === documentId);
      expect(own, documentId).toEqual([
        ['update', { documentId, locale: 'ja', data }],
        ['publish', { documentId, locale: 'ja' }],
      ]);
    }
  };

  it('adds the product knowledge in English and in Japanese to a Strapi without it, and publishes both versions', async () => {
    const { strapi, calls } = strapiHolding();
    expect(await seedService({ strapi }).loadDemoCatalog()).toEqual({ ...catalogThere, knowledge: 16, knowledgeJa: 16 });
    const written = writes(calls);
    // Each entry in English, with its English fields only, published, one after another.
    expect(written.slice(0, 32)).toEqual(
      seed.flatMap((entry, index) => [
        ['create', { locale: 'en', data: english(entry) }],
        ['publish', { documentId: `doc-${index + 1}`, locale: 'en' }],
      ])
    );
    // Then each English document's Japanese version, with the seed's ja fields only, published in ja: a few at a time.
    expectJapaneseWrites(
      written.slice(32),
      seed.map((entry, index) => ({ documentId: `doc-${index + 1}`, data: japanese(entry) }))
    );
  });

  it('adds only the Japanese versions to a Strapi that has the English entries, as Strapi Cloud has them, and leaves the English ones as they are', async () => {
    const held = englishOnly();
    const { strapi, calls, store } = strapiHolding(held);
    expect(await seedService({ strapi }).loadDemoCatalog()).toEqual({ ...catalogThere, knowledge: 0, knowledgeJa: 16 });
    expect(calls.find(({ uid }) => uid === KNOWLEDGE)).toEqual({ uid: KNOWLEDGE, method: 'count', params: { locale: 'en' } });
    expectJapaneseWrites(
      writes(calls),
      seed.map((entry, index) => ({ documentId: `k${index + 1}`, data: japanese(entry) }))
    );
    for (const [documentId, versions] of Object.entries(held)) expect(store.get(documentId)?.en, documentId).toEqual(versions.en);
  });

  it('adds nothing the second time, in either language', async () => {
    const { strapi, calls } = strapiHolding();
    await seedService({ strapi }).loadDemoCatalog();
    const before = writes(calls).length;
    expect(await seedService({ strapi }).loadDemoCatalog()).toEqual({ ...catalogThere, knowledge: 0, knowledgeJa: 0 });
    expect(writes(calls)).toHaveLength(before);
  });

  it('skips an entry whose English title staff changed, without an error, and adds the others', async () => {
    const held = englishOnly();
    held.k1.en = { ...held.k1.en, title: 'Leather care' };
    const { strapi, calls, store } = strapiHolding(held);
    expect((await seedService({ strapi }).loadDemoCatalog()).knowledgeJa).toBe(15);
    expect(writes(calls).filter(([, params]) => params.documentId === 'k1')).toEqual([]);
    expect(store.get('k1')).not.toHaveProperty('ja');
  });

  it('never touches an entry that a staff answer created, even one with a seed title', async () => {
    const answer = { title: 'Do you gift wrap?', answer: 'Yes, in a Maison box.', category: 'gifting', productSlugs: [], keywords: '' };
    const gift = `k${seed.findIndex((entry) => entry.title === 'Do you gift wrap?') + 1}`;

    // Read first, before the seeded entry with the same title.
    const both = strapiHolding({ 'answer-1': { en: answer }, ...englishOnly() }, ['answer-1']);
    expect((await seedService({ strapi: both.strapi }).loadDemoCatalog()).knowledgeJa).toBe(16);
    expect(writes(both.calls).filter(([, params]) => params.documentId === 'answer-1')).toEqual([]);
    expect(writes(both.calls)).toContainEqual(['update', expect.objectContaining({ documentId: gift, locale: 'ja' })]);

    // And when the seeded one is gone, the answer's entry still isn't taken for it.
    const { [gift]: _gone, ...withoutSeeded } = englishOnly();
    const alone = strapiHolding({ 'answer-1': { en: answer }, ...withoutSeeded }, ['answer-1']);
    expect((await seedService({ strapi: alone.strapi }).loadDemoCatalog()).knowledgeJa).toBe(15);
    expect(writes(alone.calls).filter(([, params]) => params.documentId === 'answer-1')).toEqual([]);
  });

  it('reads only the English documents with a seed title, the Japanese versions of those, and the questions that name them', async () => {
    const { strapi, calls } = strapiHolding(englishOnly());
    await seedService({ strapi }).loadDemoCatalog();
    const reads = calls.filter(({ method }) => method === 'findMany');
    const ids = seed.map((_entry, index) => `k${index + 1}`);
    expect(reads).toHaveLength(3);
    expect(reads[0]).toMatchObject({ uid: KNOWLEDGE, params: { locale: 'en', filters: { title: { $in: seed.map((entry) => entry.title) } } } });
    expect(reads[1].uid).toBe(KNOWLEDGE);
    expect(reads[1].params.locale).toBe('ja');
    expect([...reads[1].params.filters.documentId.$in].sort()).toEqual([...ids].sort());
    expect(reads[2].uid).toBe(QUESTION);
    expect([...reads[2].params.filters.knowledgeDocumentId.$in].sort()).toEqual([...ids].sort());
  });
});

describe('loadDemoCatalog: the Japanese versions, a few at a time', () => {
  it('writes at most 4 entries at once, and starts each publish after its own update', async () => {
    const english = knowledge.entries.map((entry, index) => ({ documentId: `k${index + 1}`, title: entry.title }));
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const slow = async (label: string) => {
      order.push(label);
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      return {};
    };
    const documents = (uid: string) => ({
      findFirst: async () => ({ documentId: 'the-catalog' }),
      count: async () => 16,
      findMany: async (params: any) => (uid === 'plugin::maison.knowledge' && params.locale === 'en' ? english : []),
      update: async ({ documentId }: { documentId: string }) => slow(`update ${documentId}`),
      publish: async ({ documentId }: { documentId: string }) => slow(`publish ${documentId}`),
    });
    const strapi = {
      plugin: () => ({ service: () => ({ findByCode: async () => ({}), create: async () => ({}) }) }),
      documents,
    } as any;

    expect((await seedService({ strapi }).loadDemoCatalog()).knowledgeJa).toBe(16);

    // Each entry's update and publish run in turn, so 4 entries at once are at most 4 writes at once.
    expect(most).toBe(4);
    for (const { documentId } of english) {
      expect(order.indexOf(`update ${documentId}`), documentId).toBeLessThan(order.indexOf(`publish ${documentId}`));
    }
  });
});

describe('startDemoCatalog: Load demo catalog answers at once', () => {
  const NOTHING = { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 0, knowledgeJa: 0 };

  /** A Strapi with the catalog there, whose English entries are k1 to k16, with Japanese versions for `translated` of them. */
  const strapiWith = ({ translated = 16, gate }: { translated?: number; gate?: Promise<void> } = {}) => {
    const english = knowledge.entries.map((entry, index) => ({ documentId: `k${index + 1}`, title: entry.title }));
    const japanese = english.slice(0, translated).map(({ documentId }) => ({ documentId }));
    const written: string[] = [];
    const documents = (uid: string) => ({
      findFirst: async () => ({ documentId: 'the-catalog' }),
      count: async () => 16,
      findMany: async (params: any) => {
        if (uid !== 'plugin::maison.knowledge') return [];
        return params.locale === 'en' ? english : japanese;
      },
      update: async ({ documentId }: { documentId: string }) => {
        if (gate) await gate;
        written.push(`update ${documentId}`);
        return {};
      },
      publish: async ({ documentId }: { documentId: string }) => {
        written.push(`publish ${documentId}`);
        return {};
      },
    });
    const strapi = {
      plugin: () => ({ service: () => ({ findByCode: async () => ({}), create: async () => ({}) }) }),
      documents,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any;
    return { strapi, written, service: seedService({ strapi }) };
  };

  it('answers 200 at once, with nothing added, when the catalog and every Japanese version are there', async () => {
    const { service, written } = strapiWith();
    expect(await service.startDemoCatalog()).toEqual({ ok: true, value: { started: false, result: NOTHING } });
    expect(written).toEqual([]);
  });

  it('answers started, with what it will add, and adds it in the background', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { service, written, strapi } = strapiWith({ translated: 13, gate });

    const started = await service.startDemoCatalog();

    expect(started).toMatchObject({
      ok: true,
      value: { started: true, counts: { collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 0, knowledgeJa: 3 } },
    });
    expect(written).toEqual([]);
    open();
    expect(await (started as any).value.done).toEqual({ ...NOTHING, knowledgeJa: 3 });
    expect(written.filter((write) => write.startsWith('publish'))).toHaveLength(3);
    expect(strapi.log.info).toHaveBeenCalledWith(expect.stringMatching(/^\[maison\] Loaded the demo catalog: /));
  });

  it('answers already_loading to a press while it loads, and starts nothing', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { service, written } = strapiWith({ translated: 0, gate });
    const first = await service.startDemoCatalog();

    expect(await service.startDemoCatalog()).toMatchObject({ ok: false, code: 'already_loading' });

    open();
    await (first as any).value.done;
    expect(written.filter((write) => write.startsWith('publish'))).toHaveLength(16);
    // Once it ended, the next press may load again. This fake never keeps what was written, so it finds the same work.
    const next = await service.startDemoCatalog();
    expect(next).toMatchObject({ ok: true, value: { started: true } });
    await (next as any).value.done;
  });

  it('logs a failure in the background as an error, and lets the next press load', async () => {
    const { strapi, service } = strapiWith({ translated: 15 });
    const documents = strapi.documents;
    strapi.documents = (uid: string) => ({ ...documents(uid), publish: async () => Promise.reject(new Error('database is locked')) });
    const started = await service.startDemoCatalog();
    await expect((started as any).value.done).rejects.toThrow('database is locked');
    expect(strapi.log.error).toHaveBeenCalledWith(
      '[maison] Loading the demo catalog stopped partway: database is locked. Press Load demo catalog again: it adds only what is missing.'
    );
    strapi.documents = documents;
    const next = await service.startDemoCatalog();
    expect(next).toMatchObject({ ok: true, value: { started: true } });
    await (next as any).value.done;
  });
});

describe('resetDemoAppointments', () => {
  const KNOWLEDGE = 'plugin::maison.knowledge';
  const QUESTION = 'plugin::maison.question';
  const INQUIRY = 'plugin::maison.inquiry';
  const NOTIFICATION = 'plugin::maison.notification';
  const APPOINTMENT = 'plugin::maison.appointment';

  /** `returned` is how many rows a findMany answered. */
  type Call = { uid: string; method: 'findMany' | 'delete'; params: any; returned?: number };

  /**
   * A Strapi holding these rows, by content type, as a database does: a read answers up to the `limit` it is given of the
   * rows still there, and a delete takes its document out. It records every findMany and delete with its arguments, in
   * order. A delete of a document in `failing` throws, as one Strapi couldn't finish would, and a delete of one in
   * `stuck` answers as if it worked and leaves the document there. A content type read more than 100 times throws: a
   * reset that never stops would otherwise run the test out of memory, which is a crash, not a failure that says why.
   */
  const strapiHolding = (
    rows: Record<string, Array<Record<string, unknown>>>,
    { failing = [], stuck = [] }: { failing?: string[]; stuck?: string[] } = {}
  ) => {
    const calls: Call[] = [];
    const gone = new Set<string>();
    const reads = new Map<string, number>();
    const documents = (uid: string) => ({
      findMany: async (params: { limit?: number }) => {
        const read = (reads.get(uid) ?? 0) + 1;
        reads.set(uid, read);
        if (read > 100) throw new Error(`${uid} was read ${read} times, and the reset is still going.`);
        const left = (rows[uid] ?? []).filter((row) => !gone.has(`${uid}/${row.documentId}`));
        const answered = left.slice(0, params?.limit ?? left.length);
        calls.push({ uid, method: 'findMany', params, returned: answered.length });
        return answered;
      },
      delete: async (params: { documentId: string }) => {
        calls.push({ uid, method: 'delete', params });
        if (failing.includes(params.documentId)) throw new Error(`could not delete ${params.documentId}`);
        if (!stuck.includes(params.documentId)) gone.add(`${uid}/${params.documentId}`);
        return { documentId: params.documentId, entries: [] };
      },
    });
    return { strapi: { documents } as any, calls };
  };

  /**
   * Three appointments and two notifications. Of three questions, two have answers that became knowledge entries. Three
   * inquiries, whatever became of them: one is open, one was replied to and one was closed.
   */
  const REHEARSAL = {
    [APPOINTMENT]: [{ documentId: 'a1' }, { documentId: 'a2' }, { documentId: 'a3' }],
    [NOTIFICATION]: [{ documentId: 'n1' }, { documentId: 'n2' }],
    [QUESTION]: [
      { documentId: 'q1', knowledgeDocumentId: 'k1' },
      { documentId: 'q2', knowledgeDocumentId: 'k2' },
      // Still open, or answered with Add to product knowledge unticked.
      { documentId: 'q3', knowledgeDocumentId: null },
    ],
    [INQUIRY]: [{ documentId: 'i1' }, { documentId: 'i2' }, { documentId: 'i3' }],
  };

  const deletions = (calls: Call[]) => calls.filter(({ method }) => method === 'delete').map(({ uid, params }) => [uid, params]);

  it('answers what it deleted: appointments, notifications, questions, inquiries, and the knowledge entries the answers added', async () => {
    const { strapi } = strapiHolding(REHEARSAL);
    expect(await seedService({ strapi }).resetDemoAppointments()).toEqual({
      appointments: 3,
      notifications: 2,
      questions: 3,
      inquiries: 3,
      knowledge: 2,
    });
  });

  it('deletes the knowledge entries in every language first, then the questions and the inquiries, then the notifications and appointments', async () => {
    const { strapi, calls } = strapiHolding(REHEARSAL);
    await seedService({ strapi }).resetDemoAppointments();
    expect(deletions(calls)).toEqual([
      [KNOWLEDGE, { documentId: 'k1', locale: '*' }],
      [KNOWLEDGE, { documentId: 'k2', locale: '*' }],
      [QUESTION, { documentId: 'q1' }],
      [QUESTION, { documentId: 'q2' }],
      [QUESTION, { documentId: 'q3' }],
      [INQUIRY, { documentId: 'i1' }],
      [INQUIRY, { documentId: 'i2' }],
      [INQUIRY, { documentId: 'i3' }],
      [NOTIFICATION, { documentId: 'n1' }],
      [NOTIFICATION, { documentId: 'n2' }],
      [APPOINTMENT, { documentId: 'a1' }],
      [APPOINTMENT, { documentId: 'a2' }],
      [APPOINTMENT, { documentId: 'a3' }],
    ]);
  });

  it('deletes every inquiry, whether it is open, replied to or closed: it reads them with no filter, as many as the other content types', async () => {
    const { strapi, calls } = strapiHolding(REHEARSAL);
    await seedService({ strapi }).resetDemoAppointments();
    const read = calls.find(({ uid, method }) => uid === INQUIRY && method === 'findMany');
    expect(read?.params).toEqual({ fields: ['documentId'], limit: 5000 });
    expect(read?.params).not.toHaveProperty('filters');
  });

  it("asks Strapi for each question's knowledgeDocumentId, which it leaves out of a row unless the fields name it", async () => {
    const { strapi, calls } = strapiHolding(REHEARSAL);
    await seedService({ strapi }).resetDemoAppointments();
    const read = calls.find(({ uid, method }) => uid === QUESTION && method === 'findMany');
    expect(read?.params.fields).toEqual(expect.arrayContaining(['documentId', 'knowledgeDocumentId']));
  });

  it("leaves the seeded knowledge alone: it never lists knowledge, and deletes only the entries a question's answer added", async () => {
    const { strapi, calls } = strapiHolding(REHEARSAL);
    await seedService({ strapi }).resetDemoAppointments();
    expect(calls.filter(({ uid }) => uid === KNOWLEDGE).map(({ method, params }) => [method, params.documentId])).toEqual([
      ['delete', 'k1'],
      ['delete', 'k2'],
    ]);
  });

  it('deletes no knowledge when no question has an entry, or when there are no questions', async () => {
    const { strapi, calls } = strapiHolding({ ...REHEARSAL, [QUESTION]: [{ documentId: 'q1' }, { documentId: 'q2', knowledgeDocumentId: '' }] });
    expect(await seedService({ strapi }).resetDemoAppointments()).toEqual({
      appointments: 3,
      notifications: 2,
      questions: 2,
      inquiries: 3,
      knowledge: 0,
    });
    expect(calls.filter(({ uid }) => uid === KNOWLEDGE)).toEqual([]);

    const empty = strapiHolding({});
    expect(await seedService({ strapi: empty.strapi }).resetDemoAppointments()).toEqual({
      appointments: 0,
      notifications: 0,
      questions: 0,
      inquiries: 0,
      knowledge: 0,
    });
    expect(deletions(empty.calls)).toEqual([]);
  });

  it('deletes the inquiries when there are no questions, and the questions when there are no inquiries', async () => {
    const noQuestions = strapiHolding({ ...REHEARSAL, [QUESTION]: [] });
    expect((await seedService({ strapi: noQuestions.strapi }).resetDemoAppointments()).inquiries).toBe(3);
    expect(deletions(noQuestions.calls).filter(([uid]) => uid === INQUIRY)).toHaveLength(3);

    const noInquiries = strapiHolding({ ...REHEARSAL, [INQUIRY]: [] });
    expect((await seedService({ strapi: noInquiries.strapi }).resetDemoAppointments()).questions).toBe(3);
    expect(deletions(noInquiries.calls).filter(([uid]) => uid === QUESTION)).toHaveLength(3);
  });

  it('stops before it deletes any question when an entry will not delete, so running the reset again finds the same entries', async () => {
    const { strapi, calls } = strapiHolding(REHEARSAL, { failing: ['k2'] });
    await expect(seedService({ strapi }).resetDemoAppointments()).rejects.toThrow('could not delete k2');
    expect(deletions(calls).map(([uid]) => uid)).toEqual([KNOWLEDGE, KNOWLEDGE]);
  });

  describe('the saved chats of the Ask tab', () => {
    const CONVERSATION = 'plugin::maison.conversation';
    const chats = (count: number) => Array.from({ length: count }, (_, index) => ({ documentId: `c${index + 1}` }));
    const chatDeletions = (calls: Call[]) => deletions(calls).flatMap(([uid, params]) => (uid === CONVERSATION ? [(params as { documentId: string }).documentId] : []));
    const chatReads = (calls: Call[]) => calls.filter(({ uid, method }) => uid === CONVERSATION && method === 'findMany');

    it('deletes every one of them, every admin\'s, after the appointments, and does not count them in its answer', async () => {
      const { strapi, calls } = strapiHolding({ ...REHEARSAL, [CONVERSATION]: chats(3) });
      expect(await seedService({ strapi }).resetDemoAppointments()).toEqual({ appointments: 3, notifications: 2, questions: 3, inquiries: 3, knowledge: 2 });
      expect(chatDeletions(calls)).toEqual(['c1', 'c2', 'c3']);
      const order = deletions(calls).map(([uid]) => uid);
      expect(order.indexOf(CONVERSATION)).toBeGreaterThan(order.lastIndexOf(APPOINTMENT));
    });

    it('reads them with no filter, as many at a time as the other content types, until none are left', async () => {
      const { strapi, calls } = strapiHolding({ ...REHEARSAL, [CONVERSATION]: chats(5001) });
      await seedService({ strapi }).resetDemoAppointments();
      expect(chatDeletions(calls)).toHaveLength(5001);
      expect(chatReads(calls).map(({ returned }) => returned)).toEqual([5000, 1, 0]);
      for (const { params } of chatReads(calls)) expect(params).toEqual({ fields: ['documentId'], limit: 5000 });
    });

    it('has nothing to delete when no admin has a chat', async () => {
      const { strapi, calls } = strapiHolding(REHEARSAL);
      await seedService({ strapi }).resetDemoAppointments();
      expect(chatDeletions(calls)).toEqual([]);
      expect(chatReads(calls).map(({ returned }) => returned)).toEqual([0]);
    });

    it('stops with the chat that is still there after it was deleted, instead of reading it again for ever', async () => {
      const { strapi } = strapiHolding({ ...REHEARSAL, [CONVERSATION]: chats(3) }, { stuck: ['c2'] });
      await expect(seedService({ strapi }).resetDemoAppointments()).rejects.toThrow('Saved chat c2 is still there after it was deleted, so the reset stops.');
    });

    it('stops at a chat that will not delete', async () => {
      const { strapi, calls } = strapiHolding({ ...REHEARSAL, [CONVERSATION]: chats(3) }, { failing: ['c2'] });
      await expect(seedService({ strapi }).resetDemoAppointments()).rejects.toThrow('could not delete c2');
      expect(chatDeletions(calls)).toEqual(['c1', 'c2']);
    });
  });

  describe('with more inquiries than one read holds', () => {
    /** `count` inquiries: i1, i2 and so on. */
    const inquiries = (count: number) => Array.from({ length: count }, (_, index) => ({ documentId: `i${index + 1}` }));
    const inquiryReads = (calls: Call[]) => calls.filter(({ uid, method }) => uid === INQUIRY && method === 'findMany');
    const inquiryDeletions = (calls: Call[]) => deletions(calls).flatMap(([uid, params]) => (uid === INQUIRY ? [(params as { documentId: string }).documentId] : []));

    it('deletes every one of them, reading again until none are left, and counts them all', async () => {
      const { strapi, calls } = strapiHolding({ ...REHEARSAL, [INQUIRY]: inquiries(12_001) });

      const result = await seedService({ strapi }).resetDemoAppointments();

      expect(result.inquiries).toBe(12_001);
      const deleted = inquiryDeletions(calls);
      expect(deleted).toHaveLength(12_001);
      expect(new Set(deleted).size).toBe(12_001);
      // Three reads of 5,000, 5,000 and 2,001, and a fourth that finds none.
      expect(inquiryReads(calls).map(({ returned }) => returned)).toEqual([5000, 5000, 2001, 0]);
      for (const { params } of inquiryReads(calls)) expect(params).toEqual({ fields: ['documentId'], limit: 5000 });
    });

    it.each([
      [0, [0]],
      [1, [1, 0]],
      [4999, [4999, 0]],
      [5000, [5000, 0]],
      [5001, [5000, 1, 0]],
      [10_000, [5000, 5000, 0]],
    ])('with %s inquiries, reads %j and deletes all of them', async (count, reads) => {
      const { strapi, calls } = strapiHolding({ ...REHEARSAL, [INQUIRY]: inquiries(count) });

      const result = await seedService({ strapi }).resetDemoAppointments();

      expect(result.inquiries).toBe(count);
      expect(inquiryDeletions(calls)).toHaveLength(count);
      expect(inquiryReads(calls).map(({ returned }) => returned)).toEqual(reads);
    });

    it('goes on to the notifications and the appointments once the last inquiry is gone', async () => {
      const { strapi, calls } = strapiHolding({ ...REHEARSAL, [INQUIRY]: inquiries(5001) });

      await seedService({ strapi }).resetDemoAppointments();

      expect(inquiryDeletions(calls)).toHaveLength(5001);
      const order = deletions(calls).map(([uid]) => uid);
      expect(order.lastIndexOf(INQUIRY)).toBeLessThan(order.indexOf(NOTIFICATION));
      expect(order.filter((uid) => uid === NOTIFICATION)).toHaveLength(2);
      expect(order.filter((uid) => uid === APPOINTMENT)).toHaveLength(3);
    });

    // A delete that leaves its document would make the loop read it again for ever, so the reset stops and says which one.
    it('stops with the inquiry that is still there after it was deleted, instead of reading it again for ever', async () => {
      const { strapi, calls } = strapiHolding(REHEARSAL, { stuck: ['i2'] });

      await expect(seedService({ strapi }).resetDemoAppointments()).rejects.toThrow('Inquiry i2 is still there after it was deleted');

      expect(inquiryReads(calls)).toHaveLength(2);
      expect(deletions(calls).map(([uid]) => uid)).not.toContain(NOTIFICATION);
      expect(deletions(calls).map(([uid]) => uid)).not.toContain(APPOINTMENT);
    });

    it('stops at an inquiry that will not delete, and the next reset finds the rest', async () => {
      const { strapi, calls } = strapiHolding({ ...REHEARSAL, [INQUIRY]: inquiries(3) }, { failing: ['i2'] });

      await expect(seedService({ strapi }).resetDemoAppointments()).rejects.toThrow('could not delete i2');

      expect(inquiryDeletions(calls)).toEqual(['i1', 'i2']);
      expect(deletions(calls).map(([uid]) => uid)).not.toContain(NOTIFICATION);
    });
  });
});
