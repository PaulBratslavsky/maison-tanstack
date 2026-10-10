import { describe, expect, it } from 'vitest'

import { Route } from '../../routes/api/concierge'

/** The route's handlers, as Start calls them with a request. */
const handlers = (Route.options as unknown as { server: { handlers: Record<string, (context: { request: Request }) => Response | Promise<Response>> } }).server.handlers

describe('GET /api/concierge', () => {
  it('answers 405 with Allow: POST and a short JSON error, not the page', async () => {
    expect(handlers.GET).toBeTypeOf('function')
    const response = await handlers.GET({ request: new Request('http://localhost:3004/api/concierge') })
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(response.headers.get('Content-Type')).toContain('application/json')
    const body = await response.json()
    expect(Object.keys(body)).toEqual(['error'])
    expect(typeof body.error).toBe('string')
  })
})
