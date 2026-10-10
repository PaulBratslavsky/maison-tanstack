/** The longest reference the screen accepts from the address: real ones are a few characters. */
const MAX_REF = 64;

/**
 * My visits' search parameters (the route's validateSearch): only `ref`, the visit just requested, which the screen puts
 * on the wash. The router reads a value that looks like a number (?ref=1234) as one, so a number counts as text. Anything
 * else is dropped, so a stray or hostile value never reaches the screen.
 */
export const visitsSearch = (search: Record<string, unknown>): { ref?: string } => {
  const value = typeof search.ref === 'number' && Number.isFinite(search.ref) ? String(search.ref) : search.ref;
  const ref = typeof value === 'string' ? value.trim() : '';
  return { ref: ref !== '' && ref.length <= MAX_REF ? ref : undefined };
};
