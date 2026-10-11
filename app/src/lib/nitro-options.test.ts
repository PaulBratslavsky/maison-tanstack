import { describe, expect, it } from 'vitest'

import { LOG_TIMEOUT_MS, TURN_BUDGET_MS } from './concierge/turn'
import { CONCIERGE_ROUTE, CONCIERGE_MAX_DURATION_SECONDS, nitroOptions } from './nitro-options'

describe('nitroOptions (what Nitro builds for Vercel)', () => {
  it('gives the concierge route 60 seconds, as its own function rule', () => {
    expect(CONCIERGE_ROUTE).toBe('/api/concierge')
    expect(nitroOptions.vercel.functionRules[CONCIERGE_ROUTE]).toEqual({ maxDuration: 60 })
    expect(CONCIERGE_MAX_DURATION_SECONDS).toBe(60)
  })

  it('allows a whole turn: the turn budget and the end-of-turn log fit in the duration', () => {
    expect(TURN_BUDGET_MS + LOG_TIMEOUT_MS).toBeLessThanOrEqual(CONCIERGE_MAX_DURATION_SECONDS * 1000)
  })

  it('runs every function in iad1, like the original (liff/vercel.json)', () => {
    expect(nitroOptions.vercel.functions.regions).toEqual(['iad1'])
  })

  it('names no preset: Nitro picks Vercel on Vercel and a Node server on a laptop', () => {
    expect('preset' in nitroOptions).toBe(false)
  })
})
