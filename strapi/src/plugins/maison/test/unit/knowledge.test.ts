import { describe, expect, it } from 'vitest';
import { MAX_RESULTS, rankKnowledge, scoreEntry, searchTerms, type KnowledgeEntry } from '../../server/src/domain/knowledge';

const entry = (title: string, extra: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  title, answer: '', category: 'care', productSlugs: [], keywords: '', ...extra,
});
const titles = (entries: KnowledgeEntry[]) => entries.map((found) => found.title);

describe('searchTerms', () => {
  it('keeps the words that name a topic, in lower case, without punctuation or stop words', () => {
    expect(searchTerms('How do I care for the LEATHER?', 'en')).toEqual(['care', 'leather']);
  });

  it('counts a plural as its singular, so "repairs" finds "repair"', () => {
    expect(searchTerms('Returns and repairs', 'en')).toEqual(['return', 'repair']);
  });

  it('has nothing to search for in a question of stop words or punctuation', () => {
    expect(searchTerms('?', 'en')).toEqual([]);
    expect(searchTerms('What is it?', 'en')).toEqual([]);
  });

  it('splits a Japanese question into words, without particles', () => {
    const terms = searchTerms('革製品のお手入れ方法を教えてください', 'ja');
    expect(terms).toContain('手入れ');
    expect(terms).not.toContain('の');
    expect(terms).not.toContain('を');
  });
});

describe('scoreEntry', () => {
  it('counts a word in the title most, then in the keywords, then in the answer', () => {
    expect(scoreEntry(entry('Leather care'), ['leather'])).toBe(3);
    expect(scoreEntry(entry('Care', { keywords: 'leather, balm' }), ['leather'])).toBe(2);
    expect(scoreEntry(entry('Care', { answer: 'Wipe the leather.' }), ['leather'])).toBe(1);
    expect(scoreEntry(entry('Care'), ['leather'])).toBe(0);
  });

  it('counts each word once, by the best place it is in', () => {
    expect(scoreEntry(entry('Leather care', { keywords: 'leather', answer: 'leather' }), ['leather'])).toBe(3);
  });
});

describe('rankKnowledge', () => {
  const leather = entry('How do I care for the leather?', { keywords: 'leather, clean, wipe' });
  const canvas = entry('How do I clean the canvas?', { keywords: 'canvas, clean', productSlugs: ['voyage-trunk-110'] });
  const repairs = entry('Do you repair Maison pieces?', { category: 'repairs', keywords: 'repair, fix' });
  const cabin = entry('Will the Cabin Case 55 fit in an overhead bin?', { category: 'sizing', keywords: 'fit, overhead', productSlugs: ['cabin-case-55'] });
  const tote = entry('Does the Tote Soleil fit a laptop?', { category: 'sizing', keywords: 'fit, laptop', productSlugs: ['tote-soleil'] });
  const all = [leather, canvas, repairs, cabin, tote];

  it('puts the best entry first', () => {
    expect(titles(rankKnowledge(all, 'How do I care for the leather?', 'en'))).toEqual(['How do I care for the leather?']);
  });

  it('finds an entry worded differently from the question', () => {
    expect(titles(rankKnowledge(all, 'Do you do repairs?', 'en'))).toEqual(['Do you repair Maison pieces?']);
  });

  it('returns none when no word matches, and none for a question of stop words', () => {
    expect(rankKnowledge(all, 'Can I pay in bitcoin?', 'en')).toEqual([]);
    expect(rankKnowledge(all, 'What is it?', 'en')).toEqual([]);
  });

  it('returns at most four entries', () => {
    const many = Array.from({ length: 6 }, (_, index) => entry(`Leather note ${index}`));
    expect(rankKnowledge(many, 'leather', 'en')).toHaveLength(4);
    expect(MAX_RESULTS).toBe(4);
  });

  it('puts entries that score the same in title order', () => {
    const second = entry('Leather note B');
    const first = entry('Leather note A');
    expect(titles(rankKnowledge([second, first], 'leather', 'en'))).toEqual(['Leather note A', 'Leather note B']);
  });

  it("orders entries that score the same the way the search's language sorts titles, not the host's", () => {
    // In Swedish Ä sorts after Z; in English it sorts with A.
    const zebra = entry('Zebra leather');
    const apple = entry('Äpple leather');
    expect(titles(rankKnowledge([zebra, apple], 'leather', 'en'))).toEqual(['Äpple leather', 'Zebra leather']);
    expect(titles(rankKnowledge([apple, zebra], 'leather', 'sv'))).toEqual(['Zebra leather', 'Äpple leather']);
  });

  it("with products, leaves out entries about other pieces, keeps general ones, and ranks the piece's own first", () => {
    const general = entry('Does it fit? General sizing', { category: 'sizing', keywords: 'fit' });
    expect(titles(rankKnowledge([...all, general], 'Will it fit?', 'en', ['cabin-case-55']))).toEqual([
      'Will the Cabin Case 55 fit in an overhead bin?',
      'Does it fit? General sizing',
    ]);
  });

  it('never returns an entry only because it is about the piece, when none of its words match', () => {
    expect(rankKnowledge(all, 'Can I pay in bitcoin?', 'en', ['cabin-case-55'])).toEqual([]);
  });
});
