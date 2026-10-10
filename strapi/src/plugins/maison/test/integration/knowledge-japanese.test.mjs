import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, bootStrapi } from './harness.mjs';

const KNOWLEDGE = 'plugin::maison.knowledge';
const QUESTION = 'plugin::maison.question';
const seed = JSON.parse(readFileSync(new URL('../../server/seed/knowledge.json', import.meta.url), 'utf8')).entries;
const catalogThere = { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0 };

/** Every knowledge document's version in `locale`, published or draft. */
const versions = (strapi, locale, status) => strapi.documents(KNOWLEDGE).findMany({ locale, status, limit: 100 });

/** The fields that make an entry what it is, and when it was last saved and published. */
const asSaved = ({ documentId, title, answer, keywords, category, productSlugs, updatedAt, publishedAt }) => ({
  documentId, title, answer, keywords, category, productSlugs, updatedAt: String(updatedAt), publishedAt: String(publishedAt),
});
const byDocument = (a, b) => a.documentId.localeCompare(b.documentId);

describe('product knowledge in Japanese', () => {
  let strapi;
  let seedService;
  let catalog;
  before(async () => {
    strapi = await bootStrapi('knowledge-japanese');
    seedService = strapi.plugin('maison').service('seed');
    catalog = strapi.plugin('maison').service('catalog');
  });
  after(async () => {
    await strapi?.destroy();
  });

  it('Load demo catalog publishes all 16 entries in English and in Japanese, as two versions of each document', async () => {
    assert.deepEqual(await seedService.loadDemoCatalog(), {
      created: true, collections: 3, products: 12, boutiques: 3, stockLevels: 36, knowledge: 16, knowledgeJa: 16,
    });
    const en = await versions(strapi, 'en', 'published');
    const ja = await versions(strapi, 'ja', 'published');
    assert.equal(en.length, 16);
    assert.equal(ja.length, 16);
    for (const entry of seed) {
      const english = en.find((doc) => doc.title === entry.title);
      assert.ok(english, `${entry.title}: no published English version`);
      const japanese = ja.find((doc) => doc.documentId === english.documentId);
      assert.ok(japanese, `${entry.title}: no published Japanese version`);
      assert.deepEqual({ title: japanese.title, answer: japanese.answer, keywords: japanese.keywords }, entry.ja);
      // The category and the products are shared by every locale.
      assert.equal(japanese.category, entry.category);
      assert.deepEqual(japanese.productSlugs, entry.productSlugs);
    }
  });

  it("search_knowledge in ja answers the leather care question with the leather care entry's Japanese answer", async () => {
    const leather = seed.find((entry) => entry.title === 'How do I care for the leather?');
    const result = await catalog.searchKnowledge('ja', { query: '革のお手入れ方法を教えてください' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.entries[0].title, leather.ja.title);
    assert.equal(result.value.entries[0].answer, leather.ja.answer);
  });

  it('adds nothing when pressed again', async () => {
    assert.deepEqual(await seedService.loadDemoCatalog(), { ...catalogThere, knowledge: 0, knowledgeJa: 0 });
    assert.equal(await strapi.documents(KNOWLEDGE).count({ locale: 'en' }), 16);
    assert.equal(await strapi.documents(KNOWLEDGE).count({ locale: 'ja' }), 16);
  });

  it('adds exactly the 16 Japanese versions to a Strapi that has only the English entries, and leaves the English ones as they were', async () => {
    // Start over as Strapi Cloud has it: the English entries as the loader made them before, created and published in en.
    for (const { documentId } of await versions(strapi, 'en')) await strapi.documents(KNOWLEDGE).delete({ documentId, locale: '*' });
    for (const { ja: _ja, ...english } of seed) {
      const { documentId } = await strapi.documents(KNOWLEDGE).create({ locale: 'en', data: english });
      await strapi.documents(KNOWLEDGE).publish({ documentId, locale: 'en' });
    }
    assert.equal(await strapi.documents(KNOWLEDGE).count({ locale: 'ja' }), 0);
    const before = {
      draft: (await versions(strapi, 'en', 'draft')).map(asSaved).sort(byDocument),
      published: (await versions(strapi, 'en', 'published')).map(asSaved).sort(byDocument),
    };

    assert.deepEqual(await seedService.loadDemoCatalog(), { ...catalogThere, knowledge: 0, knowledgeJa: 16 });

    const ja = await versions(strapi, 'ja', 'published');
    assert.equal(ja.length, 16);
    assert.deepEqual(ja.map((doc) => doc.documentId).sort(), before.published.map((doc) => doc.documentId).sort());
    assert.deepEqual((await versions(strapi, 'en', 'draft')).map(asSaved).sort(byDocument), before.draft);
    assert.deepEqual((await versions(strapi, 'en', 'published')).map(asSaved).sort(byDocument), before.published);
  });

  it('Reset demo activity keeps the seeded product knowledge in both languages, and deletes the entry a staff answer added', async () => {
    const { documentId: answered } = await strapi.documents(KNOWLEDGE).create({
      locale: 'ja', data: { title: '日曜日は営業していますか？', answer: 'はい、営業しております。', category: 'store', productSlugs: [], keywords: '' },
    });
    await strapi.documents(KNOWLEDGE).publish({ documentId: answered, locale: 'ja' });
    await strapi.documents(QUESTION).create({
      data: { reference: 'Q-9001', customer: SUBJECT_A, question: '日曜日は営業していますか？', language: 'ja', status: 'answered', knowledgeDocumentId: answered },
    });

    assert.deepEqual(await seedService.resetDemoAppointments(), { appointments: 0, notifications: 0, questions: 1, inquiries: 0, knowledge: 1 });

    assert.equal((await versions(strapi, 'en', 'published')).length, 16);
    assert.equal((await versions(strapi, 'ja', 'published')).length, 16);
    assert.equal(await strapi.documents(KNOWLEDGE).count({ locale: 'ja', filters: { documentId: answered } }), 0);
  });

  it('skips an entry whose English title staff changed, never touches an entry a staff answer added, and adds the rest', async () => {
    const en = await versions(strapi, 'en', 'published');
    const documentOf = (title) => en.find((doc) => doc.title === title).documentId;
    const leather = documentOf('How do I care for the leather?');
    const gift = documentOf('Do you gift wrap?');
    const returns = documentOf('Can I return or exchange a piece?');

    // Staff renamed the leather care entry, which has no Japanese version.
    await strapi.documents(KNOWLEDGE).delete({ documentId: leather, locale: 'ja' });
    await strapi.documents(KNOWLEDGE).update({ documentId: leather, locale: 'en', data: { title: 'Leather care' } });
    await strapi.documents(KNOWLEDGE).publish({ documentId: leather, locale: 'en' });
    // The gift wrap entry is gone, and a staff answer to an English question added one with its title.
    await strapi.documents(KNOWLEDGE).delete({ documentId: gift, locale: '*' });
    const { documentId: answered } = await strapi.documents(KNOWLEDGE).create({
      locale: 'en', data: { title: 'Do you gift wrap?', answer: 'Yes, in a Maison box.', category: 'gifting', productSlugs: [], keywords: '' },
    });
    await strapi.documents(KNOWLEDGE).publish({ documentId: answered, locale: 'en' });
    await strapi.documents(QUESTION).create({
      data: { reference: 'Q-9002', customer: SUBJECT_A, question: 'Do you gift wrap?', language: 'en', status: 'answered', knowledgeDocumentId: answered },
    });
    // The returns entry has lost its Japanese version.
    await strapi.documents(KNOWLEDGE).delete({ documentId: returns, locale: 'ja' });

    assert.deepEqual(await seedService.loadDemoCatalog(), { ...catalogThere, knowledge: 0, knowledgeJa: 1 });

    const withJapanese = new Set((await versions(strapi, 'ja')).map((doc) => doc.documentId));
    assert.equal(withJapanese.has(returns), true, 'the returns entry gets its Japanese version back');
    assert.equal(withJapanese.has(leather), false, 'the renamed entry is skipped');
    assert.equal(withJapanese.has(answered), false, "the staff answer's entry is never touched");
    const answer = await strapi.documents(KNOWLEDGE).findOne({ documentId: answered, locale: 'en' });
    assert.equal(answer.answer, 'Yes, in a Maison box.');
  });

  describe('POST /maison/demo/seed, over the admin route', () => {
    let baseUrl;
    let staff;
    const nothing = { ...catalogThere, knowledge: 0, knowledgeJa: 0 };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /** One request to an admin route. The token is sent, never logged. */
    const call = async (method, path, token) => {
      const response = await fetch(new URL(path, baseUrl), { method, headers: { Authorization: `Bearer ${token}` } });
      const text = await response.text();
      return { status: response.status, text, body: JSON.parse(text || 'null') };
    };

    /** While true, each update of a knowledge entry in ja waits SLOW_MS before it runs. */
    let slowJapanese = false;
    const SLOW_MS = 150;

    before(async () => {
      strapi.documents.use(async (context, next) => {
        if (slowJapanese && context.uid === KNOWLEDGE && context.action === 'update' && context.params?.locale === 'ja') await sleep(SLOW_MS);
        return next();
      });
      const roles = strapi.service('admin::role');
      const role = await roles.create({ name: 'Maison test: catalog', description: 'Created by the Maison integration tests' });
      await roles.assignPermissions(role.id, [{ action: 'plugin::maison.demo.manage', subject: null, properties: {}, conditions: [] }]);
      const user = await strapi.service('admin::user').create({ email: 'catalog@maison.test', firstname: 'catalog', lastname: 'Test', isActive: true, roles: [role.id] });
      const sessions = strapi.sessionManager('admin');
      const { token: refreshToken } = await sessions.generateRefreshToken(String(user.id), 'maison-test-catalog', { type: 'session' });
      staff = (await sessions.generateAccessToken(refreshToken)).token;
      await new Promise((resolve, reject) => {
        strapi.server.listen(0, '127.0.0.1', resolve).once('error', reject);
      });
      baseUrl = `http://127.0.0.1:${strapi.server.httpServer.address().port}`;
    });

    it('answers 200 at once when the catalog and its product knowledge are all there', async () => {
      // The earlier tests left the leather care entry renamed: start over with the seeded entries, loaded through the service.
      for (const { documentId } of await versions(strapi, 'en')) await strapi.documents(KNOWLEDGE).delete({ documentId, locale: '*' });
      assert.deepEqual(await seedService.loadDemoCatalog(), { ...catalogThere, knowledge: 16, knowledgeJa: 16 });
      const again = await call('POST', '/maison/demo/seed', staff);
      assert.equal(again.status, 200, again.text);
      assert.deepEqual(again.body, nothing);
    });

    it('answers 202 at once with what it will add, a second press while it loads starts nothing, and the entries appear within a few seconds', async () => {
      // Start from a Strapi with no product knowledge at all: 16 English entries, then their 16 Japanese versions, to add.
      for (const { documentId } of await versions(strapi, 'en')) await strapi.documents(KNOWLEDGE).delete({ documentId, locale: '*' });

      // Locally the writes take a fraction of a second, so each Japanese version waits a little first, as a remote database
      // makes it wait: the second press then comes while the first is still loading.
      slowJapanese = true;
      const first = await call('POST', '/maison/demo/seed', staff);
      assert.equal(first.status, 202, first.text);
      assert.deepEqual(first.body, { started: true, collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 16, knowledgeJa: 16 });
      const second = await call('POST', '/maison/demo/seed', staff);
      assert.equal(second.status, 409, second.text);
      assert.equal(second.body.error.details.code, 'already_loading');
      assert.equal(second.body.error.message, 'The demo catalog is still loading from the last press.');

      const deadline = Date.now() + 10_000;
      while ((await strapi.documents(KNOWLEDGE).count({ locale: 'ja', status: 'published' })) < 16) {
        assert.ok(Date.now() < deadline, 'the Japanese versions appear within 10 seconds');
        await sleep(100);
      }
      assert.equal(await strapi.documents(KNOWLEDGE).count({ locale: 'en', status: 'published' }), 16);
      for (const entry of seed) {
        const [english] = await strapi.documents(KNOWLEDGE).findMany({ locale: 'en', status: 'published', filters: { title: entry.title } });
        const japanese = await strapi.documents(KNOWLEDGE).findOne({ documentId: english.documentId, locale: 'ja', status: 'published' });
        assert.deepEqual({ title: japanese.title, answer: japanese.answer, keywords: japanese.keywords }, entry.ja, entry.title);
      }
      slowJapanese = false;
      // Once it has finished, a press answers that everything is there.
      let last;
      while (Date.now() < deadline + 5_000) {
        last = await call('POST', '/maison/demo/seed', staff);
        if (last.status === 200) break;
        await sleep(100);
      }
      assert.equal(last.status, 200, last.text);
      assert.deepEqual(last.body, nothing);
    });
  });
});
