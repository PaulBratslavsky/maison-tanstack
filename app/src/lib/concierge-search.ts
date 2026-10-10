import { pieceSlugOf } from './piece-slug';

/**
 * The concierge route's search parameters (its validateSearch): only `product`, the piece the customer asked from ("Ask
 * about this piece" on a product's page). The router reads a value that looks like a number (?product=2024) as one, so a
 * whole number counts as text. A value that is not a product slug is dropped, so nothing else reaches the page or the
 * server's instructions. Without a piece, `product` is undefined, and the key is there on purpose: the router merges the
 * parent route's raw search under a validated one, so a key left out would let a raw value such as "Weekender 50" through
 * (visitsSearch does the same with `ref`). An undefined value is left out of the address, so /concierge stays /concierge.
 */
export const conciergeSearch = (search: Record<string, unknown>): { product?: string | undefined } => {
  const value = typeof search.product === 'number' && Number.isSafeInteger(search.product) && search.product >= 0 ? String(search.product) : search.product;
  const product = pieceSlugOf(value);
  return { product: product ?? undefined };
};
