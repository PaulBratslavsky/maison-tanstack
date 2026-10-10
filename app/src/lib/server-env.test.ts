import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Server code reads STRAPI_URL (and the model settings) from process.env. Vite does not put .env values there by
// itself. TanStack Start's own plugin, 'tanstack-start-core:load-env' in @tanstack/start-plugin-core, does it when the
// config resolves, so it holds for `vite dev`, `vite build` and `vite preview`. A server that runs without Vite, such
// as `node dist/server/server.js`, gets no .env file: the host must set real variables. This test holds that plugin.

type EnvPlugin = { name: string; configResolved: (config: { mode: string; root: string }) => void }

const findPlugin = (list: unknown): EnvPlugin | undefined => {
  for (const item of [list].flat(Infinity) as Array<EnvPlugin | null | false | undefined>) {
    if (item && item.name === 'tanstack-start-core:load-env') return item
  }
  return undefined
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maison-env-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.MAISON_PROBE_FILE
  delete process.env.MAISON_PROBE_SHELL
})

describe("TanStack Start's load-env plugin", () => {
  it('puts .env values that are not VITE_* into process.env', () => {
    writeFileSync(join(root, '.env'), 'MAISON_PROBE_FILE=from-file\n')
    const plugin = findPlugin(tanstackStart())
    expect(plugin).toBeDefined()
    plugin?.configResolved({ mode: 'development', root })
    expect(process.env.MAISON_PROBE_FILE).toBe('from-file')
  })

  it('keeps a variable that the shell already set', () => {
    process.env.MAISON_PROBE_SHELL = 'from-shell'
    writeFileSync(join(root, '.env'), 'MAISON_PROBE_SHELL=from-file\n')
    findPlugin(tanstackStart())?.configResolved({ mode: 'development', root })
    expect(process.env.MAISON_PROBE_SHELL).toBe('from-shell')
  })
})
