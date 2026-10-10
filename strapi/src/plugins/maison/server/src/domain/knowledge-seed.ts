/** The localized fields of a product knowledge entry: its version in one language. */
export interface KnowledgeVersion {
  title: string;
  answer: string;
  keywords: string;
}

/**
 * A product knowledge entry as server/seed/knowledge.json has it: the English version with the fields every locale
 * shares (the category and the products), and `ja`, its Japanese version.
 */
export interface SeedKnowledgeEntry extends KnowledgeVersion {
  category: string;
  productSlugs: string[];
  ja: KnowledgeVersion;
}

/** The English document's data: the entry without its Japanese version. */
export const englishData = ({ ja: _ja, ...english }: SeedKnowledgeEntry): Omit<SeedKnowledgeEntry, 'ja'> => english;

/**
 * The Japanese version's data: its title, answer and keywords only. The category and the products are shared by every
 * locale, and Strapi copies them from the English version when it creates the Japanese one, so staff's changes to them
 * stay as they are.
 */
export const japaneseData = ({ ja }: SeedKnowledgeEntry): KnowledgeVersion => ({ title: ja.title, answer: ja.answer, keywords: ja.keywords });

/** What Load demo catalog read before it adds the Japanese versions. */
export interface KnowledgeFound {
  /** The English documents titled as a seed entry, in the order Strapi gave them. */
  english: Array<{ documentId: string; title: string }>;
  /** The documents among them that have a Japanese version already. */
  withJapanese: string[];
  /** The documents among them that staff added by answering a customer's question. */
  answers: string[];
}

/**
 * The Japanese versions to add: for each seed entry, the English document with its exact title gets the entry's Japanese
 * data. An entry is skipped when no English document has its title (staff changed it), and when one with its title has
 * a Japanese version already, so a second press adds nothing. A document that a staff answer added is never one of
 * them, even with a seed title. With two documents of the same title, the first one read gets it.
 */
export const japaneseToAdd = (
  entries: SeedKnowledgeEntry[],
  { english, withJapanese, answers }: KnowledgeFound
): Array<{ documentId: string; data: KnowledgeVersion }> => {
  const translated = new Set(withJapanese);
  const answered = new Set(answers);
  return entries.flatMap((entry) => {
    const titled = english.filter((doc) => doc.title === entry.title && !answered.has(doc.documentId));
    if (titled.length === 0 || titled.some((doc) => translated.has(doc.documentId))) return [];
    return [{ documentId: titled[0].documentId, data: japaneseData(entry) }];
  });
};
