import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

import { liffHeaderMiddleware } from './lib/liff-header'

// Having a start.ts turns off Start's own default for requests, so the CSRF check for server functions that Start adds
// when there is no start.ts is added here again (start-server-core createStartHandler).
const csrfMiddleware = createCsrfMiddleware({ filter: (context) => context.handlerType === 'serverFn' })

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, liffHeaderMiddleware],
}))
