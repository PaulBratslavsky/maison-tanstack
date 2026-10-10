// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toolDefinition } from '@tanstack/ai';
import type { ConnectionAdapter } from '@tanstack/ai-client';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defaultVisit } from '../lib/booking';
import { chooseVisitDefinition } from '../lib/concierge/local-tools';
import { answer, chatConnection, refusal, scriptedModel, type Step } from '../lib/concierge/test-support';
import type { BoutiqueInfo } from '../lib/types';
import { CHOOSE_VISIT } from '../lib/visit-picker';

const ginza: BoutiqueInfo = {
  slug: 'ginza',
  name: 'Ginza Flagship',
  city: 'Tokyo',
  address: 'Ginza (demo)',
  hours: [],
  openOnDate: true,
  hoursOnDate: { opens: '11:00', closes: '20:00' },
  stock: [{ product: 'weekender-50', quantity: 1 }],
};

const state = vi.hoisted(() => ({ callTool: vi.fn(), locale: 'en', toolArgs: [] as Array<[string, string, unknown]> }));

vi.mock('./maison-provider', () => ({
  useMaison: () => ({ maison: { callTool: state.callTool }, locale: state.locale, friendFlag: null }),
}));
// Strapi is not under test: Ginza is open and has the piece, and view_product names the piece.
vi.mock('../lib/use-tool', () => ({
  useTool: (screenName: string, name: string, args: unknown) => {
    state.toolArgs.push([screenName, name, args]);
    return name === 'view_product'
      ? { loading: false, data: { product: { name: 'Weekender 50' } }, error: null, retry: () => {} }
      : { loading: false, data: { boutiques: [ginza] }, error: null, retry: () => {} };
  },
}));
// A link is a plain anchor: the router is not under test.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children: ReactNode }) => (
    <a href={Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)} {...rest}>
      {children}
    </a>
  ),
}));

import { AssistantParts } from './chat-parts';
import { ConciergeChat } from './concierge-chat';

const appointment = {
  reference: 'APT-0042',
  status: 'requested',
  boutique: { slug: 'ginza', name: 'Ginza Flagship' },
  requestedFor: '2026-10-10T14:00:00+09:00',
  products: [{ slug: 'weekender-50', name: 'Weekender 50' }],
  note: '',
  confirmationSent: false,
};
const pieces = [
  { slug: 'weekender-50', name: 'Weekender 50', category: 'bags', priceJpy: 380000, imageUrl: null, occasions: [], personalizable: true, inStockAt: ['ginza'] },
  { slug: 'cabin-case-55', name: 'Cabin Case 55', category: 'bags', priceJpy: 290000, imageUrl: null, occasions: [], personalizable: true, inStockAt: ['ginza'] },
];

/** The route's tools as the model sees them: Maison's (run on the server), resolve_date, and choose_visit (the browser's). */
const serverTools = (handlers: { search_knowledge?: () => unknown; hand_off_to_staff?: () => unknown } = {}) => [
  toolDefinition({ name: 'search_products', description: 'Searches.', inputSchema: z.object({ query: z.string() }) }).server(async () => answer({ products: pieces })),
  toolDefinition({ name: 'search_knowledge', description: 'Searches.', inputSchema: z.object({ query: z.string() }) }).server(async () => (handlers.search_knowledge?.() ?? answer({ entries: [] })) as never),
  toolDefinition({ name: 'hand_off_to_staff', description: 'Hands off.', inputSchema: z.object({ question: z.string() }) }).server(async () => (handlers.hand_off_to_staff?.() ?? answer({ question: { reference: 'Q-4821' } })) as never),
  toolDefinition({ name: 'resolve_date', description: 'Resolves.', inputSchema: z.object({ phrase: z.string() }) }).server(async () => ({ date: '2026-10-10', weekday: 'Saturday' })),
  chooseVisitDefinition.client(),
];

/** The demo's first turn: a search, a date, and the picker. */
const toPicker: Step[] = [
  {
    words: 'Here are two pieces for a traveller.',
    calls: [
      { id: 'c-search', name: 'search_products', input: { query: 'travel' } },
      { id: 'c-date', name: 'resolve_date', input: { phrase: 'Saturday' } },
    ],
  },
  { words: 'Pick the details here.', calls: [{ id: 'c-picker', name: CHOOSE_VISIT, input: { productSlugs: ['weekender-50'], boutique: 'ginza', time: '14:00' } }] },
];

let client: QueryClient;

/** The chat page on a scripted model: the steps, and the tools the route would give it. */
const mount = (steps: Step[], { piece = null, tools = serverTools() }: { piece?: string | null; tools?: ReturnType<typeof serverTools> } = {}) => {
  const model = scriptedModel(steps);
  const { connection, requests } = chatConnection(model, tools);
  const view = render(
    <QueryClientProvider client={client}>
      <ConciergeChat piece={piece} connection={connection} />
    </QueryClientProvider>
  );
  return { ...view, model, requests, connection };
};

const FIRST = /gift under/;
const composer = () => screen.getByPlaceholderText('Write a message') as HTMLInputElement;
const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
const chip = (name: RegExp) => screen.getByRole('button', { name: name }) as HTMLButtonElement;
const lines = () => screen.queryAllByTestId('tool-chip').map((node) => node.textContent);
const appointmentCalls = () => state.callTool.mock.calls.filter(([, name]) => name === 'request_appointment');
const refusalOfBoutique = refusal('boutique_closed', 'Closed.', 'Pick another time.');
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

/** Taps the first suggestion and waits for the picker's form. */
const askForVisit = async (view: ReturnType<typeof mount>) => {
  fireEvent.click(chip(FIRST));
  await screen.findByTestId('visit-picker');
  return view;
};

beforeEach(() => {
  client = new QueryClient();
  state.callTool.mockReset();
  state.callTool.mockResolvedValue({ content: [], structuredContent: { appointment } });
  state.locale = 'en';
  state.toolArgs = [];
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe('the concierge before a message', () => {
  it('shows the intro, the two suggestions and the composer', () => {
    mount([]);
    expect(screen.getByText('I can help you choose a gift and book a boutique visit.')).toBeTruthy();
    expect(chip(FIRST)).toBeTruthy();
    expect(chip(/Can I book a visit\?/)).toBeTruthy();
    expect(composer().maxLength).toBe(1000);
    expect(sendButton().disabled).toBe(true); // nothing typed
  });

  it("shows the piece's intro and its three suggestions when the customer asked about a piece", () => {
    mount([], { piece: 'weekender-50' });
    expect(screen.getByText('Ask me anything about this piece: care, sizing, personalization, delivery.')).toBeTruthy();
    expect(chip(/personalized/)).toBeTruthy();
    expect(chip(/care for it/)).toBeTruthy();
    expect(chip(/Which boutique has it in stock/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: FIRST })).toBeNull();
  });

  it('writes in Japanese when the language is Japanese', () => {
    state.locale = 'ja';
    mount([]);
    expect(screen.getByText('ギフト選びやご来店のご予約をお手伝いします。')).toBeTruthy();
    expect(screen.getByPlaceholderText('メッセージを入力')).toBeTruthy();
  });
});

describe('a visit picker in the chat', () => {
  it("shows the customer's message, the tool lines, the pieces found and the picker with the piece's name, filled in from the call", async () => {
    await askForVisit(mount(toPicker));
    const user = screen.getByTestId('message-user');
    expect(user.textContent).toMatch(FIRST);
    expect(screen.getByText('Here are two pieces for a traveller.')).toBeTruthy();
    expect(lines()).toEqual(['MCP · search_products ✓ 2 results', 'Local · resolve_date ✓ Saturday 2026-10-10', 'Local · choose_visit']);
    // The pieces found are links to their pages.
    expect(screen.getByRole('link', { name: /Weekender 50/ }).getAttribute('href')).toBe('/products/weekender-50');
    const picker = screen.getByTestId('visit-picker');
    expect(within(picker).getByRole('heading', { name: 'Book a visit' })).toBeTruthy();
    // The name is the one view_product gave, in the chat's language, never the model's words.
    expect(within(picker).getByText('Weekender 50')).toBeTruthy();
    expect(state.toolArgs).toContainEqual(['concierge', 'view_product', { slug: 'weekender-50', locale: 'en' }]);
    expect(state.toolArgs).toContainEqual(['concierge', 'find_boutiques', expect.objectContaining({ productSlugs: ['weekender-50'] })]);
    expect((within(picker).getByRole('radio', { name: /Ginza Flagship/ }) as HTMLInputElement).checked).toBe(true);
    expect(within(picker).getByRole('radio', { name: '14:00' }).getAttribute('aria-checked')).toBe('true');
    expect(within(picker).getByRole('button', { name: 'Not now' })).toBeTruthy();
  });

  it('puts the pieces found above the picker, under the words that suggested them', async () => {
    await askForVisit(mount(toPicker));
    const grid = screen.getByRole('link', { name: /Weekender 50/ });
    const picker = screen.getByTestId('visit-picker');
    expect(grid.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('holds the composer and the suggestions while the picker waits: nothing can be sent, by button or by Enter', async () => {
    const view = await askForVisit(mount(toPicker));
    fireEvent.change(composer(), { target: { value: 'Something else' } });
    expect(sendButton().disabled).toBe(true);
    expect(chip(FIRST).disabled).toBe(true);
    expect(chip(/Can I book a visit\?/).disabled).toBe(true);
    // A message that gets past the buttons (Enter in the field) is not sent: ChatClient would refuse it.
    fireEvent.submit(composer().closest('form') as HTMLFormElement);
    await settle();
    expect(view.requests).toHaveLength(1);
    expect(composer().value).toBe('Something else'); // kept, not lost
    expect(screen.queryByText('No request sent.')).toBeNull();
  });

  it("sends the request with the customer's session, answers the tool, and the concierge goes on once, in a new message", async () => {
    const view = mount([...toPicker, { words: 'Your visit is requested. The boutique will confirm it on LINE.' }]);
    await askForVisit(view);
    fireEvent.click(within(screen.getByTestId('visit-picker')).getByRole('button', { name: 'Send request' }));
    await screen.findByText('Your visit is requested. The boutique will confirm it on LINE.');
    await settle();

    expect(appointmentCalls()).toHaveLength(1);
    expect(state.callTool).toHaveBeenCalledWith('concierge', 'request_appointment', {
      boutique: 'ginza',
      productSlugs: ['weekender-50'],
      requestedFor: `${defaultVisit().date}T14:00:00+09:00`,
      locale: 'en',
    });
    // One answer, one follow-up request, which carries the answer. Nothing after it.
    expect(view.requests).toHaveLength(2);
    expect(view.model.modelCalls()).toBe(3);
    const answered = view.requests[1].flatMap((message) => message.parts).find((part) => part.type === 'tool-call' && part.name === CHOOSE_VISIT);
    expect(answered).toMatchObject({ state: 'complete', output: { status: 'requested', appointment } });
    // The form is replaced by the visit's card, which leads to its page, with the lines of both calls.
    expect(screen.queryByTestId('visit-picker')).toBeNull();
    expect(screen.getByRole('link', { name: /APT-0042/ }).getAttribute('href')).toBe('/visits/APT-0042');
    expect(lines()).toContain('Local · choose_visit ✓ requested');
    expect(lines()).toContain('MCP · request_appointment ✓');
    // The composer is free again.
    expect(chip(FIRST).disabled).toBe(false);
    expect(screen.queryByText('No reply came back.')).toBeNull();
  });

  it('answers closed on Not now, goes on once, and says it closed without a request', async () => {
    const view = mount([...toPicker, { words: 'Of course. I am here if you change your mind.' }]);
    await askForVisit(view);
    fireEvent.click(within(screen.getByTestId('visit-picker')).getByRole('button', { name: 'Not now' }));
    await screen.findByText('Of course. I am here if you change your mind.');
    await settle();
    expect(appointmentCalls()).toHaveLength(0);
    expect(view.requests).toHaveLength(2);
    const answered = view.requests[1].flatMap((message) => message.parts).find((part) => part.type === 'tool-call' && part.name === CHOOSE_VISIT);
    expect(answered).toMatchObject({ state: 'complete', output: { status: 'closed' } });
    expect(screen.getByText('Closed without a request.')).toBeTruthy();
    expect(lines()).toContain('Local · choose_visit ✓ closed');
    expect(lines()).not.toContain('MCP · request_appointment ✓');
    expect(chip(FIRST).disabled).toBe(false);
  });

  it('keeps a refused booking in the form: the reason shows, nothing goes to the concierge, and the composer stays held', async () => {
    state.callTool.mockResolvedValue(refusalOfBoutique);
    const view = await askForVisit(mount([...toPicker, { words: 'Never sent.' }]));
    fireEvent.click(within(screen.getByTestId('visit-picker')).getByRole('button', { name: 'Send request' }));
    await within(screen.getByTestId('visit-picker')).findByText('Ginza Flagship is closed at that time.');
    await settle();
    expect(appointmentCalls()).toHaveLength(1);
    expect(view.requests).toHaveLength(1);
    expect(screen.getByTestId('visit-picker')).toBeTruthy();
    expect(lines()).not.toContain('MCP · request_appointment ✓');
    // The picker still waits for its answer, so the composer is still held.
    expect(chip(FIRST).disabled).toBe(true);
    // The customer can try again from the form.
    state.callTool.mockResolvedValue({ content: [], structuredContent: { appointment } });
    fireEvent.click(within(screen.getByTestId('visit-picker')).getByRole('button', { name: 'Send request' }));
    await screen.findByRole('link', { name: /APT-0042/ });
  });

  it("holds the composer, and Not now, while the picker's request is on its way", async () => {
    state.callTool.mockReturnValue(new Promise(() => {}));
    const view = await askForVisit(mount(toPicker));
    fireEvent.click(within(screen.getByTestId('visit-picker')).getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(appointmentCalls()).toHaveLength(1));
    expect(chip(FIRST).disabled).toBe(true);
    expect((within(screen.getByTestId('visit-picker')).getByRole('button', { name: 'Not now' }) as HTMLButtonElement).disabled).toBe(true);
    await settle();
    expect(view.requests).toHaveLength(1);
  });

  it('says no request was sent for a picker the customer moved past, and shows no form for it', () => {
    // The composer is held while a picker waits, so this is reached only through a conversation the page did not make.
    const part = { type: 'tool-call', id: 'old-picker', name: CHOOSE_VISIT, state: 'input-complete', input: { productSlugs: ['weekender-50'] } };
    render(
      <QueryClientProvider client={client}>
        <AssistantParts parts={[part]} locale="en" picker={{ live: null, busy: false, answer: () => {}, onSending: () => {} }} />
      </QueryClientProvider>
    );
    expect(screen.getByText('No request sent.')).toBeTruthy();
    expect(screen.queryByTestId('visit-picker')).toBeNull();
  });

  it('never scrolls the page itself: the conversation scrolls inside its own container', async () => {
    await askForVisit(mount(toPicker));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('tool lines and notes', () => {
  it('shows a note under a knowledge search that found nothing, and no Try again: the note and the LINE chat are the answer', async () => {
    mount([{ calls: [{ id: 'c-k', name: 'search_knowledge', input: { query: 'bitcoin' } }] }, {}]);
    fireEvent.click(chip(/Can I book a visit\?/));
    await screen.findByText("Our team answers questions like this in Maison's LINE chat.");
    await waitFor(() => expect(lines()).toContain('MCP · search_knowledge ✓ 0 results'));
    expect(screen.queryByText('No reply came back.')).toBeNull();
  });

  it("shows the hand-off's note with its reference once Strapi recorded the question", async () => {
    mount([{ calls: [{ id: 'c-h', name: 'hand_off_to_staff', input: { question: 'Can I pay in bitcoin?' } }] }, {}]);
    fireEvent.click(chip(/Can I book a visit\?/));
    await screen.findByText(/Q-4821/);
    expect(lines()).toContain('MCP · hand_off_to_staff ✓');
    expect(screen.queryByText('No reply came back.')).toBeNull();
  });

  it('shows a refused call in the error colour with its code', async () => {
    mount([{ calls: [{ id: 'c-s', name: 'search_products', input: { query: 'x' } }] }, { words: 'Sorry.' }], {
      tools: [
        toolDefinition({ name: 'search_products', description: 'Searches.', inputSchema: z.object({ query: z.string() }) }).server(async () => refusal('not_found', 'No piece.', 'Try again.') as never),
        ...serverTools().slice(1),
      ],
    });
    fireEvent.click(chip(/Can I book a visit\?/));
    await screen.findByText('Sorry.');
    const line = screen.getByText('MCP · search_products ✕ not_found');
    expect(line.className).toContain('text-error');
  });

  it("shows the concierge's words with bold and lists, as elements and never as markup", async () => {
    mount([{ words: 'Two **good** ideas:\n1. The Weekender\n2. The Cabin Case\n<img src=x onerror=alert(1)>' }]);
    fireEvent.click(chip(/Can I book a visit\?/));
    await screen.findByText('good');
    expect(screen.getByText('good').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['The Weekender', 'The Cabin Case']);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
  });
});

describe('Try again', () => {
  it('offers it after a reply of tool calls and no words, and asks again once when it is pressed', async () => {
    const view = mount([{ calls: [{ id: 'c-s', name: 'search_products', input: { query: 'x' } }] }, {}, { words: 'Here you are.' }]);
    fireEvent.click(chip(/Can I book a visit\?/));
    const retry = await screen.findByTestId('retry-reply');
    expect(screen.getByText('No reply came back.')).toBeTruthy();
    expect(view.requests).toHaveLength(1);
    fireEvent.click(retry);
    await screen.findByText('Here you are.');
    await settle();
    expect(view.requests).toHaveLength(2);
    expect(screen.queryByTestId('retry-reply')).toBeNull();
    // The customer's message is there once: asking again does not send it twice.
    expect(screen.getAllByTestId('message-user')).toHaveLength(1);
  });

  it('is not offered while a picker waits, or after a booking: asking again could book twice', async () => {
    await askForVisit(mount([...toPicker, {}]));
    expect(screen.queryByTestId('retry-reply')).toBeNull();
    fireEvent.click(within(screen.getByTestId('visit-picker')).getByRole('button', { name: 'Send request' }));
    await screen.findByRole('link', { name: /APT-0042/ });
    await settle();
    // The reply after the answer was empty and made no message; the booking's own message ends in the card.
    expect(screen.queryByTestId('retry-reply')).toBeNull();
  });
});

describe('errors', () => {
  const failing = (error: Error): ConnectionAdapter => ({
    // eslint-disable-next-line require-yield
    async *connect() {
      throw error;
    },
  });
  const mountFailing = (error: Error) => {
    render(
      <QueryClientProvider client={client}>
        <ConciergeChat piece={null} connection={failing(error)} />
      </QueryClientProvider>
    );
    fireEvent.click(chip(/Can I book a visit\?/));
  };

  it('shows the customer copy for a refused session', async () => {
    mountFailing(new Error('HTTP error! status: 401 Unauthorized'));
    expect((await screen.findByRole('alert')).textContent).toContain('Please sign in with LINE.');
  });

  it('shows the generic copy for a model failure, and the route’s own words on the technical line in mock mode', async () => {
    mountFailing(new Error("The concierge's model (the scripted model) isn't reachable."));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Something went wrong. Please try again.');
    expect(alert.textContent).toContain("isn't reachable");
  });

  it('shows the network copy when the request cannot be made', async () => {
    mountFailing(new TypeError('Failed to fetch'));
    expect((await screen.findByRole('alert')).textContent).toContain("We can't reach Maison right now.");
  });

  it('lets the customer write again after an error', async () => {
    mountFailing(new TypeError('Failed to fetch'));
    await screen.findByRole('alert');
    expect(chip(FIRST).disabled).toBe(false);
  });
});
