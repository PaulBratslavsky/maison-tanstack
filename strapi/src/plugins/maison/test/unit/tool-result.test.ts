import { describe, expect, it } from 'vitest';
import { toolError, toolSuccess } from '../../server/src/domain/tool-result';

describe('toolError', () => {
  it('returns an isError result whose text is the error JSON', () => {
    const result = toolError('not_found', 'No product "x".', 'Call search_products to find valid slugs.');
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: { code: 'not_found', message: 'No product "x".', hint: 'Call search_products to find valid slugs.' },
    });
    expect('structuredContent' in result).toBe(false);
  });
});

describe('toolSuccess', () => {
  it('returns the data as structuredContent and as JSON text', () => {
    const data = { locale: 'ja', total: 0, products: [] };
    const result = toolSuccess(data);
    expect(result.structuredContent).toEqual(data);
    expect(JSON.parse(result.content[0].text)).toEqual(data);
    expect('isError' in result).toBe(false);
  });
});
