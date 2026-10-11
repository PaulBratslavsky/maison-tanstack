/**
 * The options for Nitro, the server TanStack Start builds on (vite.config.ts passes them to `nitro()`).
 *
 * The preset is not set here. On Vercel's build Nitro finds Vercel from the `VERCEL` variable and builds the `vercel`
 * preset (Build Output API v3, in `.vercel/output`). Anywhere else it builds the Node server preset. Setting one here
 * would break the other (nitro/dist/_chunks/nitro.mjs `_loadUserConfig`, nitro/dist/_presets.mjs `resolvePreset`).
 *
 * The concierge streams for up to 60 seconds: a turn may run 55 seconds (TURN_BUDGET_MS) and the end-of-turn log may take
 * 5 more (LOG_TIMEOUT_MS), see lib/concierge/turn.ts. Next.js had `maxDuration = 60` in the route. Here the function
 * rule gives that one route its own Vercel function with `maxDuration` 60 (nitro/dist/_presets.mjs
 * `generateFunctionFiles`). `functions.regions` puts every function in iad1, as the original's liff/vercel.json did.
 */
export const CONCIERGE_ROUTE = '/api/concierge'
export const CONCIERGE_MAX_DURATION_SECONDS = 60

export const nitroOptions = {
  vercel: {
    functions: { regions: ['iad1'] },
    functionRules: {
      [CONCIERGE_ROUTE]: { maxDuration: CONCIERGE_MAX_DURATION_SECONDS },
    },
  },
}
