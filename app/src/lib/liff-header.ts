// Not marked server-only: start.ts imports it, and the browser bundle loads start.ts. Start's compiler removes the
// middleware's .server() body from the browser bundle.
import { createMiddleware } from '@tanstack/react-start'

export const LIFF_HEADER = 'X-Maison-Liff'

/**
 * Which LIFF this server signs in with, which `npm run tunnel` reads: line only for a production build in LINE mode, the
 * one `npm run start:line` serves. A dev server in LINE mode says line-dev, and the tunnel refuses it as it refuses mock.
 */
export const liffHeaderValue = ({ lineMode, dev }: { lineMode: boolean; dev: boolean }) => (!lineMode ? 'mock' : dev ? 'line-dev' : 'line')

/**
 * A request middleware (start.ts), so it runs on every server request: pages, server routes and server functions. Vite
 * replaces `import.meta.env.VITE_LIFF_MOCK` and `import.meta.env.DEV` when the app is built, so a build keeps the mode it
 * was made in whatever the environment says at run time. Both are read in the handler, so a test can set them.
 */
export const liffHeaderMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next()
  const value = liffHeaderValue({ lineMode: import.meta.env.VITE_LIFF_MOCK === 'false', dev: import.meta.env.DEV })
  try {
    result.response.headers.set(LIFF_HEADER, value)
  } catch {
    // A response made by Response.redirect() or fetch() has headers that can't change. Rebuild it with the same body.
    const headers = new Headers(result.response.headers)
    headers.set(LIFF_HEADER, value)
    const { status, statusText, body } = result.response
    return { ...result, response: new Response(body, { status, statusText, headers }) }
  }
  return result
})
