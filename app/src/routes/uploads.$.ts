import { createFileRoute } from '@tanstack/react-router'

import { methodNotAllowed, proxyToStrapi } from '../lib/strapi-proxy'

/**
 * Catalog images on the app's own origin, in LINE mode only. Strapi builds their absolute URLs from PUBLIC_URL. The
 * proxy checks the path itself, so the splat is not read here: the whole pathname goes in.
 */
const proxy = ({ request }: { request: Request }) => proxyToStrapi(request, new URL(request.url).pathname)

export const Route = createFileRoute('/uploads/$')({
  server: { handlers: { GET: proxy, HEAD: proxy, ANY: () => methodNotAllowed('GET, HEAD') } },
})
