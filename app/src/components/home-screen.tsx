import { Link } from '@tanstack/react-router';

import { COPY } from '../lib/copy';
import type { HomeText } from '../lib/home-page';
import type { CollectionSummary, Locale } from '../lib/types';
import { useTool } from '../lib/use-tool';
import { useMaison } from './maison-provider';
import { ProductImage } from './product-grid';
import { Screen } from './screen';
import { StatusNote } from './status-note';

/**
 * Home: the Home page's eyebrow, headline, intro (only when it has one) and the concierge's button, then the collections,
 * each a full-bleed photo with its name and piece count under it. The words come in both languages from the page's server
 * component (app/page.tsx): the language switch picks one, at once, with nothing to fetch.
 */
export function HomeScreen({ text }: { text: Record<Locale, HomeText> }) {
  const { locale } = useMaison();
  const t = COPY[locale];
  const home = text[locale];
  const collections = useTool<{ collections: CollectionSummary[] }>('home', 'browse_collections', { locale });
  const list = collections.data?.collections ?? [];
  return (
    <Screen name="home" tools={['browse_collections']}>
      <section className="flex flex-col gap-3.5 px-5 pb-8 pt-5">
        <p className="eyebrow">{home.eyebrow}</p>
        <h1 className="text-headline">{home.headline}</h1>
        {home.intro && <p className="whitespace-pre-line text-body text-graphite">{home.intro}</p>}
        {/* The concierge arrives in phase 4. Until its route exists, a plain link. */}
        <a href="/concierge" className="btn-primary mt-3">
          {home.ctaLabel}
        </a>
      </section>
      <div className="flex items-baseline justify-between px-5 pb-3.5">
        <h2 className="label">{t.collections}</h2>
        {collections.data && <span className="text-[12px] tabular-nums text-mist">{t.pieces(list.reduce((sum, collection) => sum + collection.productCount, 0))}</span>}
      </div>
      <StatusNote loading={collections.loading} error={collections.error} retry={collections.retry} />
      <ul>
        {list.map((collection, index) => (
          <li key={collection.slug}>
            <Link to="/collections/$slug" params={{ slug: collection.slug }} data-testid="collection-card" className="flex flex-col">
              {/* Decorative: the link's name is the collection name below it. */}
              <ProductImage url={collection.heroImageUrl} alt="" className="h-60 w-full" loading={index === 0 ? 'eager' : 'lazy'} />
              <span className="flex items-center justify-between px-5 pb-[26px] pt-3.5">
                <span className="text-[13px] font-medium uppercase tracking-[0.24em]">{collection.name}</span>
                <span className="text-[12px] tabular-nums text-graphite">{t.pieces(collection.productCount)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
