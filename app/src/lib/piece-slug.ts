// Its own module, with no imports, because the concierge page checks ?product= with it. Imported from lib/concierge.ts
// instead, the page would bundle that file's zod schema (a call at the top level, which no bundler drops) into the
// browser: about 60 kB gzipped more on that page. lib/concierge.ts exports it too, and its tests are there.

/** A product's slug, as the Maison tools accept one (slugInput): lower-case letters, digits and hyphens. */
const PIECE_SLUG = /^[a-z0-9-]+$/;

/** The piece the customer is asking about, from the concierge page's ?product=, or null when it isn't a slug. */
export const pieceSlugOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length <= 120 && PIECE_SLUG.test(value) ? value : null;
