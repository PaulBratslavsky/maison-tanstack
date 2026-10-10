/** The tags customer text is wrapped in, where a model reads it as data. Labelling uses two of them, the Ask tab all four. */
export const FENCED_TAGS = ['customer_message', 'customer_question', 'customer_note', 'concierge_reply'] as const;
export type FencedTag = (typeof FENCED_TAGS)[number];

const TAG_START = new RegExp(`<\\s*(/?)\\s*(${FENCED_TAGS.join('|')})`, 'gi');

/** Customer text, and a reply that quotes it, can't open or close one of the four tags: a `<` before any of their names becomes `&lt;`. */
export const fence = (text: string): string => text.replace(TAG_START, '&lt;$1$2');
