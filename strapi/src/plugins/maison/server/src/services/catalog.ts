import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { UID, type Locale } from '../constants';
import { productsNotFound } from '../domain/failures';
import { hoursForDate, validateOpeningHours, type OpeningHoursEntry } from '../domain/hours';
import { rankKnowledge, type KnowledgeEntry } from '../domain/knowledge';
import { failure, type ServiceResult } from '../domain/service-result';
import { blocksToPlainText, teaser } from '../domain/text';
import { absoluteUrl } from '../domain/url';

type Doc = Record<string, any>;
type StockEntry = { boutique: string; quantity: number };
const LIMIT = 200;

export interface BoutiqueView {
  slug: string;
  name: string;
  city: string;
  address: string;
  hours: OpeningHoursEntry[];
  openOnDate: boolean | null;
  hoursOnDate: { opens: string; closes: string } | null;
  stock: Array<{ product: string; quantity: number }>;
}

export interface ProductCard {
  slug: string;
  name: string;
  category: string;
  priceJpy: number;
  imageUrl: string | null;
  occasions: string[];
  personalizable: boolean;
  inStockAt: string[];
}

export interface SearchFilters {
  query?: string;
  collection?: string;
  category?: string;
  occasion?: string;
  minPriceJpy?: number;
  maxPriceJpy?: number;
  personalizable?: boolean;
  inStockAt?: string;
  limit?: number;
}

/** A knowledge entry as search_knowledge returns it. */
export interface KnowledgeAnswer {
  title: string;
  answer: string;
  category: string;
  productSlugs: string[];
}

const arrayOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const fallbackLocale = () => getConfig(strapi).defaultLocale;
  const url = (value?: string | null) => absoluteUrl(value, strapi.config.get('server.url') as string | undefined);

  /** Published documents in `locale`, plus documents that exist only in the fallback locale. */
  const findPublished = async (uid: string, locale: Locale, params: Doc = {}): Promise<Doc[]> => {
    const primary = await strapi.documents(uid as any).findMany({ ...params, locale, status: 'published', limit: LIMIT });
    const fallback = fallbackLocale();
    if (locale === fallback) return primary;
    const seen = new Set(primary.map((doc) => doc.documentId));
    const extra = await strapi.documents(uid as any).findMany({ ...params, locale: fallback, status: 'published', limit: LIMIT });
    return [...primary, ...extra.filter((doc) => !seen.has(doc.documentId))];
  };

  /** product slug → stock per boutique slug. Stock levels have no drafts and no locales. */
  const stockByProduct = async (): Promise<Map<string, StockEntry[]>> => {
    const rows = await strapi.documents(UID.stockLevel).findMany({ limit: 5000, fields: ['productSlug', 'boutiqueSlug', 'quantity'] });
    const map = new Map<string, StockEntry[]>();
    for (const row of rows as Doc[]) {
      map.set(row.productSlug, [...(map.get(row.productSlug) ?? []), { boutique: row.boutiqueSlug, quantity: row.quantity ?? 0 }]);
    }
    return map;
  };

  /** Published boutiques by slug. Stock for a boutique that isn't published is never shown. */
  const boutiquesBySlug = async (locale: Locale) =>
    new Map((await findPublished(UID.boutique, locale)).map((b) => [b.slug as string, b]));

  /** The slugs among `slugs` that a read in `locale` can find: published, in `locale` or the fallback locale. */
  const publishedSlugs = async (uid: string, locale: Locale, slugs: string[]): Promise<Set<string>> =>
    new Set((await findPublished(uid, locale, { filters: { slug: { $in: slugs } }, fields: ['slug'] })).map((doc) => doc.slug as string));

  const toCard = (product: Doc, stock: StockEntry[] | undefined, boutiques: Map<string, Doc>): ProductCard => ({
    slug: product.slug,
    name: product.name,
    category: product.category,
    priceJpy: product.priceJpy,
    imageUrl: url(product.images?.[0]?.url),
    occasions: arrayOf(product.giftOccasions),
    personalizable: product.personalizable === true,
    inStockAt: (stock ?? []).filter((entry) => entry.quantity > 0 && boutiques.has(entry.boutique)).map((entry) => entry.boutique),
  });

  return {
    async browseCollections(locale: Locale) {
      const collections = await findPublished(UID.collection, locale, {
        sort: 'name:asc',
        populate: { heroImage: true, products: { fields: ['documentId'] } },
      });
      return collections.map((c) => ({
        slug: c.slug as string,
        name: c.name as string,
        teaser: teaser(blocksToPlainText(c.story)),
        heroImageUrl: url(c.heroImage?.url),
        productCount: Array.isArray(c.products) ? c.products.length : 0,
      }));
    },

    /** An unknown boutique or collection is not_found, never an empty result that reads as "nothing matches". */
    async searchProducts(locale: Locale, filters: SearchFilters): Promise<ServiceResult<{ total: number; products: ProductCard[] }>> {
      const boutiques = await boutiquesBySlug(locale);
      if (filters.inStockAt && !boutiques.has(filters.inStockAt)) {
        return failure('not_found', `No boutique "${filters.inStockAt}".`, 'Call find_boutiques to find valid boutique slugs.');
      }
      if (filters.collection && !(await publishedSlugs(UID.collection, locale, [filters.collection])).has(filters.collection)) {
        return failure('not_found', `No collection "${filters.collection}".`, 'Call browse_collections to find valid collection slugs.');
      }

      const where: Doc = {};
      if (filters.category) where.category = { $eq: filters.category };
      if (filters.collection) where.collection = { slug: { $eq: filters.collection } };
      if (filters.personalizable !== undefined) where.personalizable = { $eq: filters.personalizable };
      if (filters.minPriceJpy !== undefined || filters.maxPriceJpy !== undefined) {
        where.priceJpy = {
          ...(filters.minPriceJpy !== undefined ? { $gte: filters.minPriceJpy } : {}),
          ...(filters.maxPriceJpy !== undefined ? { $lte: filters.maxPriceJpy } : {}),
        };
      }
      const [products, stock] = await Promise.all([
        findPublished(UID.product, locale, { filters: where, populate: { images: true } }),
        stockByProduct(),
      ]);
      const query = filters.query?.trim().toLowerCase();
      // JSON arrays and free text are filtered in memory: the catalog is small and this stays database-agnostic.
      let cards = products
        .filter((p) => !filters.occasion || arrayOf(p.giftOccasions).includes(filters.occasion))
        .filter((p) => !query || `${p.name} ${blocksToPlainText(p.description)} ${p.craftStory ?? ''}`.toLowerCase().includes(query))
        .map((p) => toCard(p, stock.get(p.slug), boutiques));
      if (filters.inStockAt) cards = cards.filter((card) => card.inStockAt.includes(filters.inStockAt as string));
      cards.sort((a, b) => b.priceJpy - a.priceJpy);
      return { ok: true, value: { total: cards.length, products: cards.slice(0, filters.limit ?? 8) } };
    },

    async getProduct(locale: Locale, slug: string) {
      const find = (loc: Locale) =>
        strapi.documents(UID.product).findFirst({
          locale: loc,
          status: 'published',
          filters: { slug: { $eq: slug } },
          populate: { images: true, collection: { fields: ['slug', 'name'] } },
        }) as Promise<Doc | null>;
      let usedLocale = locale;
      let product = await find(locale);
      if (!product && locale !== fallbackLocale()) {
        usedLocale = fallbackLocale();
        product = await find(usedLocale);
      }
      if (!product) return null;

      const [stock, boutiques] = await Promise.all([stockByProduct(), boutiquesBySlug(usedLocale)]);
      const dims = [product.widthCm, product.heightCm, product.depthCm];
      return {
        locale: usedLocale,
        slug: product.slug as string,
        sku: product.sku as string,
        name: product.name as string,
        category: product.category as string,
        priceJpy: product.priceJpy as number,
        description: blocksToPlainText(product.description),
        craftStory: (product.craftStory as string | null) ?? '',
        dimensionsCm: dims.every((v) => v !== null && v !== undefined)
          ? { width: Number(dims[0]), height: Number(dims[1]), depth: Number(dims[2]) }
          : null,
        personalization: {
          offered: product.personalizable === true,
          kinds: arrayOf(product.personalizationKinds),
          leadDays: (product.personalizationLeadDays as number | null) ?? null,
        },
        images: ((product.images as Doc[] | null) ?? []).map((image) => ({
          url: url(image.url) ?? '',
          alt: (image.alternativeText as string | null) ?? (product.name as string),
        })),
        occasions: arrayOf(product.giftOccasions),
        collection: product.collection ? { slug: product.collection.slug as string, name: product.collection.name as string } : null,
        stock: (stock.get(product.slug) ?? [])
          .filter((entry) => boutiques.has(entry.boutique))
          .map((entry) => ({ boutique: entry.boutique, name: boutiques.get(entry.boutique)?.name as string, quantity: entry.quantity })),
      };
    },

    /** A product that doesn't exist or isn't published is not_found, never "0 in stock" at every boutique. */
    async getBoutiques(locale: Locale, options: { productSlugs?: string[]; date?: string }): Promise<ServiceResult<BoutiqueView[]>> {
      const productSlugs = options.productSlugs ?? [];
      if (productSlugs.length > 0) {
        const known = await publishedSlugs(UID.product, locale, productSlugs);
        const unknown = [...new Set(productSlugs.filter((slug) => !known.has(slug)))];
        if (unknown.length > 0) return productsNotFound(unknown);
      }
      const boutiques = await findPublished(UID.boutique, locale, { sort: 'slug:asc' });
      const stock = productSlugs.length > 0 ? await stockByProduct() : new Map<string, StockEntry[]>();
      const views = boutiques.map((b): BoutiqueView => {
        const parsed = validateOpeningHours(b.openingHours);
        const hours: OpeningHoursEntry[] = parsed.ok ? parsed.hours : [];
        const hoursOnDate = options.date ? hoursForDate(hours, options.date) : null;
        return {
          slug: b.slug as string,
          name: b.name as string,
          city: (b.city as string | null) ?? '',
          address: (b.address as string | null) ?? '',
          hours,
          openOnDate: options.date ? hoursOnDate !== null : null,
          hoursOnDate: hoursOnDate ? { opens: hoursOnDate.opens, closes: hoursOnDate.closes } : null,
          stock: productSlugs.map((slug) => ({
            product: slug,
            quantity: (stock.get(slug) ?? []).find((entry) => entry.boutique === b.slug)?.quantity ?? 0,
          })),
        };
      });
      return { ok: true, value: views };
    },

    /**
     * search_knowledge: the published entries that answer the question best, at most four, in `locale`, with the default
     * locale's entries where a translation is missing. A product that doesn't exist or isn't published is not_found,
     * never a narrower search that quietly leaves it out.
     */
    async searchKnowledge(locale: Locale, input: { query: string; productSlugs?: string[] }): Promise<ServiceResult<{ entries: KnowledgeAnswer[] }>> {
      const productSlugs = [...new Set(input.productSlugs ?? [])];
      if (productSlugs.length > 0) {
        const known = await publishedSlugs(UID.product, locale, productSlugs);
        const unknown = productSlugs.filter((slug) => !known.has(slug));
        if (unknown.length > 0) return productsNotFound(unknown);
      }
      const docs = await findPublished(UID.knowledge, locale, { fields: ['title', 'answer', 'category', 'productSlugs', 'keywords'] });
      const entries: KnowledgeEntry[] = docs.map((doc) => ({
        title: (doc.title as string | null) ?? '',
        answer: (doc.answer as string | null) ?? '',
        category: (doc.category as string | null) ?? '',
        productSlugs: arrayOf(doc.productSlugs),
        keywords: (doc.keywords as string | null) ?? '',
      }));
      const ranked = rankKnowledge(entries, input.query, locale, productSlugs);
      return { ok: true, value: { entries: ranked.map(({ title, answer, category, productSlugs: slugs }) => ({ title, answer, category, productSlugs: slugs })) } };
    },
  };
};
