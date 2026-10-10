import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Core } from '@strapi/strapi';

import { errors } from '@strapi/utils';

import content from '../../seed/content.json';
import knowledge from '../../seed/knowledge.json';
import { UID } from '../constants';
import { mapConcurrently } from '../domain/concurrency';
import { englishData, japaneseToAdd, type KnowledgeVersion, type SeedKnowledgeEntry } from '../domain/knowledge-seed';
import { failure, type ServiceResult } from '../domain/service-result';
import { asSentence } from '../domain/text';
import { inBackground } from './background';
import { loadDemoActivity, startDemoActivity, type ActivityResult, type ActivityStart } from './demo-activity';

type Localized = { ja: string; en: string };
const paragraph = (text: string) => [{ type: 'paragraph', children: [{ type: 'text', text }] }];

/** How many documents the reset reads at a time. */
const RESET_READ = 5000;

/** The most documents a read for the seeded product knowledge answers: many more than its 16 entries could match. */
const KNOWLEDGE_READ = 1000;

/**
 * How many Japanese versions are written at once. Each is an update and then a publish, in turn. Four at a time cuts
 * the wait on a remote database to about a quarter, and stays well inside its connection pool.
 */
const JAPANESE_AT_ONCE = 4;

const CATALOG_ALREADY_LOADING = 'The demo catalog is still loading from the last press.';

/**
 * True from a press of Load demo catalog until the load it started has ended, whether it finished or failed.
 * Module-level, so every press in this Strapi process sees it.
 */
let catalogLoading = false;

/** At runtime this file is bundled into dist/server/index.js, so the package root is two levels up. */
const seedDir = () => path.resolve(__dirname, '..', '..', 'server', 'seed');

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** The upload type of a seed image, from its file name's extension. Throws for any other extension. */
export const imageMimeType = (fileName: string): string => {
  const mimeType = IMAGE_MIME_TYPES[path.extname(fileName).toLowerCase()];
  if (!mimeType) {
    throw new Error(`Unsupported seed image "${fileName}": use a file ending in ${Object.keys(IMAGE_MIME_TYPES).join(', ')}.`);
  }
  return mimeType;
};

/**
 * What Load demo catalog did: the catalog it created (all zeros when it was there already), and the product knowledge it
 * added: `knowledge` English entries, and `knowledgeJa` Japanese versions of English entries.
 */
export interface SeedResult {
  created: boolean;
  collections: number;
  products: number;
  boutiques: number;
  stockLevels: number;
  knowledge: number;
  knowledgeJa: number;
}

/** The seeded product knowledge, in English with each entry's Japanese version. */
const seedKnowledge: SeedKnowledgeEntry[] = knowledge.entries;

/** What a press answers when it starts a load: what it will add, in the background. */
export type CatalogCounts = Omit<SeedResult, 'created'>;

/**
 * What a press of Load demo catalog did: started the load in the background, with what it will add and `done`, which
 * settles when it has ended, or found everything there, with `result`.
 */
export type CatalogStart = { started: true; counts: CatalogCounts; done: Promise<SeedResult> } | { started: false; result: SeedResult };

/** A Japanese version to add: the English document, and the entry's Japanese fields. */
type JapaneseVersion = { documentId: string; data: KnowledgeVersion };

/**
 * What a press of Load demo catalog will write, read before anything is: whether the catalog and the English product
 * knowledge are missing, and the Japanese versions to add to the English entries there are now. When the English
 * entries are missing, the Japanese versions are worked out once they've been added.
 */
interface CatalogPlan {
  catalog: boolean;
  english: boolean;
  japanese: JapaneseVersion[];
}

const catalogStoppedPartway = (error: unknown): string =>
  `Loading the demo catalog stopped partway: ${asSentence(String((error as Error)?.message ?? error))} Press Load demo catalog again: it adds only what is missing.`;

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const uploadImage = async (fileName: string, alternativeText: string): Promise<number> => {
    const filepath = path.join(seedDir(), 'images', fileName);
    const { size } = await stat(filepath);
    const [file] = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: fileName, alternativeText } },
      files: { filepath, originalFilename: fileName, mimetype: imageMimeType(fileName), size },
    });
    return file.id;
  };

  const ensureLocales = async () => {
    const locales = strapi.plugin('i18n').service('locales');
    for (const locale of content.locales) {
      if (!(await locales.findByCode(locale.code))) await locales.create({ code: locale.code, name: locale.name });
    }
  };

  /** Creates the ja version, adds the en localization, then publishes both. */
  const createLocalized = async (uid: string, ja: Record<string, unknown>, en: Record<string, unknown>) => {
    const { documentId } = await strapi.documents(uid as any).create({ locale: 'ja', data: ja });
    await strapi.documents(uid as any).update({ documentId, locale: 'en', data: en });
    await strapi.documents(uid as any).publish({ documentId, locale: '*' });
    return documentId as string;
  };

  const pick = (value: Localized, locale: 'ja' | 'en') => value[locale];

  /** The demo catalog: its boutiques, collections, products and stock, one after another. The plan runs it only when the catalog isn't there. */
  const loadCatalog = async (): Promise<Omit<SeedResult, 'knowledge' | 'knowledgeJa'>> => {
    for (const b of content.boutiques) {
      const image = await uploadImage(b.image, b.name.en);
      const version = (locale: 'ja' | 'en') => ({
        name: pick(b.name, locale), slug: b.slug, city: pick(b.city, locale), address: pick(b.address, locale),
        openingHours: b.openingHours, image,
      });
      await createLocalized(UID.boutique, version('ja'), version('en'));
    }

    const collectionIds: Record<string, string> = {};
    for (const c of content.collections) {
      const heroImage = await uploadImage(c.image, c.name.en);
      const version = (locale: 'ja' | 'en') => ({ name: pick(c.name, locale), slug: c.slug, story: paragraph(pick(c.story, locale)), heroImage });
      collectionIds[c.slug] = await createLocalized(UID.collection, version('ja'), version('en'));
    }

    for (const p of content.products) {
      const images = [await uploadImage(p.image, p.name.en)];
      const [widthCm, heightCm, depthCm] = p.dimensionsCm;
      const version = (locale: 'ja' | 'en') => ({
        name: pick(p.name, locale), slug: p.slug, sku: p.sku, category: p.category, priceJpy: p.priceJpy, images,
        widthCm, heightCm, depthCm, personalizable: p.personalizable, personalizationKinds: p.personalizationKinds,
        personalizationLeadDays: p.personalizationLeadDays, giftOccasions: p.giftOccasions,
        description: paragraph(pick(p.description, locale)), craftStory: pick(p.craftStory, locale),
        collection: collectionIds[p.collection],
      });
      await createLocalized(UID.product, version('ja'), version('en'));
    }

    let stockLevels = 0;
    for (const [productSlug, perBoutique] of Object.entries(content.stock)) {
      for (const [boutiqueSlug, quantity] of Object.entries(perBoutique)) {
        await strapi.documents(UID.stockLevel).create({ data: { productSlug, boutiqueSlug, quantity } });
        stockLevels += 1;
      }
    }

    return {
      created: true,
      collections: content.collections.length,
      products: content.products.length,
      boutiques: content.boutiques.length,
      stockLevels,
    };
  };

  /** Whether the demo catalog is there: its first collection, in Japanese. */
  const catalogThere = async (): Promise<boolean> =>
    Boolean(await strapi.documents(UID.collection).findFirst({ locale: 'ja', filters: { slug: { $eq: content.collections[0].slug } } }));

  /**
   * Maison's product knowledge in English: one published en document per entry, one after another. The plan adds it
   * when there's no en entry yet, whether or not the catalog was there before, so a Strapi that loaded the catalog
   * earlier gets it too. Returns how many it added.
   */
  const loadEnglishKnowledge = async (): Promise<number> => {
    for (const entry of seedKnowledge) {
      const { documentId } = await strapi.documents(UID.knowledge).create({ locale: 'en', data: englishData(entry) });
      await strapi.documents(UID.knowledge).publish({ documentId, locale: 'en' });
    }
    return seedKnowledge.length;
  };

  /**
   * The Japanese version of each seeded entry to add, on the English document with the entry's title: only where that
   * document has none yet (japaneseToAdd has the rules). It only reads.
   */
  const japaneseVersionsToAdd = async (): Promise<JapaneseVersion[]> => {
    const english = (await strapi.documents(UID.knowledge).findMany({
      locale: 'en',
      filters: { title: { $in: seedKnowledge.map((entry) => entry.title) } },
      fields: ['documentId', 'title'],
      limit: KNOWLEDGE_READ,
    })) as Array<{ documentId: string; title?: string | null }>;
    if (english.length === 0) return [];
    const documentIds = english.map(({ documentId }) => documentId);
    const japanese = (await strapi.documents(UID.knowledge).findMany({
      locale: 'ja',
      filters: { documentId: { $in: documentIds } },
      fields: ['documentId'],
      limit: KNOWLEDGE_READ,
    })) as Array<{ documentId: string }>;
    const answers = (await strapi.documents(UID.question).findMany({
      filters: { knowledgeDocumentId: { $in: documentIds } },
      fields: ['knowledgeDocumentId'],
      limit: KNOWLEDGE_READ,
    })) as Array<{ knowledgeDocumentId?: string | null }>;

    return japaneseToAdd(seedKnowledge, {
      english: english.map(({ documentId, title }) => ({ documentId, title: title ?? '' })),
      withJapanese: japanese.map(({ documentId }) => documentId),
      answers: answers.map(({ knowledgeDocumentId }) => knowledgeDocumentId).filter((id): id is string => Boolean(id)),
    });
  };

  /**
   * Adds the Japanese versions, JAPANESE_AT_ONCE at a time, each published in ja right after it is written. Returns how
   * many it added.
   *
   * In Strapi 5's Document Service, update() with a locale the document doesn't have yet creates that locale's version,
   * with the fields every locale shares copied from an existing one (@strapi/core's document-service repository, and
   * docs.strapi.io's REST API locale page: "Create a new, or update an existing, locale version"). publish() with that
   * locale publishes only that version.
   */
  const addJapaneseVersions = async (versions: JapaneseVersion[]): Promise<number> => {
    await mapConcurrently(versions, JAPANESE_AT_ONCE, async ({ documentId, data }) => {
      // The plugin has no generated types for its content types, so update()'s types don't know these fields: a plain record.
      const version: Record<string, string> = { ...data };
      await strapi.documents(UID.knowledge).update({ documentId, locale: 'ja', data: version });
      await strapi.documents(UID.knowledge).publish({ documentId, locale: 'ja' });
    });
    return versions.length;
  };

  /** What a press of Load demo catalog will write (CatalogPlan). It only reads, after it adds a missing ja or en locale. */
  const planCatalog = async (): Promise<CatalogPlan> => {
    await ensureLocales();
    const [catalog, englishCount] = await Promise.all([catalogThere(), strapi.documents(UID.knowledge).count({ locale: 'en' })]);
    const english = englishCount === 0;
    return { catalog: !catalog, english, japanese: english ? [] : await japaneseVersionsToAdd() };
  };

  /** What a plan will add, as a press answers it. With the English entries missing, every one of them gets its Japanese version. */
  const countsOf = (plan: CatalogPlan): CatalogCounts => {
    const stockLevels = Object.values(content.stock).reduce((total, perBoutique) => total + Object.keys(perBoutique).length, 0);
    return {
      collections: plan.catalog ? content.collections.length : 0,
      products: plan.catalog ? content.products.length : 0,
      boutiques: plan.catalog ? content.boutiques.length : 0,
      stockLevels: plan.catalog ? stockLevels : 0,
      knowledge: plan.english ? seedKnowledge.length : 0,
      knowledgeJa: plan.english ? seedKnowledge.length : plan.japanese.length,
    };
  };

  /** The writes of a press, in turn: the catalog, the English product knowledge, then the Japanese versions. */
  const writeCatalog = async (plan: CatalogPlan): Promise<SeedResult> => {
    const catalog = plan.catalog ? await loadCatalog() : { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0 };
    const englishKnowledge = plan.english ? await loadEnglishKnowledge() : 0;
    // New English entries have no Japanese version yet: those to add are known once they are written.
    const japanese = plan.english ? await japaneseVersionsToAdd() : plan.japanese;
    return { ...catalog, knowledge: englishKnowledge, knowledgeJa: await addJapaneseVersions(japanese) };
  };

  /** What the log says once a load of the catalog has finished. */
  const catalogLoadedLine = (result: SeedResult): string =>
    `[maison] Loaded the demo catalog: ${result.products} products, ${result.collections} collections, ${result.boutiques} boutiques, ${result.stockLevels} stock levels, ${result.knowledge} product knowledge entries in English and ${result.knowledgeJa} in Japanese.`;

  /**
   * A press of Load demo catalog. It first reads what is missing (planCatalog), and answers at once with `started: false`
   * and nothing added when everything is there. Otherwise it starts the writes in the background and answers at once
   * with what it will add. A failure there is logged as an error, and never escapes. A press while a load is running,
   * planning included, is `already_loading`, and starts nothing.
   */
  const startDemoCatalog = async (): Promise<ServiceResult<CatalogStart>> => {
    if (catalogLoading) {
      return failure('already_loading', CATALOG_ALREADY_LOADING, 'Wait for it to finish, then press Load demo catalog again to check it is all there.');
    }
    // Set before anything is awaited, so a second press in the same moment finds it set.
    catalogLoading = true;
    let handedOver = false;
    try {
      const plan = await planCatalog();
      const counts = countsOf(plan);
      if (!plan.catalog && !plan.english && plan.japanese.length === 0) {
        return { ok: true, value: { started: false, result: { created: false, ...counts } } };
      }
      const done = inBackground(
        async () => {
          try {
            return await writeCatalog(plan);
          } catch (error) {
            throw new errors.ApplicationError(catalogStoppedPartway(error));
          }
        },
        {
          release: () => {
            catalogLoading = false;
          },
          finished: (result) => strapi.log.info(catalogLoadedLine(result)),
          failed: (error) => strapi.log.error(`[maison] ${error instanceof errors.ApplicationError ? error.message : catalogStoppedPartway(error)}`),
        }
      );
      handedOver = true;
      return { ok: true, value: { started: true, counts, done } };
    } finally {
      // Nothing was started: the next press may plan afresh. Once the writes have started, they clear it when they end.
      if (!handedOver) catalogLoading = false;
    }
  };

  /**
   * Deletes every document of a content type, reading up to RESET_READ at a time until none are left, and answers how many it
   * deleted. One read isn't enough: a busy concierge makes more inquiries than that. A delete that leaves its document there
   * would make the next read answer it again for ever, so the reset stops, and says which one.
   */
  const deleteEvery = async (uid: typeof UID.inquiry | typeof UID.conversation, noun: string): Promise<number> => {
    let deleted = 0;
    let previous = new Set<string>();
    for (;;) {
      const batch = (await strapi.documents(uid).findMany({ fields: ['documentId'], limit: RESET_READ })) as Array<{ documentId: string }>;
      if (batch.length === 0) return deleted;
      const stuck = batch.find(({ documentId }) => previous.has(documentId));
      if (stuck) throw new Error(`${noun} ${stuck.documentId} is still there after it was deleted, so the reset stops.`);
      for (const { documentId } of batch) await strapi.documents(uid).delete({ documentId });
      deleted += batch.length;
      previous = new Set(batch.map(({ documentId }) => documentId));
    }
  };

  return {
    /** The route's Load demo catalog: what is there is answered at once, and anything missing is added in the background. */
    startDemoCatalog,

    /**
     * Load demo catalog, waiting for it to end: the catalog it created (all zeros when it was there already), and the
     * product knowledge it added. A press while a load is running throws, and a failure partway rejects. Tests and the
     * integration suites use it; the route uses startDemoCatalog.
     */
    async loadDemoCatalog(): Promise<SeedResult> {
      const started = await startDemoCatalog();
      if (started.ok === false) throw new errors.ApplicationError(started.message);
      const { value } = started;
      return value.started === false ? value.result : value.done;
    },

    /**
     * The route's Load demo activity (demo-activity.ts): five made-up customers' requests, questions and inquiries, once,
     * written in the background after an answer at once. `now` is only for tests. It defaults to the current time.
     */
    startDemoActivity(now?: Date): Promise<ServiceResult<ActivityStart>> {
      return startDemoActivity(strapi, now);
    },

    /** Load demo activity, waiting for it to end (demo-activity.ts). `now` is only for tests. */
    loadDemoActivity(now?: Date): Promise<ServiceResult<ActivityResult>> {
      return loadDemoActivity(strapi, now);
    },

    /**
     * Clears what a rehearsal leaves behind: first the product knowledge entries that answers to customers' questions
     * added, in every language, then every question and every inquiry (whether it is open, replied to or closed, and
     * however many there are), then every notification and appointment. The entries go first because a question is
     * where their ids are kept, so a reset that stops partway can run again and find them. Only entries a question
     * names are deleted: the seeded product knowledge and the catalog stay. The Ask tab's saved chats go last, every
     * admin's: they quote the demo customers. The answer doesn't count them.
     */
    async resetDemoAppointments() {
      const questions = (await strapi.documents(UID.question).findMany({
        fields: ['documentId', 'knowledgeDocumentId'],
        limit: RESET_READ,
      })) as Array<{ documentId: string; knowledgeDocumentId?: string | null }>;
      const knowledgeIds = [...new Set(questions.map((q) => q.knowledgeDocumentId).filter((id): id is string => Boolean(id)))];
      for (const documentId of knowledgeIds) await strapi.documents(UID.knowledge).delete({ documentId, locale: '*' });
      for (const q of questions) await strapi.documents(UID.question).delete({ documentId: q.documentId });

      const inquiries = await deleteEvery(UID.inquiry, 'Inquiry');

      const notifications = await strapi.documents(UID.notification).findMany({ fields: ['documentId'], limit: RESET_READ });
      for (const n of notifications) await strapi.documents(UID.notification).delete({ documentId: n.documentId });
      const appointments = await strapi.documents(UID.appointment).findMany({ fields: ['documentId'], limit: RESET_READ });
      for (const a of appointments) await strapi.documents(UID.appointment).delete({ documentId: a.documentId });
      // The Ask tab's saved chats quote the demo customers, so they go with them: every admin's, however many there are.
      await deleteEvery(UID.conversation, 'Saved chat');
      return {
        appointments: appointments.length,
        notifications: notifications.length,
        questions: questions.length,
        inquiries,
        knowledge: knowledgeIds.length,
      };
    },
  };
};
