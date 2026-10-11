import { createFileRoute } from '@tanstack/react-router'

import { TOKEN_PATH, methodNotAllowed, proxyToStrapi } from '../../../../lib/strapi-proxy'

/** oauth-mcp-manager's token endpoint on the app's own origin, in LINE mode only: the LINE ID token exchange. */
export const Route = createFileRoute('/api/strapi-oauth-mcp-manager/oauth/token')({
  server: { handlers: { POST: ({ request }) => proxyToStrapi(request, TOKEN_PATH), ANY: () => methodNotAllowed('POST') } },
})
