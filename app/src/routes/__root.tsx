import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { MaisonProvider } from '../components/maison-provider'
import { NotFoundScreen } from '../components/not-found-screen'
import { PhoneFrame } from '../components/phone-frame'
import styles from '../styles.css?url'

// Self-hosted, so nothing comes from a CDN: the app works inside LINE and offline on stage. Jost for Latin text, Zen
// Kaku Gothic New for Japanese (styles.css). Each face's CSS splits it by script, and Japanese into small slices, so a
// browser downloads only the characters a page shows. Zen Kaku's 300 is for the light headlines: without it, a Japanese
// headline falls back to 400 and reads heavy beside Jost 300.
import '@fontsource/jost/300.css'
import '@fontsource/jost/400.css'
import '@fontsource/jost/500.css'
import '@fontsource/zen-kaku-gothic-new/300.css'
import '@fontsource/zen-kaku-gothic-new/400.css'
import '@fontsource/zen-kaku-gothic-new/500.css'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Maison' },
      { name: 'description', content: 'A fictional luxury house, served to people and agents through Strapi MCP.' },
    ],
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundScreen,
})

// No <StrictMode>: it runs effects twice, and the Agent view would record every MCP call twice.
function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <PhoneFrame>
          <MaisonProvider>
            <Outlet />
          </MaisonProvider>
        </PhoneFrame>
      </QueryClientProvider>
    </RootDocument>
  )
}

// The server renders lang="ja"; MaisonProvider sets the screens' language right after the first paint.
function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
