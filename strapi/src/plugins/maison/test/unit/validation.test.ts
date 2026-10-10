import { describe, expect, it } from 'vitest';
import { OCCASIONS } from '../../server/src/constants';
import { validateEnumArray, validateSlugArray } from '../../server/src/domain/validation';

describe('validateEnumArray', () => {
  it('accepts an array of allowed values, including an empty one', () => {
    expect(validateEnumArray(['travel', 'wedding'], OCCASIONS, 'giftOccasions')).toBeNull();
    expect(validateEnumArray([], OCCASIONS, 'giftOccasions')).toBeNull();
  });

  it('rejects unknown values and non-arrays with a message naming the field', () => {
    expect(validateEnumArray(['travel', 'graduation'], OCCASIONS, 'giftOccasions')).toMatch(/giftOccasions.*graduation/);
    expect(validateEnumArray('travel', OCCASIONS, 'giftOccasions')).toMatch(/giftOccasions/);
  });

  it('rejects duplicates', () => {
    expect(validateEnumArray(['travel', 'travel'], OCCASIONS, 'giftOccasions')).toMatch(/more than once/);
  });
});

describe('validateSlugArray', () => {
  it('accepts distinct product slugs, including none', () => {
    expect(validateSlugArray([], 'productSlugs')).toBeNull();
    expect(validateSlugArray(['weekender-50', 'cabin-case-55'], 'productSlugs')).toBeNull();
  });

  it('refuses anything but a list', () => {
    expect(validateSlugArray('weekender-50', 'productSlugs')).toBe('productSlugs must be an array of product slugs, e.g. ["weekender-50"]');
  });

  it('refuses a name or a number in place of a slug, quoting it', () => {
    expect(validateSlugArray(['Weekender 50'], 'productSlugs')).toBe('productSlugs contains "Weekender 50"; use product slugs like "weekender-50"');
    expect(validateSlugArray([50], 'productSlugs')).toBe('productSlugs contains 50; use product slugs like "weekender-50"');
  });

  it('refuses the same slug twice', () => {
    expect(validateSlugArray(['weekender-50', 'weekender-50'], 'productSlugs')).toBe('productSlugs lists "weekender-50" more than once');
  });
});
