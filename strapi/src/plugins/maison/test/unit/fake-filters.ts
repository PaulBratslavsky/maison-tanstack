type Doc = Record<string, any>;

/** Each operator the services use, as it holds for the row's value. As in SQL, a value that is null or missing never meets `$ne`, `$gte`, `$lt` or `$lte`. */
const OPERATORS: Record<string, (value: any, expected: any) => boolean> = {
  $eq: (value, expected) => value === expected,
  $ne: (value, expected) => value != null && value !== expected,
  $in: (value, expected) => expected.includes(value),
  $gte: (value, expected) => value != null && value >= expected,
  $lt: (value, expected) => value != null && value < expected,
  $lte: (value, expected) => value != null && value <= expected,
};

/**
 * Whether a row meets Strapi filters, for the tests' stand-ins of the Document Service. It knows the operators the
 * services use, on fields of the row itself: `$eq`, `$ne`, `$in`, `$gte`, `$lt`, `$lte`, and `$or` over a list of
 * filters. A condition with several operators needs every one to hold, as `{ $gte, $lt }` for a day does. Another
 * operator is a mistake in the service or in the test, so it throws, whichever place it has in the condition.
 */
export const matches = (row: Doc, filters: Doc = {}): boolean =>
  Object.entries(filters).every(([field, condition]: [string, any]) => {
    if (field === '$or') return (condition as Doc[]).some((branch) => matches(row, branch));
    const checks = Object.entries(condition);
    if (checks.length === 0) throw new Error(`These tests don't know the filter ${field}: ${JSON.stringify(condition)}`);
    // Every check runs before the answer is read, so an unknown operator throws even when an earlier one already failed.
    const held = checks.map(([operator, expected]) => {
      const holds = OPERATORS[operator];
      if (!holds) throw new Error(`These tests don't know the filter ${field}: ${JSON.stringify({ [operator]: expected })}`);
      return holds(row[field], expected);
    });
    return held.every(Boolean);
  });
