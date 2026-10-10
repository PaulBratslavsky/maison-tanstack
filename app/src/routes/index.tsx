import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

import { HomeScreen } from '../components/home-screen'
import { readHomePage } from '../lib/home-page'

/**
 * The Home page's words, read on the server: the Home page single type in Strapi, as published, in both languages, asked
 * for on every call (lib/home-page.ts). Strapi down, or a required field blank, and that language shows the built-in
 * text. `no-store` keeps the browser from holding an answer, so a published edit shows on the next load.
 */
const readHome = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  return readHomePage()
})

export const Route = createFileRoute('/')({
  // Never cached: the router asks again on every visit to Home.
  loader: () => readHome(),
  staleTime: 0,
  gcTime: 0,
  headers: () => ({ 'Cache-Control': 'no-store' }),
  component: Home,
})

// Both languages go to the screen, so the language switch stays instant.
function Home() {
  return <HomeScreen text={Route.useLoaderData()} />
}
