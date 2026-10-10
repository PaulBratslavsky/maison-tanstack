import { createFileRoute } from '@tanstack/react-router'

// The Home screen arrives in phase 3. This page shows that the app runs.
export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return <h1 className="p-6 text-2xl font-light">Maison</h1>
}
