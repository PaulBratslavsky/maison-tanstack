/** Which of a route's query parameters are numbers, booleans or lists. Every other parameter stays text. */
export interface QueryDecoding {
  numbers?: readonly string[];
  booleans?: readonly string[];
  /** A list repeats its parameter, ?productSlugs=a&productSlugs=b, and a single one is a list of one. */
  lists?: readonly string[];
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const toNumber = (value: unknown) => (typeof value === 'string' && NUMBER.test(value) ? Number(value) : value);
const toBoolean = (value: unknown) => (value === 'true' ? true : value === 'false' ? false : value);
const toList = (value: unknown) => (typeof value === 'string' ? [value] : value);

/**
 * A query string, as Strapi parsed it with qs, in the types a shared schema expects. A value that doesn't decode stays
 * as it came, so the schema rejects it with its own message rather than the route guessing what was meant.
 */
export const fromQuery = (query: Record<string, unknown> | undefined, decoding: QueryDecoding = {}): Record<string, unknown> => {
  const input: Record<string, unknown> = { ...query };
  const decode = (keys: readonly string[] | undefined, to: (value: unknown) => unknown) => {
    for (const key of keys ?? []) if (input[key] !== undefined) input[key] = to(input[key]);
  };
  decode(decoding.numbers, toNumber);
  decode(decoding.booleans, toBoolean);
  decode(decoding.lists, toList);
  return input;
};
