import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { UID, type Locale } from '../constants';

/*
 * Code the questions and inquiries services share. It is no service of its own: `services/index.ts` doesn't register it.
 */

type Doc = Record<string, any>;

/** A published piece as a view shows it. */
export interface ProductName {
  slug: string;
  name: string;
}

/** Names the piece with this slug in a language. */
export type ProductLookup = (slug: string, language: Locale) => Promise<ProductName | null>;

/**
 * A lookup that names a published piece by slug in `language`, or in the default language when it has no version in that
 * one. It answers null when neither has the piece, or when the piece isn't published.
 */
export const productNamed =
  (strapi: Core.Strapi): ProductLookup =>
  async (slug, language) => {
    const { defaultLocale } = getConfig(strapi);
    for (const locale of new Set([language, defaultLocale])) {
      const product = (await strapi.documents(UID.product).findFirst({
        locale,
        status: 'published',
        filters: { slug: { $eq: slug } },
        fields: ['slug', 'name'],
      })) as Doc | null;
      if (product) return { slug: product.slug, name: product.name };
    }
    return null;
  };

/**
 * `lookup` for the piece each row is about, with one lookup per piece and language, shared by every row about it. Make
 * one for each list. A row is a stored question or inquiry, with its `productSlug` and its `language`. A row that isn't
 * about a piece has none, and nothing is looked up for it.
 */
export const rememberProductNames = (lookup: ProductLookup) => {
  const names = new Map<string, Promise<ProductName | null>>();
  return (row: Doc): Promise<ProductName | null> => {
    if (!row.productSlug) return Promise.resolve(null);
    const key = `${row.productSlug} ${row.language}`;
    let name = names.get(key);
    if (!name) {
      name = lookup(row.productSlug, row.language);
      names.set(key, name);
    }
    return name;
  };
};
