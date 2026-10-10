import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { BookingSheet } from '../components/booking-sheet';
import { Detail, Details } from '../components/details';
import { useMaison } from '../components/maison-provider';
import { ProductImage } from '../components/product-grid';
import { Screen } from '../components/screen';
import { StatusNote } from '../components/status-note';
import { COPY } from '../lib/copy';
import { listOf, personalizationKind, sizeCm, yen } from '../lib/format';
import type { Product } from '../lib/types';
import { useTool } from '../lib/use-tool';

/**
 * A product: its photo, full bleed and square; its collection, name and price; its description and craft; and a details
 * list, with "Ask about this piece" under it, which opens the concierge with this piece in context. "Book a visit" stays
 * at the bottom of the screen (Screen's `bar`), and the header's link leads up to the product's collection.
 */
export const Route = createFileRoute('/products/$slug')({
  component: ProductPage,
});

function ProductPage() {
  // Slugs are lower case: /products/Weekender-50 is the Weekender 50 too.
  const slug = Route.useParams().slug.toLowerCase();
  const { locale } = useMaison();
  const t = COPY[locale];
  const product = useTool<{ product: Product }>('product', 'view_product', { slug, locale });
  const [booking, setBooking] = useState(false);
  const item = product.data?.product;
  const size = item ? sizeCm(item.dimensionsCm) : null;
  const inStockAt = item ? item.stock.filter((entry) => entry.quantity > 0).map((entry) => entry.name) : [];

  return (
    <Screen
      name="product"
      tools={['view_product', 'find_boutiques', 'request_appointment']}
      back={item?.collection ? { to: '/collections/$slug', params: { slug: item.collection.slug }, label: item.collection.name } : undefined}
      bar={
        item && (
          <button type="button" onClick={() => setBooking(true)} className="btn-primary w-full">
            {t.bookVisit}
          </button>
        )
      }
    >
      <StatusNote loading={product.loading} error={product.error} retry={product.retry} fromUrl />
      {item && (
        <article>
          <ProductImage url={item.images[0]?.url ?? null} alt={item.images[0]?.alt ?? item.name} className="aspect-square w-full" />
          <div className="flex flex-col gap-1.5 px-5 pt-[22px]">
            {item.collection && <p className="eyebrow">{item.collection.name}</p>}
            <div className="flex items-baseline justify-between gap-3">
              <h1 className="text-title">{item.name}</h1>
              <p className="shrink-0 text-[15px] tabular-nums">{yen(item.priceJpy, locale)}</p>
            </div>
            <p className="mt-2 whitespace-pre-line text-body text-graphite">{item.description}</p>
            {item.craftStory && <p className="mt-1 text-body text-graphite">{item.craftStory}</p>}
          </div>
          <Details className="mx-5 mt-[18px]">
            {size && (
              <Detail label={t.size}>
                <span className="tabular-nums">{size}</span>
              </Detail>
            )}
            {item.personalization.offered && (
              <Detail label={t.personalization}>
                {listOf(
                  item.personalization.kinds.map((kind) => personalizationKind(kind, locale)),
                  locale
                )}
                {item.personalization.leadDays ? ` · ${t.leadDays(item.personalization.leadDays)}` : ''}
              </Detail>
            )}
            <Detail label={t.inStockAt}>{inStockAt.length > 0 ? listOf(inStockAt, locale) : t.outOfStock}</Detail>
          </Details>
          {/* The concierge arrives in phase 4. Until its route exists, a plain link. */}
          <a href={`/concierge?product=${item.slug}`} data-testid="ask-about-piece" className="btn-secondary mx-5 mt-[18px]">
            {t.askAboutPiece}
          </a>
        </article>
      )}
      {booking && item && <BookingSheet product={item} onClose={() => setBooking(false)} />}
    </Screen>
  );
}
