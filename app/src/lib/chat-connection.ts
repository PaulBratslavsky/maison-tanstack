import { fetchServerSentEvents } from '@tanstack/ai-client';

import type { Locale } from './types';

/** What the page tells the route with each message: the customer's language, and the piece they asked about, if any. */
export interface ChatSettings {
  locale: Locale;
  product: string | null;
}

/**
 * The concierge page's connection to `POST /api/concierge`: TanStack AI's server-sent events adapter (ai-client's
 * `fetchServerSentEvents`). Its options are a function, which the adapter calls for each request, so everything here is
 * read when a message is sent and never earlier:
 * - `Authorization`: the customer's own session token, a fresh one each time (the session renews it). The route passes it
 *   on to Strapi unchanged.
 * - `body`: the adapter puts it in the request's `forwardedProps`, which is where `handleConcierge` reads `locale` and
 *   `product` (lib/concierge/handle.ts). `useChat`'s own `body` option is deprecated, and it is fixed when the chat starts.
 *   A language switch and a new piece apply to the next send through `read`.
 */
export const conciergeConnection = ({
  url = '/api/concierge',
  getToken,
  extraHeaders,
  read,
  fetchClient,
}: {
  url?: string;
  getToken: () => Promise<string>;
  /** More request headers, such as the tunnel's (tunnelHeaders in lib/tunnel.ts). */
  extraHeaders?: () => Record<string, string>;
  read: () => ChatSettings;
  /** A test's own `fetch`. */
  fetchClient?: typeof fetch;
}) =>
  fetchServerSentEvents(url, async () => {
    const { locale, product } = read();
    return {
      headers: { Authorization: `Bearer ${await getToken()}`, ...extraHeaders?.() },
      body: { locale, ...(product ? { product } : {}) },
      ...(fetchClient ? { fetchClient } : {}),
    };
  });
