import { describe, expect, it } from 'vitest';

import { readStoredLocale, resolveLocale, storeLocale } from './locale';

/** A Storage stand-in backed by a Map: the two methods the module uses. */
const memoryStorage = (entries: Record<string, string> = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
};
const throwingStorage = {
  getItem: (): string | null => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem: (): void => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  },
};

describe('resolveLocale', () => {
  it("prefers the customer's own choice over LINE's language and the demo default", () => {
    expect(resolveLocale({ override: 'ja', signedIn: 'en', demo: 'en' })).toBe('ja');
    expect(resolveLocale({ override: 'en', signedIn: 'ja', demo: 'ja' })).toBe('en');
  });

  it("uses LINE's language when there's no choice", () => {
    expect(resolveLocale({ override: null, signedIn: 'ja', demo: 'en' })).toBe('ja');
    expect(resolveLocale({ override: null, signedIn: 'en', demo: 'ja' })).toBe('en');
  });

  it('falls back to the demo default before sign-in', () => {
    expect(resolveLocale({ override: null, signedIn: null, demo: 'ja' })).toBe('ja');
    expect(resolveLocale({ override: null, signedIn: null, demo: 'en' })).toBe('en');
  });

  it('reads the demo default the way LINE languages are read (toLocale)', () => {
    expect(resolveLocale({ override: null, signedIn: null, demo: 'ja-JP' })).toBe('ja');
    expect(resolveLocale({ override: null, signedIn: null, demo: 'en-US' })).toBe('en');
    expect(resolveLocale({ override: null, signedIn: null, demo: '' })).toBe('en');
  });
});

describe('readStoredLocale', () => {
  it("returns the language stored under 'maison.locale'", () => {
    expect(readStoredLocale(memoryStorage({ 'maison.locale': 'ja' }))).toBe('ja');
    expect(readStoredLocale(memoryStorage({ 'maison.locale': 'en' }))).toBe('en');
  });

  it("ignores a junk value, or a value under another key", () => {
    for (const junk of ['fr', 'JA', 'ja-JP', '', 'null']) expect(readStoredLocale(memoryStorage({ 'maison.locale': junk }))).toBeNull();
    expect(readStoredLocale(memoryStorage({ locale: 'ja' }))).toBeNull();
  });

  it('returns null without storage, or when storage throws, and never throws', () => {
    expect(readStoredLocale(null)).toBeNull();
    expect(() => readStoredLocale(throwingStorage)).not.toThrow();
    expect(readStoredLocale(throwingStorage)).toBeNull();
  });
});

describe('storeLocale', () => {
  it("stores the choice under 'maison.locale', for readStoredLocale to find", () => {
    const storage = memoryStorage();
    storeLocale(storage, 'ja');
    expect(storage.map.get('maison.locale')).toBe('ja');
    expect(readStoredLocale(storage)).toBe('ja');
  });

  it('never throws, without storage or when storage refuses', () => {
    expect(() => storeLocale(null, 'en')).not.toThrow();
    expect(() => storeLocale(throwingStorage, 'en')).not.toThrow();
  });
});
