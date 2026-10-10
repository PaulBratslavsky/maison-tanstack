/** Validates a JSON field that must be an array of distinct allowed strings. Returns an error message or null. */
export function validateEnumArray(value: unknown, allowed: readonly string[], field: string): string | null {
  if (!Array.isArray(value)) return `${field} must be an array of: ${allowed.join(', ')}`;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.includes(item)) {
      return `${field} contains "${String(item)}"; allowed values are: ${allowed.join(', ')}`;
    }
    if (seen.has(item)) return `${field} lists "${item}" more than once`;
    seen.add(item);
  }
  return null;
}

const SLUG = /^[a-z0-9-]+$/;

/** Validates a JSON field that must be an array of distinct product slugs, such as "weekender-50". Returns an error message or null. */
export function validateSlugArray(value: unknown, field: string): string | null {
  if (!Array.isArray(value)) return `${field} must be an array of product slugs, e.g. ["weekender-50"]`;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !SLUG.test(item)) return `${field} contains ${JSON.stringify(item)}; use product slugs like "weekender-50"`;
    if (seen.has(item)) return `${field} lists "${item}" more than once`;
    seen.add(item);
  }
  return null;
}
