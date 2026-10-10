import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { COPY } from '../copy';
import { CHOOSE_VISIT } from '../visit-picker';
import { assistantWith, cleanup, converse, say, toolCall } from './handle-support';
import { answer, type Step } from './test-support';

/**
 * The canned streams the Playwright tests answer `POST /api/concierge` with (app/e2e/fixtures). Each is the route's own
 * output, recorded here from `handleConcierge` with a scripted model and Strapi in memory: nothing calls a model. They are
 * checked in, and these tests fail when the route's wire format changes, so the end-to-end tests never replay a stale
 * stream. To record them again, run `RECORD=1 npx vitest run src/lib/concierge/recordings.test.ts` in app/.
 *
 * Normalized so a recording is the same each time: timestamps are 0, and message creation times are one fixed time. The
 * ids a request fixes (run, thread, the customer's message, the concierge's message) are `run-1`, `thread-1`, `u1` and
 * `a1`: the end-to-end tests put the page's own in. The date of the picker, `2026-10-10`, is put the same way.
 */

afterEach(cleanup);

const FIXTURES = new URL('../../../e2e/fixtures/', import.meta.url);
const record = process.env.RECORD === '1';

const normalize = (text: string) => text.replace(/"timestamp":\d+/g, '"timestamp":0').replace(/"createdAt":"[^"]+"/g, '"createdAt":"2026-10-10T00:00:00.000Z"');

/** The recording's own file, written when RECORD=1, else read. */
const fixture = (name: string, actual: string): string => {
  const file = new URL(name, FIXTURES);
  if (record) writeFileSync(file, actual);
  return readFileSync(file, 'utf8');
};

/** The picker's call, as the model writes it for the demo's first suggestion: Ginza, the next Saturday (10 October), 14:00. */
const pickerInput = { productSlugs: ['weekender-50'], boutique: 'ginza', date: '2026-10-10', time: '14:00' };
const found = [
  { slug: 'weekender-50', name: 'Weekender 50', category: 'bags', priceJpy: 385000, imageUrl: null, occasions: ['travel'], personalizable: true, inStockAt: ['ginza'] },
  { slug: 'carnet-wallet', name: 'Carnet Wallet', category: 'small-leather-goods', priceJpy: 98000, imageUrl: null, occasions: ['travel'], personalizable: true, inStockAt: ['ginza'] },
  { slug: 'passport-cover', name: 'Passport Cover', category: 'small-leather-goods', priceJpy: 64000, imageUrl: null, occasions: ['travel'], personalizable: true, inStockAt: ['ginza'] },
];
/** The demo's first turn: the model searches, resolves "Saturday", and shows the picker. */
const firstTurn: Step[] = [
  {
    words: 'Here are three pieces for a friend who travels.',
    calls: [
      { id: 'call-search', name: 'search_products', input: { query: 'travel gift', maxPriceJpy: 400000 } },
      { id: 'call-date', name: 'resolve_date', input: { weekday: 'saturday' } },
    ],
  },
  { words: 'I set the form to Saturday at 2 pm in Ginza. Check it and send the request.', calls: [{ id: 'call-picker', name: CHOOSE_VISIT, input: pickerInput }] },
];
/** The conversation after the picker: the customer's first message, and the concierge's with the picker answered. */
const afterPicker = (output: unknown) => [
  say(COPY.en.suggestions[0]),
  assistantWith([{ type: 'text', content: 'I set the form to Saturday at 2 pm in Ginza. Check it and send the request.' } as never, toolCall('call-picker', CHOOSE_VISIT, pickerInput, output)], 'a1'),
];
/** The reply to an answer is a new message: its id must not be the first turn's `message-1`, which the page already holds. */
const asNewMessage = (text: string) => text.replaceAll('message-1', 'message-reply');

const recording = async (options: Parameters<typeof converse>[0]) => {
  const { response } = await converse({ ...options, read: false, locale: 'en' });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  return normalize(await response.text());
};

describe('the recorded streams', () => {
  it('the demo first turn: words, a search and a date, then the picker call, waiting for the customer', async () => {
    const actual = await recording({
      messages: [say(COPY.en.suggestions[0])],
      steps: firstTurn,
      strapi: { handlers: { search_products: () => answer({ products: found }) } },
    });
    expect(actual).toBe(fixture('concierge-first-turn.sse', actual));
    // What the page reads from it: the picker call is last, and the run ends at an interrupt for the client tool.
    expect(actual).toContain('"toolCallName":"choose_visit"');
    expect(actual).toContain('"type":"interrupt"');
  });

  it('the reply after a visit was requested: words only, in a message of its own', async () => {
    const actual = asNewMessage(
      await recording({
        messages: afterPicker({ status: 'requested', appointment: { reference: 'APT-0042', status: 'requested', boutique: { slug: 'ginza', name: 'Ginza Flagship' }, requestedFor: '2026-10-10T14:00:00+09:00', products: [{ slug: 'weekender-50', name: 'Weekender 50' }], note: '', confirmationSent: false } }),
        steps: [{ words: 'Your visit is requested. The boutique will confirm it on LINE.' }],
      })
    );
    expect(actual).toBe(fixture('concierge-after-request.sse', actual));
    expect(actual).not.toContain('MESSAGES_SNAPSHOT');
  });

  it('the reply after Not now: words only, in a message of its own', async () => {
    const actual = asNewMessage(await recording({ messages: afterPicker({ status: 'closed' }), steps: [{ words: 'Of course. I am here if you change your mind.' }] }));
    expect(actual).toBe(fixture('concierge-after-closed.sse', actual));
  });
});
