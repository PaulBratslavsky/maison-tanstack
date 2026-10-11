import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route as McpRoute } from '../routes/mcp'
import { Route as TokenRoute } from '../routes/api/strapi-oauth-mcp-manager/oauth/token'
import { Route as UploadsRoute } from '../routes/uploads.$'

type Handler = (context: { request: Request }) => Response | Promise<Response>
/** A route's handlers, as Start calls them with a request. */
const handlersOf = (route: unknown) => (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers

const PUBLIC = 'https://maison.example'
const TOKEN_PATH = '/api/strapi-oauth-mcp-manager/oauth/token'
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' }
const exchange = new URLSearchParams({
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  client_id: 'mcp_client_test',
  subject_token: `valid.U${'0'.repeat(32)}`,
  subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
}).toString()

const servers: Array<{ close: () => void }> = []
/** A stand-in for Strapi. The routes find it through STRAPI_URL, as they do in the app. */
const fakeStrapi = async () => {
  const seen: Array<{ method: string; url: string; headers: IncomingMessage['headers'] }> = []
  const server = createServer((req, res) => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(req.method === 'HEAD' ? undefined : 'reached')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push({ close: () => server.close() })
  vi.stubEnv('STRAPI_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  return seen
}
afterEach(() => {
  servers.splice(0).forEach((server) => server.close())
  vi.unstubAllEnvs()
})

describe('the proxy routes', () => {
  it('serve /mcp for GET, POST and DELETE, the token endpoint for POST, and /uploads for GET and HEAD, and catch every other method', () => {
    expect(Object.keys(handlersOf(McpRoute)).sort()).toEqual(['ANY', 'DELETE', 'GET', 'POST'])
    expect(Object.keys(handlersOf(TokenRoute)).sort()).toEqual(['ANY', 'POST'])
    expect(Object.keys(handlersOf(UploadsRoute)).sort()).toEqual(['ANY', 'GET', 'HEAD'])
  })

  it('answer another method with 405 and Allow in the LINE build, and without Allow, as 404, in a build for the LIFF mock', async () => {
    const seen = await fakeStrapi()
    for (const [route, method, allow] of [
      [McpRoute, 'PUT', 'GET, POST, DELETE'],
      [TokenRoute, 'GET', 'POST'],
      [UploadsRoute, 'POST', 'GET, HEAD'],
    ] as const) {
      const call = () => handlersOf(route).ANY({ request: new Request(`${PUBLIC}/x`, { method, ...(method === 'POST' ? { body: '{}' } : {}) }) })
      vi.stubEnv('VITE_LIFF_MOCK', 'false')
      const refused = await call()
      expect(refused.status, `${method} in LINE mode`).toBe(405)
      expect(refused.headers.get('allow')).toBe(allow)
      vi.stubEnv('VITE_LIFF_MOCK', 'true')
      const closed = await call()
      expect(closed.status, `${method} in a mock build`).toBe(404)
      expect(closed.headers.get('allow')).toBeNull()
      expect(await closed.json()).toEqual({ error: 'not_found' })
    }
    expect(seen).toEqual([])
  })

  it('are the paths the phone calls: the route files make these in the generated route tree', () => {
    const tree = readFileSync(new URL('../routeTree.gen.ts', import.meta.url), 'utf8')
    for (const path of ['/mcp', TOKEN_PATH, '/uploads/$']) expect(tree, path).toContain(`fullPath: '${path}'`)
  })

  it('pass each call to Strapi in the LINE build, with the path and the query it came with', async () => {
    vi.stubEnv('VITE_LIFF_MOCK', 'false')
    const seen = await fakeStrapi()
    const mcp = handlersOf(McpRoute)
    const mcpAnswers = await Promise.all([
      mcp.GET({ request: new Request(`${PUBLIC}/mcp?x=1`) }),
      mcp.POST({ request: new Request(`${PUBLIC}/mcp`, { method: 'POST', body: '{}' }) }),
      mcp.DELETE({ request: new Request(`${PUBLIC}/mcp`, { method: 'DELETE' }) }),
    ])
    const token = await handlersOf(TokenRoute).POST({ request: new Request(`${PUBLIC}${TOKEN_PATH}`, { method: 'POST', headers: FORM, body: exchange }) })
    const uploads = handlersOf(UploadsRoute)
    const image = await uploads.GET({ request: new Request(`${PUBLIC}/uploads/weekender_50.png`) })
    const head = await uploads.HEAD({ request: new Request(`${PUBLIC}/uploads/weekender_50.png`, { method: 'HEAD' }) })
    for (const response of [...mcpAnswers, token, image, head]) expect(response.status).toBe(200)
    expect(seen.map(({ method, url }) => `${method} ${url}`).sort()).toEqual(
      ['DELETE /mcp', 'GET /mcp?x=1', 'GET /uploads/weekender_50.png', 'HEAD /uploads/weekender_50.png', 'POST /mcp', `POST ${TOKEN_PATH}`].sort(),
    )
  })

  it('answer 404 not_found for every call in a build for the LIFF mock, and reach nothing on Strapi', async () => {
    vi.stubEnv('VITE_LIFF_MOCK', 'true')
    const seen = await fakeStrapi()
    const calls: Array<[Handler, Request]> = [
      [handlersOf(McpRoute).GET, new Request(`${PUBLIC}/mcp`)],
      [handlersOf(McpRoute).POST, new Request(`${PUBLIC}/mcp`, { method: 'POST', body: '{}' })],
      [handlersOf(McpRoute).DELETE, new Request(`${PUBLIC}/mcp`, { method: 'DELETE' })],
      [handlersOf(TokenRoute).POST, new Request(`${PUBLIC}${TOKEN_PATH}`, { method: 'POST', headers: FORM, body: exchange })],
      [handlersOf(UploadsRoute).GET, new Request(`${PUBLIC}/uploads/weekender_50.png`)],
      [handlersOf(UploadsRoute).HEAD, new Request(`${PUBLIC}/uploads/weekender_50.png`, { method: 'HEAD' })],
    ]
    for (const [handler, request] of calls) {
      const response = await handler({ request })
      expect(response.status, `${request.method} ${new URL(request.url).pathname}`).toBe(404)
    }
    expect(seen).toEqual([])
  })

  it('refuse a climb out of /uploads, also percent-encoded, in the LINE build', async () => {
    vi.stubEnv('VITE_LIFF_MOCK', 'false')
    const seen = await fakeStrapi()
    for (const path of ['/uploads/%2e%2e/admin/init', '/uploads/..%2fadmin%2finit']) {
      const response = await handlersOf(UploadsRoute).GET({ request: new Request(`${PUBLIC}${path}`) })
      expect(response.status, path).toBe(404)
    }
    expect(seen).toEqual([])
  })
})
