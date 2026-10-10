import { defineConfig } from 'vitest/config'

/**
 * Opt-in tests against the running Strapi and a model: `npm run test:live`. The normal run (`vitest.config.ts`) never
 * includes them. The verbose reporter shows the one line the file prints when it skips the live cases, and why.
 */
export default defineConfig({
  test: { include: ['live/**/*.live.test.ts'], environment: 'node', testTimeout: 300_000, hookTimeout: 60_000, fileParallelism: false, reporters: ['verbose'] },
})
