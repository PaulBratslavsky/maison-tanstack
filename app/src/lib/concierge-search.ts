import { pieceSlugOf } from './piece-slug';

/**
 * The concierge route's search parameters (its validateSearch): only `product`, the piece the customer asked from ("Ask
 * about this piece" on a product's page). The router reads a value that looks like a number (?product=2024) as one, so a
 * whole number counts as text. A value that is not a product slug is dropped, so nothing else reaches the page or the
 * server's instructions. Without a piece the result has no `product` key, so /concierge stays /concierge.
 */
export const conciergeSearch = (search: Record<string, unknown>): { product?: string } => {
  const value = typeof search.product === 'number' && Number.isSafeInteger(search.product) && search.product >= 0 ? String(search.product) : search.product;
  const product = pieceSlugOf(value);
  return product ? { product } : {};
};
