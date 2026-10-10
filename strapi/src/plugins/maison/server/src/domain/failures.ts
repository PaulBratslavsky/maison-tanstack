import { failure } from './service-result';

/** Failures the MCP tools and the REST routes answer word for word: tools as tool errors, routes as HTTP errors. */

export const notSignedIn = () =>
  failure(
    'not_signed_in',
    'No signed-in LINE customer is attached to this session.',
    'Customer tools need a session from LINE sign-in. Ask the customer to open the app in LINE, or sign in again. Staff and admin tokens cannot act for a customer.'
  );

export const productNotFound = (slug: string) =>
  failure('not_found', `No published product "${slug}".`, 'Call search_products to find valid product slugs.');

/** Products in a request that aren't published, each named in the order given. */
export const productsNotFound = (slugs: string[]) =>
  failure(
    'not_found',
    `No published ${slugs.length === 1 ? 'product' : 'products'} ${slugs.map((slug) => `"${slug}"`).join(', ')}.`,
    'Call search_products to find valid product slugs.'
  );
