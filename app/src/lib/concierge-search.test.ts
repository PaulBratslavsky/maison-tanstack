import { describe, expect, it } from 'vitest';

import { conciergeSearch } from './concierge-search';

describe('conciergeSearch', () => {
  it('keeps a piece given as ?product=', () => {
    expect(conciergeSearch({ product: 'weekender-50' })).toEqual({ product: 'weekender-50' });
  });

  it('reads a slug the router parsed as a number, so a piece whose slug is all digits still counts', () => {
    expect(conciergeSearch({ product: 2024 })).toEqual({ product: '2024' });
  });

  it('has no product when there is none, or it is not a slug: nothing else reaches the page or the instructions', () => {
    for (const product of [undefined, '', 'Weekender 50', '../x', 'a'.repeat(121), null, true, ['weekender-50'], { a: 1 }, -1.5]) {
      expect(conciergeSearch({ product }), String(product)).toEqual({});
    }
  });

  it('drops every other parameter', () => {
    expect(conciergeSearch({ product: 'cabin-case-55', other: 'x' })).toEqual({ product: 'cabin-case-55' });
  });
});
