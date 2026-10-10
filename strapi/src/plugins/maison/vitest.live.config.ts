import { defineConfig } from 'vitest/config';

/**
 * The live tests call a real model, so `npm test` leaves them out (its `include` is test/unit only) and
 * `npm run test:live` runs them. A real model takes seconds, and the labelling service gives up on a call after 30.
 */
export default defineConfig({
  test: {
    include: ['test/live/**/*.live.test.ts'],
    environment: 'node',
    testTimeout: 90_000,
  },
});
