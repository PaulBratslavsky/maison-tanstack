import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/**
 * Start calls this once per request on the server and once in the browser, so each gets its own QueryClient: the
 * server's never holds one customer's answers for the next. The client is in the router context, and the root route
 * puts it in QueryClientProvider.
 */
export function getRouter() {
  const queryClient = new QueryClient()
  return createRouter({ routeTree, context: { queryClient }, scrollRestoration: true })
}
