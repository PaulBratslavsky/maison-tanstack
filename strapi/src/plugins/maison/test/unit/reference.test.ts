import { describe, expect, it } from 'vitest';
import { generateReference } from '../../server/src/domain/reference';

describe('generateReference', () => {
  it('produces APT- followed by four digits', () => {
    expect(generateReference()).toMatch(/^APT-\d{4}$/);
  });

  it('spans APT-1000 to APT-9999', () => {
    expect(generateReference(() => 0)).toBe('APT-1000');
    expect(generateReference(() => 0.99999)).toBe('APT-9999');
  });

  it('is a visit reference unless it is asked for a question one', () => {
    expect(generateReference(() => 0, 'APT')).toBe('APT-1000');
  });

  it('produces Q- followed by four digits for a question', () => {
    expect(generateReference(undefined, 'Q')).toMatch(/^Q-\d{4}$/);
  });

  it('spans Q-1000 to Q-9999 for a question', () => {
    expect(generateReference(() => 0, 'Q')).toBe('Q-1000');
    expect(generateReference(() => 0.99999, 'Q')).toBe('Q-9999');
  });
});
