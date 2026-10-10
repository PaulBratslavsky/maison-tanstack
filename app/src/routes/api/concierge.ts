import { createFileRoute } from '@tanstack/react-router'

import { handleConcierge } from '../../lib/concierge/handle'
import { conciergeModel } from '../../lib/concierge/model'
import { strapiOrigin } from '../../lib/strapi-origin'

/**
 * The concierge: `POST /api/concierge`, as a server-sent event stream for the chat page's `useChat`. All its rules live
 * in lib/concierge/handle.ts, which has tests that don't need Start.
 *
 * A host must allow this route 60 seconds. A turn may run 55 seconds (the model, its tools and the extra pass for the
 * visit picker), and the end-of-turn log may take 5 more. Next.js had `maxDuration = 60` for it. TanStack Start has no
 * such setting: it is the host's (a Vercel function's `maxDuration`, a proxy's read timeout, and so on).
 *
 * The model and the Strapi address are read from the environment for each request, not when the file loads: an edge
 * host gives its environment to a request, not to the module (the execution-model skill in @tanstack/start-client-core).
 */
export const Route = createFileRoute('/api/concierge')({
  server: {
    handlers: {
      // A stray GET gets 405, not the page renderer's 200.
      GET: () => Response.json({ error: 'Use POST.' }, { status: 405, headers: { Allow: 'POST' } }),
      POST: ({ request }) => handleConcierge(request, { model: conciergeModel(process.env), strapiUrl: strapiOrigin(process.env) }),
    },
  },
})
