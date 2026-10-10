import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import content from '../../server/seed/content.json';

const imagesDir = fileURLToPath(new URL('../../server/seed/images/', import.meta.url));

/** The image file of every catalog entry, as the seed service uploads them. */
const named = [...content.boutiques, ...content.collections, ...content.products].map((entry) => entry.image);

/** What the folder holds: the images, and SOURCES.md (their credits). Hidden OS files such as .DS_Store don't count. */
const inFolder = readdirSync(imagesDir).filter((name) => name !== 'SOURCES.md' && !name.startsWith('.'));

describe('seed images', () => {
  it('has a file for every image content.json names', () => {
    expect(named.filter((name) => !inFolder.includes(name))).toEqual([]);
  });

  it('has no file that content.json does not name', () => {
    expect(inFolder.filter((name) => !named.includes(name))).toEqual([]);
  });
});
