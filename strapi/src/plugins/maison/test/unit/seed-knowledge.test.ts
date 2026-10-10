import { describe, expect, it } from 'vitest';
import content from '../../server/seed/content.json';
import knowledge from '../../server/seed/knowledge.json';
import schema from '../../server/src/content-types/knowledge/schema.json';
import { KNOWLEDGE_CATEGORIES } from '../../server/src/constants';

const productSlugs = new Set(content.products.map((product) => product.slug));

describe('the product knowledge seed', () => {
  it('has the sixteen demo entries, each with its own title', () => {
    expect(knowledge.entries).toHaveLength(16);
    expect(new Set(knowledge.entries.map((entry) => entry.title)).size).toBe(16);
  });

  it('files every entry under a category the content type allows', () => {
    for (const entry of knowledge.entries) expect(KNOWLEDGE_CATEGORIES, entry.title).toContain(entry.category);
  });

  it('names only products the demo catalog has', () => {
    for (const entry of knowledge.entries) {
      for (const slug of entry.productSlugs) expect(productSlugs.has(slug), `${entry.title}: ${slug}`).toBe(true);
    }
  });

  it('fits the content type limits', () => {
    for (const entry of knowledge.entries) {
      expect(entry.title.length, entry.title).toBeLessThanOrEqual(schema.attributes.title.maxLength);
      expect(entry.answer.length, entry.title).toBeLessThanOrEqual(schema.attributes.answer.maxLength);
      expect(entry.keywords.length, entry.title).toBeLessThanOrEqual(schema.attributes.keywords.maxLength);
    }
  });
});

// content.json is the source of truth: what an entry says about a piece has to hold for the piece the catalog has.
describe('the product knowledge seed and the demo catalog', () => {
  it('tags the canvas care and storage entries with every piece the catalog files under trunk, the trunks and hard cases', () => {
    const trunks = content.products.filter((product) => product.category === 'trunk').map((product) => product.slug).sort();
    for (const title of ['How do I clean the canvas?', 'How should I store a trunk or hard case?']) {
      const entry = knowledge.entries.find((candidate) => candidate.title === title);
      expect([...(entry?.productSlugs ?? [])].sort(), title).toEqual(trunks);
    }
  });

  it("gives a piece's measurements as the catalog does, width × height × depth", () => {
    const given = knowledge.entries.flatMap((entry) =>
      [...entry.answer.matchAll(/measures (\d+) × (\d+)(?: × (\d+))? cm/g)].map((match) => ({ entry, numbers: match.slice(1).filter(Boolean).map(Number) }))
    );
    expect(given.length).toBeGreaterThan(0);
    for (const { entry, numbers } of given) {
      const ofItsPieces = entry.productSlugs.some((slug) => {
        const dimensions = content.products.find((product) => product.slug === slug)?.dimensionsCm ?? [];
        return numbers.every((value, index) => dimensions[index] === value);
      });
      expect(ofItsPieces, `${entry.title}: ${numbers.join(' × ')}`).toBe(true);
    }
  });

  it('gives no personalization time of its own: the catalog keeps a lead time for each piece, and the piece\'s page shows it', () => {
    const entry = knowledge.entries.find((candidate) => candidate.category === 'personalization');
    expect(entry?.answer).not.toMatch(/\d+ days?/);
  });
});

/** Every measurement in a text, like "55 × 40 × 23 cm", in order. */
const measurements = (text: string) => [...text.matchAll(/\d+ × \d+(?: × \d+)? cm/g)].map(([found]) => found);

describe('the Japanese version of each product knowledge entry', () => {
  /** An entry's ja object, read loosely so that a seed without one fails these tests instead of the typecheck. */
  const japanese = (entry: (typeof knowledge.entries)[number]) =>
    (entry as { ja?: { title?: unknown; answer?: unknown; keywords?: unknown } }).ja;

  it('has a title, an answer and keywords, and nothing else', () => {
    for (const entry of knowledge.entries) {
      const ja = japanese(entry);
      expect(Object.keys(ja ?? {}).sort(), entry.title).toEqual(['answer', 'keywords', 'title']);
      for (const value of Object.values(ja ?? {})) expect(typeof value === 'string' && value.trim().length > 0, entry.title).toBe(true);
    }
  });

  it('is written in Japanese, each with its own title', () => {
    expect(new Set(knowledge.entries.map((entry) => String(japanese(entry)?.title))).size).toBe(16);
    for (const entry of knowledge.entries) {
      for (const field of ['title', 'answer', 'keywords'] as const) {
        expect(String(japanese(entry)?.[field]), `${entry.title}: ${field}`).toMatch(/[぀-ヿ一-鿿]/u);
      }
    }
  });

  it('fits the content type limits', () => {
    for (const entry of knowledge.entries) {
      const ja = japanese(entry);
      expect(String(ja?.title).length, entry.title).toBeLessThanOrEqual(schema.attributes.title.maxLength);
      expect(String(ja?.answer).length, entry.title).toBeLessThanOrEqual(schema.attributes.answer.maxLength);
      expect(String(ja?.keywords).length, entry.title).toBeLessThanOrEqual(schema.attributes.keywords.maxLength);
    }
  });

  it("names each of the entry's pieces in its keywords as the catalog names it in Japanese", () => {
    for (const entry of knowledge.entries) {
      const keywords = String(japanese(entry)?.keywords).split(',').map((keyword) => keyword.trim());
      for (const slug of entry.productSlugs) {
        const name = content.products.find((product) => product.slug === slug)?.name.ja;
        expect(keywords, `${entry.title}: ${slug}`).toContain(name);
      }
    }
  });

  it('lists each keyword once', () => {
    for (const entry of knowledge.entries) {
      const keywords = String(japanese(entry)?.keywords).split(',').map((keyword) => keyword.trim());
      expect(keywords.filter((keyword, index) => keywords.indexOf(keyword) !== index), entry.title).toEqual([]);
    }
  });

  it('gives the same measurements as the English answer, in the same order', () => {
    for (const entry of knowledge.entries) {
      expect(measurements(String(japanese(entry)?.answer)), entry.title).toEqual(measurements(entry.answer));
    }
  });

  it('gives no personalization time of its own either', () => {
    const entry = knowledge.entries.find((candidate) => candidate.category === 'personalization');
    expect(entry && japanese(entry)?.answer).toEqual(expect.any(String));
    expect(String(entry && japanese(entry)?.answer)).not.toMatch(/\d+\s*日/);
  });
});
