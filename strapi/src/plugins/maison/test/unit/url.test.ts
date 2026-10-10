import { describe, expect, it } from 'vitest';
import { absoluteUrl } from '../../server/src/domain/url';

describe('absoluteUrl', () => {
  it('prefixes relative upload paths with the public server URL', () => {
    expect(absoluteUrl('/uploads/a.png', 'https://cms.example.com/')).toBe('https://cms.example.com/uploads/a.png');
  });

  it('keeps absolute URLs', () => {
    expect(absoluteUrl('https://cdn.example.com/a.png', 'https://cms.example.com')).toBe('https://cdn.example.com/a.png');
  });

  it('leaves the path relative when no absolute server URL is configured', () => {
    expect(absoluteUrl('/uploads/a.png', undefined)).toBe('/uploads/a.png');
    expect(absoluteUrl('/uploads/a.png', '/')).toBe('/uploads/a.png');
  });

  it('returns null for missing values', () => {
    expect(absoluteUrl(undefined, 'https://cms.example.com')).toBeNull();
    expect(absoluteUrl('', 'https://cms.example.com')).toBeNull();
  });
});
