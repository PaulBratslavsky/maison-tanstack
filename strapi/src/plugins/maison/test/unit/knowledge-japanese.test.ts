import { describe, expect, it } from 'vitest';
import knowledge from '../../server/seed/knowledge.json';
import { rankKnowledge, scoreEntry, searchTerms, type KnowledgeEntry } from '../../server/src/domain/knowledge';

type Japanese = { title: string; answer: string; keywords: string };

/** An entry's Japanese version as the seed has it, or none. */
const japaneseOf = (entry: (typeof knowledge.entries)[number]): Japanese | undefined => (entry as { ja?: Japanese }).ja;

/**
 * The seeded entries as a search in ja reads them: the Japanese title, answer and keywords, with the category and the
 * products, which every locale shares. An entry without a Japanese version has nothing to match.
 */
const japaneseEntries: KnowledgeEntry[] = knowledge.entries.map((entry) => ({
  category: entry.category,
  productSlugs: entry.productSlugs,
  title: japaneseOf(entry)?.title ?? '',
  answer: japaneseOf(entry)?.answer ?? '',
  keywords: japaneseOf(entry)?.keywords ?? '',
}));

/** The seeded entries in English, as a search in en reads them. */
const englishEntries: KnowledgeEntry[] = knowledge.entries.map(({ category, productSlugs, title, answer, keywords }) => ({
  category, productSlugs, title, answer, keywords,
}));

/** The Japanese title of the entry with this English title. */
const japaneseTitle = (englishTitle: string) => japaneseOf(knowledge.entries.find((entry) => entry.title === englishTitle)!)?.title;

/** The brief's ten questions, as a customer would type them in a Japanese chat, and the entry each is about. */
const BRIEF_QUESTIONS: Array<[string, string]> = [
  ['革のお手入れ方法を教えてください', 'How do I care for the leather?'],
  ['キャンバスの汚れはどう落とせばいいですか？', 'How do I clean the canvas?'],
  ['キャビンケース55は機内に持ち込めますか？', 'Will the Cabin Case 55 fit in an airline overhead bin?'],
  ['名入れはできますか？何日かかりますか？', 'Can I personalize a piece, and how long does it take?'],
  ['配送してもらえますか？', 'Do you deliver, and can I collect in a boutique?'],
  ['返品や交換はできますか？', 'Can I return or exchange a piece?'],
  ['修理は受け付けていますか？', 'Do you repair Maison pieces?'],
  ['保証はありますか？', 'Is there a warranty?'],
  ['ギフト包装はできますか？', 'Do you gift wrap?'],
  ['来店に予約は必要ですか？', 'Do I need an appointment to visit a boutique?'],
];

/** One question for each of the other six entries. */
const OTHER_QUESTIONS: Array<[string, string]> = [
  ['使わない間、トランクはどこに保管すればいいですか？', 'How should I store a trunk or hard case?'],
  ['どんな素材で作られていますか？', "What are Maison's pieces made of?"],
  ['トートバッグにノートパソコンは入りますか？', 'Does the Tote Soleil fit a laptop?'],
  ['ウィークエンダーには何泊分の荷物が入りますか？', 'How much does the Weekender 50 hold?'],
  ['財布にはカードが何枚入りますか？', 'How many cards do the wallet and card case hold?'],
  ['ウォッチロールに腕時計は何本入りますか？', 'Will my watches fit in the Watch Roll Trois?'],
];

describe('a Japanese question, over the seeded product knowledge in Japanese', () => {
  it('covers every seeded entry, once', () => {
    const covered = [...BRIEF_QUESTIONS, ...OTHER_QUESTIONS].map(([, englishTitle]) => englishTitle);
    expect([...covered].sort()).toEqual(knowledge.entries.map((entry) => entry.title).sort());
  });

  it.each([...BRIEF_QUESTIONS, ...OTHER_QUESTIONS])('「%s」 finds "%s" first, ahead of every other entry', (question, englishTitle) => {
    const expected = japaneseTitle(englishTitle);
    expect(expected).toEqual(expect.any(String));
    const [first, second] = rankKnowledge(japaneseEntries, question, 'ja');
    expect(first?.title).toBe(expected);
    // It wins on its score, not on the title order that settles a tie.
    if (second) {
      const terms = searchTerms(question, 'ja');
      expect(scoreEntry(first, terms)).toBeGreaterThan(scoreEntry(second, terms));
    }
  });

  it("finds nothing for the talk's question that Maison hasn't written about, so the concierge hands it to staff", () => {
    expect(rankKnowledge(japaneseEntries, 'ビットコインで支払えますか？', 'ja')).toEqual([]);
  });
});

describe('a Japanese question, over the seeded product knowledge in English', () => {
  // The locales are kept apart by the catalog service, which reads only the question's locale's entries (see
  // catalog-knowledge.test.ts). The ranking itself matches words: a question with digits or Latin letters, like
  // 「キャビンケース55」, can match an English title. These questions have none, and match no English words.
  const withoutLatinOrDigits = BRIEF_QUESTIONS.filter(([question]) => !/[0-9a-zA-Z０-９Ａ-Ｚａ-ｚ]/u.test(question));

  it.each(withoutLatinOrDigits)('「%s」 finds no English entry', (question) => {
    expect(rankKnowledge(englishEntries, question, 'ja')).toEqual([]);
  });

  it('leaves out only the question with digits', () => {
    expect(withoutLatinOrDigits).toHaveLength(BRIEF_QUESTIONS.length - 1);
  });
});
