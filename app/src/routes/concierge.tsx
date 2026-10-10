import { createFileRoute } from '@tanstack/react-router';

import { ConciergeChat } from '../components/concierge-chat';
import { useMaison } from '../components/maison-provider';
import { Screen } from '../components/screen';
import { conciergeSearch } from '../lib/concierge-search';
import { COPY } from '../lib/copy';

/**
 * The 8 tools the concierge's customer session lists for the model, as the title bar's "8 MCP tools" button names them.
 * `log_inquiry` is the app server's, after a turn, and isn't listed (the ledger has the count).
 */
const CONCIERGE_TOOLS = ['browse_collections', 'search_products', 'view_product', 'find_boutiques', 'search_knowledge', 'request_appointment', 'my_appointments', 'hand_off_to_staff'];

/**
 * The concierge, as in the mockup: a title bar with the "N MCP tools" button (Screen's `title`), the conversation, and an
 * input bar pinned at the bottom (components/concierge-chat.tsx). From a product's "Ask about this piece"
 * (/concierge?product=<slug>) it has that piece in context: the intro and the suggestions are about the piece, and the slug
 * goes to the server with each turn, which adds one instruction about it. A `product` that is not a slug is dropped.
 */
export const Route = createFileRoute('/concierge')({
  validateSearch: conciergeSearch,
  component: ConciergePage,
});

function ConciergePage() {
  const { locale } = useMaison();
  const piece = Route.useSearch().product ?? null;
  return (
    <Screen name="concierge" tools={CONCIERGE_TOOLS} title={COPY[locale].concierge} fill>
      <ConciergeChat piece={piece} />
    </Screen>
  );
}
