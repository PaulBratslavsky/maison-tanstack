// Intl.Segmenter is ES2022. Strapi's base tsconfig only declares ES2020, but every Node that Strapi 5 runs on has it.
/// <reference lib="es2022.intl" />

/** A product knowledge entry as the search reads it. */
export interface KnowledgeEntry {
  title: string;
  answer: string;
  category: string;
  productSlugs: string[];
  keywords: string;
}

/** The most entries a search returns. */
export const MAX_RESULTS = 4;

const TITLE = 3;
const KEYWORDS = 2;
const ANSWER = 1;
const PRODUCT_BONUS = 2;

/** Words that name no topic: an English question's glue, and a few Japanese question words. */
const STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'at', 'be', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'get',
  'has', 'have', 'hello', 'hi', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'maison', 'me', 'my', 'need', 'of', 'on', 'or',
  'please', 'should', 'so', 'thank', 'thanks', 'that', 'the', 'there', 'these', 'this', 'those', 'to', 'want', 'was', 'we',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
  '何', 'ください', 'どのくらい', 'どれくらい', 'について',
]);
const HIRAGANA_ONLY = /^[\u3040-\u309f]+$/u;

/** NFKC folds full-width letters and digits, and case doesn't count. */
const normalize = (text: string) => text.normalize('NFKC').toLowerCase();

/** A plural "s" doesn't count either: "returns" finds "return", "cards" finds "card". */
const singular = (word: string) => (/^[a-z]{4,}$/.test(word) && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

/**
 * The words of a question worth searching for. Intl.Segmenter splits them, Japanese included, and what's left out is
 * punctuation, stop words, single letters and digits, and Japanese particles and endings (one or two hiragana).
 */
export const searchTerms = (query: string, locale: string): string[] => {
  const terms = new Set<string>();
  for (const { segment, isWordLike } of new Intl.Segmenter(locale, { granularity: 'word' }).segment(normalize(query))) {
    if (!isWordLike || STOPWORDS.has(segment) || /^[a-z0-9]$/.test(segment)) continue;
    if (HIRAGANA_ONLY.test(segment) && segment.length <= 2) continue;
    terms.add(singular(segment));
  }
  return [...terms];
};

/** How well an entry answers: each term counts once, by the best field it's in. 0 when no term matches. */
export const scoreEntry = (entry: KnowledgeEntry, terms: string[]): number => {
  const title = normalize(entry.title);
  const keywords = normalize(entry.keywords);
  const answer = normalize(entry.answer);
  return terms.reduce(
    (score, term) => score + (title.includes(term) ? TITLE : keywords.includes(term) ? KEYWORDS : answer.includes(term) ? ANSWER : 0),
    0
  );
};

/**
 * The entries that answer `query` best, at most MAX_RESULTS. With productSlugs, only the entries about those pieces and
 * the general ones (no productSlugs), and a piece's own entries rank higher. An entry none of the question's words
 * match is never returned, so a question Maison hasn't written about gets none.
 */
export const rankKnowledge = (entries: KnowledgeEntry[], query: string, locale: string, productSlugs: string[] = []): KnowledgeEntry[] => {
  const terms = searchTerms(query, locale);
  if (terms.length === 0) return [];
  const asked = new Set(productSlugs);
  const aboutAsked = (entry: KnowledgeEntry) => entry.productSlugs.some((slug) => asked.has(slug));
  return entries
    .filter((entry) => asked.size === 0 || entry.productSlugs.length === 0 || aboutAsked(entry))
    .map((entry) => {
      const words = scoreEntry(entry, terms);
      return { entry, score: words > 0 && aboutAsked(entry) ? words + PRODUCT_BONUS : words };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, locale))
    .slice(0, MAX_RESULTS)
    .map(({ entry }) => entry);
};
