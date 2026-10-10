import { describe, expect, it } from 'vitest';
import knowledge from '../../server/seed/knowledge.json';
import { englishData, japaneseData, japaneseToAdd, type SeedKnowledgeEntry } from '../../server/src/domain/knowledge-seed';

/** A seed entry with these English and Japanese titles, and the rest made up. */
const seedEntry = (title: string, jaTitle: string): SeedKnowledgeEntry => ({
  category: 'care',
  productSlugs: ['cabin-case-55'],
  title,
  answer: `${title} answer`,
  keywords: `${title} keywords`,
  ja: { title: jaTitle, answer: `${jaTitle}の回答`, keywords: `${jaTitle}, キーワード` },
});

const leather = seedEntry('How do I care for the leather?', '革のお手入れはどうすればよいですか？');
const gift = seedEntry('Do you gift wrap?', 'ギフト包装はしていただけますか？');
const entries = [leather, gift];

/** Nothing found yet: no English document with a seed title, none with Japanese, no answers. */
const none = { english: [], withJapanese: [], answers: [] };

describe('englishData', () => {
  it("is the entry's English fields, without its Japanese version", () => {
    expect(englishData(leather)).toEqual({
      category: 'care',
      productSlugs: ['cabin-case-55'],
      title: 'How do I care for the leather?',
      answer: 'How do I care for the leather? answer',
      keywords: 'How do I care for the leather? keywords',
    });
  });
});

describe('japaneseData', () => {
  it("is the Japanese title, answer and keywords only: the category and the products are shared, and Strapi copies them from the English version", () => {
    expect(japaneseData(leather)).toEqual({
      title: '革のお手入れはどうすればよいですか？',
      answer: '革のお手入れはどうすればよいですか？の回答',
      keywords: '革のお手入れはどうすればよいですか？, キーワード',
    });
  });
});

describe('japaneseToAdd', () => {
  it('gives each entry\'s Japanese data to the English document with its title', () => {
    const english = [
      { documentId: 'k2', title: 'Do you gift wrap?' },
      { documentId: 'k1', title: 'How do I care for the leather?' },
    ];
    expect(japaneseToAdd(entries, { ...none, english })).toEqual([
      { documentId: 'k1', data: japaneseData(leather) },
      { documentId: 'k2', data: japaneseData(gift) },
    ]);
  });

  it('adds nothing for a document that has a Japanese version already, so a second press adds nothing', () => {
    const english = [
      { documentId: 'k1', title: 'How do I care for the leather?' },
      { documentId: 'k2', title: 'Do you gift wrap?' },
    ];
    expect(japaneseToAdd(entries, { ...none, english, withJapanese: ['k1'] })).toEqual([{ documentId: 'k2', data: japaneseData(gift) }]);
    expect(japaneseToAdd(entries, { ...none, english, withJapanese: ['k1', 'k2'] })).toEqual([]);
  });

  it('skips an entry whose English title staff changed, even only its capitals or spaces, and adds nothing in its place', () => {
    for (const changed of ['Leather care', 'How do I care for the Leather?', 'How do I care for the leather? ']) {
      const english = [
        { documentId: 'k1', title: changed },
        { documentId: 'k2', title: 'Do you gift wrap?' },
      ];
      expect(japaneseToAdd(entries, { ...none, english }), changed).toEqual([{ documentId: 'k2', data: japaneseData(gift) }]);
    }
  });

  it('adds nothing when no English document has a seed title', () => {
    expect(japaneseToAdd(entries, none)).toEqual([]);
  });

  it('never touches an entry that a staff answer created, even one with a seed title', () => {
    const english = [
      { documentId: 'answer-1', title: 'Do you gift wrap?' },
      { documentId: 'k2', title: 'Do you gift wrap?' },
    ];
    expect(japaneseToAdd(entries, { ...none, english, answers: ['answer-1'] })).toEqual([{ documentId: 'k2', data: japaneseData(gift) }]);
    expect(japaneseToAdd(entries, { ...none, english: [english[0]], answers: ['answer-1'] })).toEqual([]);
  });

  it('with two English documents of the same title, adds to the first one read, and to neither once either has a Japanese version', () => {
    const english = [
      { documentId: 'k7', title: 'Do you gift wrap?' },
      { documentId: 'k2', title: 'Do you gift wrap?' },
    ];
    expect(japaneseToAdd(entries, { ...none, english })).toEqual([{ documentId: 'k7', data: japaneseData(gift) }]);
    expect(japaneseToAdd(entries, { ...none, english, withJapanese: ['k2'] })).toEqual([]);
  });

  it('matches all sixteen seed entries to their documents', () => {
    const seed = knowledge.entries as SeedKnowledgeEntry[];
    const english = seed.map((entry, index) => ({ documentId: `k${index + 1}`, title: entry.title })).reverse();
    const added = japaneseToAdd(seed, { ...none, english });
    expect(added).toHaveLength(16);
    expect(added).toEqual(seed.map((entry, index) => ({ documentId: `k${index + 1}`, data: entry.ja })));
  });
});
