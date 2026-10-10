import { describe, expect, it } from 'vitest';
import contentTypes from '../../server/src/content-types';

type Attribute = { type: string; maxLength?: number };

/**
 * Strapi keeps a `string`, an `email`, a `uid` and a `password` attribute in a `string()` column (schema.js,
 * getColumnType), which is varchar(255) on Postgres, the database Strapi Cloud runs. `maxLength` only validates what is
 * written: it doesn't widen the column. SQLite doesn't enforce the width, so a longer value passes every local check
 * and fails only on Cloud, where the write throws. A `text` attribute is a `text` column.
 */
const VARCHAR_255 = ['string', 'email', 'uid', 'password'];

describe('the content types', () => {
  const attributes = Object.entries(contentTypes).flatMap(([name, { schema }]) =>
    Object.entries(schema.attributes as Record<string, Attribute>).map(([attribute, spec]) => ({ name: `${name}.${attribute}`, ...spec }))
  );

  it('give no varchar(255) attribute a maxLength above 255: a value that can be longer is a text attribute', () => {
    const tooLong = attributes
      .filter(({ type, maxLength }) => VARCHAR_255.includes(type) && (maxLength ?? 0) > 255)
      .map(({ name, type, maxLength }) => `${name} is a ${type} with a maxLength of ${maxLength}`);

    expect(tooLong).toEqual([]);
  });

  // The guard above looks at every attribute of every content type: this keeps it from passing because it looked at none.
  it('are all looked at by that guard', () => {
    const looked = [...new Set(attributes.map(({ name }) => name.split('.')[0]))];
    expect(looked.sort()).toEqual(Object.keys(contentTypes).sort());
    expect(Object.keys(contentTypes)).toContain('inquiry');
  });
});
