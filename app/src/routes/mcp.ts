import { createFileRoute } from '@tanstack/react-router'

import { methodNotAllowed, proxyToStrapi } from '../lib/strapi-proxy'

/**
 * Strapi's MCP server on the app's own origin, in LINE mode only: in any other build the proxy answers 404. Strapi
 * answers GET and DELETE with 405 itself. The Start server-routes skill (@tanstack/start-client-core) describes this
 * `server.handlers` form.
 */
const proxy = ({ request }: { request: Request }) => proxyToStrapi(request, '/mcp')

export const Route = createFileRoute('/mcp')({
  server: { handlers: { GET: proxy, POST: proxy, DELETE: proxy, ANY: () => methodNotAllowed('GET, POST, DELETE') } },
})
