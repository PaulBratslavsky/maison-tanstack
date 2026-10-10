import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Every TanStack Start, Router and AI package is pinned to an exact version. A loose range once
// gave the original two copies of @tanstack/ai, and TanStack AI changes its API between minor versions.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>
}

const EXACT = /^\d+\.\d+\.\d+$/

describe('package.json', () => {
  it('pins @tanstack/react-start, react-router and every @tanstack/ai package exactly', () => {
    const pinned = Object.entries(pkg.dependencies).filter(
      ([name]) =>
        name === '@tanstack/react-start' ||
        name === '@tanstack/react-router' ||
        name.startsWith('@tanstack/ai'),
    )
    expect(pinned.map(([name]) => name)).toContain('@tanstack/react-start')
    for (const [name, range] of pinned) {
      expect({ name, range }).toEqual({ name, range: expect.stringMatching(EXACT) })
    }
  })
})
