import { Link } from '@tanstack/react-router';

import { mediaUrl, yen } from '../lib/format';
import type { Locale, ProductCard } from '../lib/types';

/**
 * A catalog image, or its quiet wash while it loads and where there's none. The catalog's photos are 1200 px squares:
 * the width and height say so before the file arrives, and each caller's box (a square, or a 240 px band) holds its
 * place, so nothing moves when it loads. There's one file per photo (no srcset), so there's no `sizes` to give.
 */
export function ProductImage({
  url,
  alt,
  className = '',
  loading,
}: {
  url: string | null;
  alt: string;
  className?: string;
  /** "lazy" for a photo further down a page. */
  loading?: 'eager' | 'lazy';
}) {
  const src = mediaUrl(url);
  return src ? (
    <img src={src} alt={alt} width={1200} height={1200} loading={loading} decoding="async" className={`bg-wash object-cover ${className}`} />
  ) : (
    <div aria-hidden className={`bg-wash ${className}`} />
  );
}

/**
 * A collection's pieces: two columns of square photos, edge to edge as Home's collection bands are, with a hairline of
 * white between them. Under each, the name at 13 px and the price at 12 px in graphite.
 */
export function ProductGrid({ products, locale }: { products: ProductCard[]; locale: Locale }) {
  return (
    <ul className="grid grid-cols-2 gap-x-0.5 gap-y-7">
      {products.map((product, index) => (
        <li key={product.slug}>
          <Link to="/products/$slug" params={{ slug: product.slug }} data-testid="product-card" className="flex flex-col">
            {/* Decorative: the link's name is the product name below it. */}
            <ProductImage url={product.imageUrl} alt="" className="aspect-square w-full" loading={index < 4 ? 'eager' : 'lazy'} />
            <span className="px-5 pt-3 text-[13px] leading-snug">{product.name}</span>
            <span className="px-5 pt-1 text-[12px] tabular-nums text-graphite">{yen(product.priceJpy, locale)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
