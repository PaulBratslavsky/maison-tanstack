// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantProvider, useAssistant } from '../../admin/src/components/assistant/AssistantProvider';
import { renderInTheme } from './render';

/*
 * The assistant is on every admin page, so its provider is on every admin page. It must ask the server nothing until staff open the drawer
 * the first time. These tests render the real provider over a stand-in for Strapi's fetch client, and nothing reaches a server.
 */
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@strapi/strapi/admin', () => ({ useFetchClient: () => client }));

const READY = { ready: true, model: 'claude-sonnet-5-5', tools: [{ name: 'list_requests', label: 'Visit requests' }] };

const Probe = () => {
  const assistant = useAssistant();
  if (!assistant) return <p data-testid="probe">no provider</p>;
  return <p data-testid="probe">{assistant.ready ? 'ready' : 'waiting'}</p>;
};

const callsTo = (url: string) => client.get.mock.calls.filter(([called]) => called === url).length;

beforeEach(() => {
  for (const method of [client.get, client.post, client.put, client.del]) method.mockReset();
  client.get.mockImplementation(async (url: string) => {
    if (url === '/maison/assistant/status') return { data: READY };
    if (url === '/maison/conversations') return { data: { conversations: [] } };
    throw new Error(`Unexpected GET ${url}`);
  });
});

describe('AssistantProvider, before the drawer has been opened', () => {
  it('asks the server nothing while it has not started: no status, and no saved chats', async () => {
    renderInTheme(
      <AssistantProvider started={false}>
        <Probe />
      </AssistantProvider>
    );
    // Long enough for an effect to run and a request to be made, if one were going to be.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(client.get).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe').textContent).toBe('waiting');
  });

  it('asks for the status when it starts, and loads the saved chats once the assistant is ready', async () => {
    const view = renderInTheme(
      <AssistantProvider started={false}>
        <Probe />
      </AssistantProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.get).not.toHaveBeenCalled();

    view.rerender(
      <AssistantProvider started>
        <Probe />
      </AssistantProvider>
    );

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready'));
    expect(callsTo('/maison/assistant/status')).toBe(1);
    await waitFor(() => expect(callsTo('/maison/conversations')).toBe(1));
  });

  it('asks once, however often it renders after it has started', async () => {
    const view = renderInTheme(
      <AssistantProvider started>
        <Probe />
      </AssistantProvider>
    );
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready'));
    for (let round = 0; round < 3; round += 1) {
      view.rerender(
        <AssistantProvider started>
          <Probe />
          <span>{round}</span>
        </AssistantProvider>
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(callsTo('/maison/assistant/status')).toBe(1);
    expect(callsTo('/maison/conversations')).toBe(1);
  });

  it('keeps what it has loaded when it is told it has not started: it never goes back', async () => {
    const view = renderInTheme(
      <AssistantProvider started>
        <Probe />
      </AssistantProvider>
    );
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready'));

    view.rerender(
      <AssistantProvider started={false}>
        <Probe />
      </AssistantProvider>
    );

    expect(screen.getByTestId('probe').textContent).toBe('ready');
    expect(callsTo('/maison/assistant/status')).toBe(1);
  });
});
