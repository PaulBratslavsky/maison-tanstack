import { createFileRoute } from '@tanstack/react-router'

import { useMaison } from '../components/maison-provider'
import { ProductGrid } from '../components/product-grid'
import { Screen } from '../components/screen'
import { StatusNote } from '../components/status-note'
import { COPY } from '../lib/copy'
import type { CollectionSummary, ProductCard } from '../lib/types'
import { useTool } from '../lib/use-tool'

export const Route = createFileRoute('/collections/$slug')({
  component: CollectionPage,
})

function CollectionPage() {
  // Slugs are lower case: /collections/Voyage is the Voyage collection too.
  const slug = Route.useParams().slug.toLowerCase()
  const { locale } = useMaison()
  const t = COPY[locale]
  const collections = useTool<{ collections: CollectionSummary[] }>('collection', 'browse_collections', { locale })
  const products = useTool<{ total: number; products: ProductCard[] }>('collection', 'search_products', { collection: slug, locale, limit: 20 })
  const collection = collections.data?.collections.find((c) => c.slug === slug)
  // When both calls failed, the one note's retry runs both again.
  const retryAll = () => {
    products.retry()
    if (collections.error) collections.retry()
  }
  return (
    <Screen name="collection" tools={['browse_collections', 'search_products']}>
      {collections.error && !products.error ? (
        // The pieces came but the collection's name didn't: say so where the name goes, with a retry.
        <StatusNote loading={false} error={collections.error} retry={collections.retry} />
      ) : (
        // The name holds its line while it loads, so the grid doesn't move when it arrives.
        <header className="flex flex-col gap-3 px-5 pb-8 pt-5">
          <h1 className="min-h-[36px] text-headline">{collection?.name ?? ''}</h1>
          {collection && <p className="text-body text-graphite">{collection.teaser}</p>}
        </header>
      )}
      <StatusNote loading={products.loading} error={products.error} retry={retryAll} fromUrl />
      {products.data &&
        (products.data.products.length > 0 ? (
          <ProductGrid products={products.data.products} locale={locale} />
        ) : (
          <p className="px-5 text-body text-mist">{t.noProducts}</p>
        ))}
    </Screen>
  )
}
