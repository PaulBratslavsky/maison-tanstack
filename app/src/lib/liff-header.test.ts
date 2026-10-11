// The X-Maison-Liff header that start.ts puts on every answer, which `npm run tunnel` reads before it opens the tunnel.
// Only a production build in LINE mode answers line: the build `npm run start:line` serves.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LIFF_HEADER, liffHeaderMiddleware, liffHeaderValue } from './liff-header'

/** What the middleware does to a response, by way of the request-middleware function Start would call. */
const run = async (response: Response) => {
  const server = (liffHeaderMiddleware as unknown as { options: { server: (context: unknown) => Promise<{ response: Response }> } }).options.server
  const result = await server({ request: new Request('http://127.0.0.1:3004/'), next: async () => ({ response }) })
  return result.response
}

describe('liffHeaderValue', () => {
  it.each([
    { lineMode: true, dev: false, value: 'line' }, // npm run start:line
    { lineMode: false, dev: false, value: 'mock' },
    { lineMode: true, dev: true, value: 'line-dev' }, // vite dev in LINE mode
    { lineMode: false, dev: true, value: 'mock' }, // npm run dev, the stage
  ])('lineMode=$lineMode dev=$dev: $value', ({ lineMode, dev, value }) => {
    expect(liffHeaderValue({ lineMode, dev })).toBe(value)
  })
})

describe('the request middleware, as the build and the dev server read their settings', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    { DEV: false, VITE_LIFF_MOCK: 'false', value: 'line' },
    { DEV: false, VITE_LIFF_MOCK: 'true', value: 'mock' },
    { DEV: false, VITE_LIFF_MOCK: undefined, value: 'mock' },
    { DEV: true, VITE_LIFF_MOCK: 'false', value: 'line-dev' },
    { DEV: true, VITE_LIFF_MOCK: 'true', value: 'mock' },
  ])('DEV=$DEV and VITE_LIFF_MOCK=$VITE_LIFF_MOCK: $value', async ({ DEV, VITE_LIFF_MOCK, value }) => {
    vi.stubEnv('DEV', DEV)
    vi.stubEnv('VITE_LIFF_MOCK', VITE_LIFF_MOCK)
    const response = await run(new Response('page', { status: 200 }))
    expect(response.headers.get(LIFF_HEADER)).toBe(value)
  })

  it('keeps the response as it was: status, body and its other headers', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_LIFF_MOCK', 'false')
    const response = await run(Response.json({ error: 'not_found' }, { status: 404, headers: { 'X-Other': 'yes' } }))
    expect(response.status).toBe(404)
    expect(response.headers.get('x-other')).toBe('yes')
    expect(await response.json()).toEqual({ error: 'not_found' })
    expect(response.headers.get('x-maison-liff')).toBe('line')
  })

  it("sets it on a response whose headers can't be changed, such as a redirect made by Response.redirect, and keeps the rest", async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_LIFF_MOCK', 'false')
    const redirect = Response.redirect('http://127.0.0.1:3004/elsewhere', 302)
    expect(() => redirect.headers.set('x-probe', '1')).toThrow(TypeError)
    const response = await run(redirect)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3004/elsewhere')
    expect(response.headers.get('x-maison-liff')).toBe('line')
  })
})
