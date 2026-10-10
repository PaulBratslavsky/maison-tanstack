// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultVisit } from '../lib/booking';
import type { BoutiqueInfo } from '../lib/types';

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

const maisonState = vi.hoisted(() => ({ callTool: vi.fn() }));

vi.mock('./maison-provider', () => ({
  useMaison: () => ({ maison: { callTool: maisonState.callTool }, locale: 'en' }),
}));
// The availability check is not under test: Ginza is open and has the piece, so the form may send.
vi.mock('../lib/use-tool', () => ({
  useTool: () => ({ loading: false, data: { boutiques: [ginza] }, error: null, retry: () => {} }),
}));

import { BookingForm } from './booking-form';

const appointment = { reference: 'APT-1001', status: 'requested', boutique: { slug: 'ginza', name: 'Ginza Flagship' }, requestedFor: '', products: [], note: '', confirmationSent: false };
const refusal = {
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: { code: 'out_of_stock', message: 'Not in stock.', hint: 'Pick another boutique.' } }) }],
};

let client: QueryClient;
const onBooked = vi.fn();

const renderForm = () =>
  render(
    <QueryClientProvider client={client}>
      <BookingForm screen="product" products={['weekender-50']} initial={defaultVisit()} onBooked={onBooked} header={null} className="" />
    </QueryClientProvider>
  );
const appointmentCalls = () => maisonState.callTool.mock.calls.filter(([, name]) => name === 'request_appointment');
const seedVisits = () => client.setQueryData(['tool', 'visits', 'my_appointments', {}, 'en'], { structuredContent: { appointments: [] } });
const visitsCached = () => client.getQueryCache().findAll({ queryKey: ['tool', 'visits'] }).length > 0;

beforeEach(() => {
  client = new QueryClient();
  onBooked.mockReset();
  maisonState.callTool.mockReset();
  maisonState.callTool.mockResolvedValue({ content: [], structuredContent: { appointment } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe('BookingForm', () => {
  it('sends one request when the form is submitted twice in a row', async () => {
    // The first call stays open, as a slow answer does, so a second submit arrives while it is still out.
    maisonState.callTool.mockReturnValue(new Promise(() => {}));
    const { container } = renderForm();
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(appointmentCalls()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(appointmentCalls()).toHaveLength(1);
  });

  it('lets the customer send again after a refusal', async () => {
    maisonState.callTool.mockResolvedValueOnce(refusal);
    const { container, findByText } = renderForm();
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    await findByText(/Not in stock|stock/);
    fireEvent.submit(form);
    await waitFor(() => expect(appointmentCalls()).toHaveLength(2));
    await waitFor(() => expect(onBooked).toHaveBeenCalledTimes(1));
  });

  it("clears My visits' answers when a booking succeeds, so any caller gets a fresh list", async () => {
    seedVisits();
    const { container } = renderForm();
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith(appointment));
    expect(visitsCached()).toBe(false);
  });

  it("keeps My visits' answers when the request is refused", async () => {
    seedVisits();
    maisonState.callTool.mockResolvedValue(refusal);
    const { container, findByText } = renderForm();
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await findByText(/stock/);
    expect(onBooked).not.toHaveBeenCalled();
    expect(visitsCached()).toBe(true);
  });
});
