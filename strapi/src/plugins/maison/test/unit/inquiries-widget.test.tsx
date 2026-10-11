// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InquiriesWidget from '../../admin/src/components/InquiriesWidget';
import type { StaffInquiry } from '../../admin/src/inquiries';
import { renderInTheme } from './render';

/*
 * The Homepage widget of the inquiries, with Strapi's fetch client and widget helpers replaced by stand-ins: what is held here is the
 * widget's own. It shows the four counts and a table of the newest five inquiries, loads both every 5 seconds without overlap, and keeps
 * the last result with a note when a refresh fails.
 */
const client = vi.hoisted(() => ({ get: vi.fn() }));
// The same object on every render, as Strapi's hook answers: the hooks list it in their effect dependencies.
const fetchClient = vi.hoisted(() => ({ get: (...args: unknown[]) => client.get(...args) }));

vi.mock('@strapi/strapi/admin', () => ({
  useFetchClient: () => fetchClient,
  Widget: {
    Loading: () => <p>Widget loading</p>,
    Error: ({ children }: { children: React.ReactNode }) => <p>{`Widget error: ${children}`}</p>,
    NoData: ({ children }: { children: React.ReactNode }) => <p>{`Widget no data: ${children}`}</p>,
  },
}));

const SUMMARY = { needsAnswer: 3, complaint: 1, praise: 2, notLabelled: 4 };
const NOW = new Date('2026-10-11T12:00:00.000Z');

/** A row as GET /maison/inquiries answers it, labelled by the model, open, from a masked customer. */
const inquiry = (n: number, over: Partial<StaffInquiry> = {}): StaffInquiry => ({
  documentId: `inq-${n}`,
  createdAt: new Date(NOW.getTime() - n * 10 * 60_000).toISOString(),
  customer: `line:U4af…8${n}`,
  message: `Question number ${n}`,
  reply: null,
  language: 'en',
  product: null,
  knowledgeFound: true,
  handedOff: false,
  question: null,
  kind: 'question',
  sentimentScore: 0.1,
  sentimentLabel: 'neutral',
  answered: true,
  reason: null,
  topic: null,
  analysisStatus: 'analyzed',
  analysisAttempts: 1,
  humanCorrected: false,
  queue: 'none',
  status: 'open',
  closeReason: null,
  replyText: null,
  repliedAt: null,
  repliedBy: null,
  line: null,
  yourLine: false,
  ...over,
});

const FIVE = [1, 2, 3, 4, 5].map((n) => inquiry(n));

/** What the server answers, per address. Each is a function, so a test can change what the next refresh gets. */
const server = {
  summary: (): Promise<unknown> => Promise.resolve({ data: SUMMARY }),
  // A new array on every answer, as parsed JSON is: the widget draws again on each refresh because of it.
  list: (): Promise<unknown> => Promise.resolve({ data: { inquiries: FIVE.map((row) => ({ ...row })) } }),
};

const calls = (address: string) => client.get.mock.calls.filter(([url]) => url === address);

const showWidget = async () => {
  const view = renderInTheme(<InquiriesWidget />);
  // The first loads: both answer at once, and the widget draws on the next turn.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
};
const later = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

/** The CSS styled-components wrote for an element: the rules of its classes. */
const cssOf = (element: Element): string => {
  const all = Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  const classes = Array.from(element.classList);
  return all
    .split('}')
    .filter((rule) => classes.some((name) => rule.trimStart().startsWith(`.${name}`)))
    .map((rule) => `${rule}}`)
    .join('\n');
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  server.summary = () => Promise.resolve({ data: SUMMARY });
  server.list = () => Promise.resolve({ data: { inquiries: FIVE.map((row) => ({ ...row })) } });
  client.get.mockReset();
  client.get.mockImplementation((url: string) => (url === '/maison/inquiries/summary' ? server.summary() : server.list()));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the Maison inquiries widget', () => {
  describe('its data', () => {
    it('asks for the five newest inquiries of every kind, with the list route the Inquiries tab uses', async () => {
      await showWidget();

      expect(calls('/maison/inquiries')[0]).toEqual(['/maison/inquiries', { params: { filter: 'all', limit: 5 } }]);
    });

    it('still asks for the four counts', async () => {
      await showWidget();

      expect(calls('/maison/inquiries/summary')).toHaveLength(1);
      expect(within(screen.getByRole('list', { name: 'Inquiry counts' })).getAllByRole('listitem')).toHaveLength(4);
    });

    it('shows Loading until both have answered', async () => {
      server.list = () => new Promise(() => {});
      renderInTheme(<InquiriesWidget />);
      await later(0);
      expect(screen.getByText('Widget loading')).toBeTruthy();
    });

    it("shows Strapi's error when the list cannot be loaded at all", async () => {
      server.list = () => Promise.reject(new Error('Forbidden'));
      renderInTheme(<InquiriesWidget />);
      await later(0);
      expect(screen.getByText("Widget error: Couldn't load the inquiries: Forbidden")).toBeTruthy();
    });

    it('shows the error when the list is not a list', async () => {
      server.list = () => Promise.resolve({ data: { inquiries: 'none' } });
      renderInTheme(<InquiriesWidget />);
      await later(0);
      expect(screen.getByText(/Widget error: Couldn't load the inquiries: /)).toBeTruthy();
    });
  });

  describe('its table', () => {
    it('shows the five rows under the six columns of the Inquiries tab', async () => {
      await showWidget();
      const table = screen.getByRole('grid', { name: 'Newest inquiries' });

      expect(within(within(table).getAllByRole('row')[0]!).getAllByRole('gridcell').map((cell) => cell.textContent)).toEqual([
        'Received',
        'Customer',
        'Message',
        'Piece',
        'Kind',
        'Status',
      ]);
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(5);
      expect(rows.map((row) => within(row).getAllByRole('gridcell')[2]!.textContent)).toEqual(FIVE.map(({ message }) => message));
    });

    it('has no buttons: the link of the widget is the way to act', async () => {
      await showWidget();
      expect(within(screen.getByRole('grid', { name: 'Newest inquiries' })).queryAllByRole('button')).toHaveLength(0);
    });

    it("shows when each came in as time ago, and the boutique's full time on hover", async () => {
      await showWidget();
      const first = within(screen.getByRole('grid')).getAllByRole('row')[1]!;
      const received = within(first).getAllByRole('gridcell')[0]!;

      expect(received.textContent).toBe('10 min ago');
      // 11:50 UTC on 11 October is 20:50 in Tokyo.
      expect(received.getAttribute('title')).toBe('2026-10-11 20:50');
    });

    it('moves the time ago on with the clock at each refresh', async () => {
      await showWidget();
      await later(5000);
      expect(screen.getByText('10 min ago')).toBeTruthy();
      await later(5 * 60_000);
      expect(screen.getByText('15 min ago')).toBeTruthy();
    });

    it('shows each customer masked, as the server sent them', async () => {
      await showWidget();
      const body = screen.getByRole('grid').textContent!;

      for (const { customer } of FIVE) expect(body).toContain(customer);
      expect(body).not.toMatch(/U4af49806290a28bb/);
    });

    it('marks the presenter\'s own LINE account with the Your LINE badge, and no other row', async () => {
      server.list = () => Promise.resolve({ data: { inquiries: [inquiry(1, { yourLine: true }), inquiry(2)] } });
      await showWidget();
      const rows = within(screen.getByRole('grid')).getAllByRole('row').slice(1);

      expect(within(rows[0]!).getByText('Your LINE')).toBeTruthy();
      expect(within(rows[1]!).queryByText('Your LINE')).toBeNull();
    });

    it('shows a long message on one line, with all of it in the title', async () => {
      const long = 'Could you tell me whether the coffret holds a watch of 42 mm and a ring box too? '.repeat(8).trim();
      server.list = () => Promise.resolve({ data: { inquiries: [inquiry(1, { message: long })] } });
      await showWidget();
      const cell = within(within(screen.getByRole('grid')).getAllByRole('row')[1]!).getAllByRole('gridcell')[2]!;
      const text = within(cell).getByText(long);

      expect(cell.getAttribute('title')).toBe(long);
      expect(cssOf(text)).toMatch(/white-space:\s*nowrap/);
      expect(cssOf(text)).toMatch(/text-overflow:\s*ellipsis/);
    });

    it('shows the piece the customer asked about, or a dash', async () => {
      server.list = () =>
        Promise.resolve({ data: { inquiries: [inquiry(1, { product: { slug: 'jewelry-coffret', name: 'Jewelry Coffret' } }), inquiry(2)] } });
      await showWidget();
      const rows = within(screen.getByRole('grid')).getAllByRole('row').slice(1);

      expect(within(rows[0]!).getAllByRole('gridcell')[3]!.textContent).toBe('Jewelry Coffret');
      expect(within(rows[1]!).getAllByRole('gridcell')[3]!.textContent).toBe('-');
    });

    it("shows the kind and the sentiment the tab shows, and the tab's note for a row that is not labelled", async () => {
      server.list = () =>
        Promise.resolve({
          data: {
            inquiries: [
              inquiry(1, { kind: 'complaint', sentimentLabel: 'negative', sentimentScore: -0.6 }),
              inquiry(2, { kind: null, sentimentLabel: null, sentimentScore: null, analysisStatus: 'pending' }),
              inquiry(3, { kind: 'praise', sentimentLabel: 'positive', sentimentScore: null, humanCorrected: true }),
            ],
          },
        });
      await showWidget();
      const kinds = within(screen.getByRole('grid'))
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('gridcell')[4]!.textContent);

      expect(kinds[0]).toBe('Complaintnegative (-0.6)');
      expect(kinds[1]).toBe('Not labelledWaiting to be labelled');
      expect(kinds[2]).toBe('Praisepositive' + 'Label changed by staff');
    });

    it('shows Open, Replied and Closed as the tab does', async () => {
      server.list = () =>
        Promise.resolve({
          data: {
            inquiries: [
              inquiry(1),
              inquiry(2, { status: 'replied', repliedBy: 'Jane' }),
              inquiry(3, { status: 'closed', closeReason: 'spam' }),
            ],
          },
        });
      await showWidget();
      const statuses = within(screen.getByRole('grid'))
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('gridcell')[5]!.textContent);

      expect(statuses).toEqual(['Open', 'Replied by Jane', 'Closed: spam']);
    });
  });

  describe('its layout', () => {
    it("fills the widget's fixed body: the counts do not shrink, and the table scrolls in its own box below them", async () => {
      await showWidget();
      const ancestors = (element: Element) => {
        const found: Element[] = [];
        for (let node = element.parentElement; node; node = node.parentElement) found.push(node);
        return found;
      };
      const counts = screen.getByRole('list', { name: 'Inquiry counts' });
      const box = ancestors(screen.getByRole('grid')).find((node) => /overflow:\s*auto/.test(cssOf(node)))!;
      const root = box.parentElement!;

      expect(cssOf(root)).toMatch(/height:\s*100%/);
      expect(cssOf(root)).toMatch(/flex-direction:\s*column/);
      expect(cssOf(box)).toMatch(/min-height:\s*0/);
      expect(cssOf(box)).toMatch(/min-width:\s*100%/);
      expect(cssOf(box)).toMatch(/flex-grow:\s*1/);
      const cards = ancestors(counts).find((node) => node.parentElement === root)!;
      expect(cssOf(cards)).toMatch(/flex-shrink:\s*0/);
    });
  });

  describe('with no inquiries', () => {
    it('shows the counts and "No inquiries yet"', async () => {
      server.list = () => Promise.resolve({ data: { inquiries: [] } });
      await showWidget();

      expect(screen.getByText('Widget no data: No inquiries yet')).toBeTruthy();
      expect(screen.getByRole('list', { name: 'Inquiry counts' })).toBeTruthy();
      expect(screen.queryByRole('grid')).toBeNull();
    });
  });

  describe('refreshing', () => {
    it('loads the counts and the rows again every 5 seconds', async () => {
      await showWidget();
      await later(5000);
      await later(5000);

      expect(calls('/maison/inquiries')).toHaveLength(3);
      expect(calls('/maison/inquiries/summary')).toHaveLength(3);
    });

    it('does not start a refresh while the last one is still running', async () => {
      let finish: (value: unknown) => void = () => {};
      await showWidget();
      server.list = () => new Promise((resolve) => (finish = resolve));
      await later(5000); // this refresh starts and does not finish
      await later(30_000);

      expect(calls('/maison/inquiries')).toHaveLength(2);

      await act(async () => finish({ data: { inquiries: FIVE } }));
      await later(5000);
      expect(calls('/maison/inquiries')).toHaveLength(3);
    });

    it('keeps the last rows, with a note, when a refresh fails, and drops the note when one works', async () => {
      await showWidget();
      server.list = () => Promise.reject(new Error('Network down'));
      await later(5000);

      expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(6);
      expect(screen.getByText("Couldn't refresh: Network down. Showing the last result.")).toBeTruthy();

      server.list = () => Promise.resolve({ data: { inquiries: FIVE } });
      await later(5000);
      expect(screen.queryByText(/Couldn't refresh/)).toBeNull();
    });

    it('keeps the last counts and rows, with a note, when the counts fail to refresh', async () => {
      await showWidget();
      server.summary = () => Promise.reject(new Error('Summary down'));
      await later(5000);

      expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(6);
      expect(screen.getByRole('list', { name: 'Inquiry counts' })).toBeTruthy();
      expect(screen.getByText("Couldn't refresh: Summary down. Showing the last result.")).toBeTruthy();
    });

    it('stops polling when the widget leaves the page', async () => {
      const { unmount } = await showWidget();
      unmount();
      await later(30_000);

      expect(calls('/maison/inquiries')).toHaveLength(1);
    });
  });
});
