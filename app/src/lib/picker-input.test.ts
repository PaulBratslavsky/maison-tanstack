import { describe, expect, it } from 'vitest';

import { pickerInputOf } from './picker-input';
import { pickerPrefill } from './visit-picker';

const NOW = new Date('2026-10-07T03:00:00Z');

describe('pickerInputOf', () => {
  it("tidies the call as the server does: case and spaces don't count, blanks and nulls are not given, a locale is ignored", () => {
    expect(pickerInputOf({ productSlugs: ['weekender-50'], boutique: ' Ginza ', date: '', time: null, locale: 'en' })).toEqual({ productSlugs: ['weekender-50'], boutique: 'ginza' });
  });

  it('gives the tidied value to the prefill, so a time with spaces is not dropped to the default', () => {
    const input = { productSlugs: ['weekender-50'], time: ' 16:30 ', boutique: ' Omotesando ' };
    expect(pickerPrefill(input, NOW)).toMatchObject({ boutique: 'ginza', time: '14:00' });
    expect(pickerPrefill(pickerInputOf(input), NOW)).toMatchObject({ boutique: 'omotesando', time: '16:30' });
  });

  it('keeps the tidied input when the schema refuses it, and passes anything that is not an object through', () => {
    expect(pickerInputOf({ productSlugs: ['Weekender 50'], boutique: ' Ginza ' })).toEqual({ productSlugs: ['Weekender 50'], boutique: 'ginza' });
    expect(pickerInputOf(null)).toBeNull();
    expect(pickerInputOf('weekender-50')).toBe('weekender-50');
  });
});
