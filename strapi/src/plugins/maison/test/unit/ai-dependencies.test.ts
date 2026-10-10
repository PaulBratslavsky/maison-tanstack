import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** The TanStack AI set the plan was checked against. Exact: a range lets npm put two copies of the SDK side by side. */
const PINNED = {
  '@tanstack/ai': '0.68.0',
  '@tanstack/ai-anthropic': '0.21.1',
  '@tanstack/ai-ollama': '0.11.16',
} as const;

describe('the TanStack AI packages', () => {
  it.each(Object.entries(PINNED))('pin %s to exactly %s in dependencies', (name, version) => {
    expect(manifest.dependencies[name]).toBe(version);
  });

  it('use no range for any @tanstack package, and name no other', () => {
    const tanstack = Object.entries(manifest.dependencies).filter(([name]) => name.startsWith('@tanstack/'));
    expect(tanstack.map(([name]) => name).sort()).toEqual(Object.keys(PINNED).sort());
    for (const [name, version] of tanstack) expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('are the only way the plugin reaches a model: the Vercel AI SDK is in neither dependencies nor devDependencies', () => {
    const names = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)];
    expect(names.filter((name) => name === 'ai' || name.startsWith('@ai-sdk/'))).toEqual([]);
  });
});
