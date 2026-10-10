import { describe, expect, it } from 'vitest';

import { visitsSearch } from './visit-search';

describe('visitsSearch', () => {
  it('keeps a reference given as ?ref=', () => {
    expect(visitsSearch({ ref: 'APT-1234' })).toEqual({ ref: 'APT-1234' });
  });

  it('reads a reference the router parsed as a number, so the highlight still works', () => {
    expect(visitsSearch({ ref: 1234 })).toEqual({ ref: '1234' });
  });

  it('has no ref when there is none, or it is blank', () => {
    expect(visitsSearch({})).toEqual({ ref: undefined });
    expect(visitsSearch({ ref: '' })).toEqual({ ref: undefined });
    expect(visitsSearch({ ref: '   ' })).toEqual({ ref: undefined });
  });

  it('drops a ref that is not text or a number, and every other parameter', () => {
    expect(visitsSearch({ ref: { a: 1 }, other: 'x' })).toEqual({ ref: undefined });
    expect(visitsSearch({ ref: ['APT-1'] })).toEqual({ ref: undefined });
    expect(visitsSearch({ ref: true })).toEqual({ ref: undefined });
  });

  it('drops a ref that is too long to be one', () => {
    expect(visitsSearch({ ref: 'A'.repeat(200) })).toEqual({ ref: undefined });
  });
});
