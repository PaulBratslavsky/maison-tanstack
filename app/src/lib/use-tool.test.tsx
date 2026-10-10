// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const maisonState = vi.hoisted(() => ({
  value: { status: 'ready', maison: null } as { status: string; maison: { callTool: ReturnType<typeof vi.fn> } | null },
}));

vi.mock('../components/maison-provider', () => ({ useMaison: () => maisonState.value }));

import { useTool } from './use-tool';

type Args = Record<string, unknown> | null;

const okResult = (data: unknown) => ({ content: [], structuredContent: data });
const errorResult = (code: string) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: { code, message: `${code} message`, hint: 'a hint' } }) }],
});

let callTool: ReturnType<typeof vi.fn>;
let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const render = (initial: { screen?: string; name?: string; args: Args }) =>
  renderHook(({ screen, name, args }) => useTool<{ items: string[] }>(screen, name, args), {
    wrapper,
    initialProps: { screen: 'home', name: 'browse_collections', ...initial },
  });

beforeEach(() => {
  callTool = vi.fn(async () => okResult({ items: ['a'] }));
  maisonState.value = { status: 'ready', maison: { callTool } };
  client = new QueryClient();
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe('useTool', () => {
  it('waits, still loading, while args is null', async () => {
    const { result } = render({ args: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callTool).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ loading: true, data: null, error: null });
  });

  it('waits until the customer is signed in', async () => {
    maisonState.value = { status: 'starting', maison: null };
    const { result } = render({ args: { locale: 'en' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callTool).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it('calls the tool once with the screen, the name and the args, and returns the structured content', async () => {
    const { result } = render({ args: { locale: 'en' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith('home', 'browse_collections', { locale: 'en' });
    expect(result.current).toMatchObject({ data: { items: ['a'] }, error: null });
  });

  it('does not call again when a render passes new args with the same content', async () => {
    const { result, rerender } = render({ args: { locale: 'en' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ screen: 'home', name: 'browse_collections', args: { locale: 'en' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('shows a tool refusal as the error, with no data', async () => {
    callTool.mockResolvedValue(errorResult('not_found'));
    const { result } = render({ args: { slug: 'nope' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toEqual({ code: 'not_found', message: 'not_found message', hint: 'a hint' });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('shows a thrown failure as a screen error and does not retry by itself', async () => {
    callTool.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = render({ args: { locale: 'en' } });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatchObject({ code: 'network', message: 'Failed to fetch' });
    expect(result.current.loading).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('retry() calls the tool again and shows the spinner, not the old error, while it runs', async () => {
    callTool.mockRejectedValueOnce(new Error('down'));
    let release: (value: unknown) => void = () => {};
    callTool.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const { result } = render({ args: { locale: 'en' } });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.error).toBeNull();
    release(okResult({ items: ['b'] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: { items: ['b'] }, error: null });
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it('calls again when the args change, and keeps the last answer on screen while it loads', async () => {
    let release: (value: unknown) => void = () => {};
    const { result, rerender } = render({ args: { date: '2026-10-17' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    callTool.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    rerender({ screen: 'home', name: 'browse_collections', args: { date: '2026-10-18' } });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.data).toEqual({ items: ['a'] });
    release(okResult({ items: ['c'] }));
    await waitFor(() => expect(result.current.data).toEqual({ items: ['c'] }));
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool).toHaveBeenLastCalledWith('home', 'browse_collections', { date: '2026-10-18' });
  });

  it("asks again after a language switch, even when the caller's args have no locale", async () => {
    maisonState.value = { status: 'ready', maison: { callTool }, locale: 'en' } as typeof maisonState.value;
    const { result, rerender } = render({ args: { slug: 'weekender-50' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    maisonState.value = { status: 'ready', maison: { callTool }, locale: 'ja' } as typeof maisonState.value;
    rerender({ screen: 'home', name: 'browse_collections', args: { slug: 'weekender-50' } });
    await waitFor(() => expect(callTool).toHaveBeenCalledTimes(2));
  });

  it('keeps the last answer when the args turn null, and does not call', async () => {
    const { result, rerender } = render({ args: { date: '2026-10-17' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ screen: 'home', name: 'browse_collections', args: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ loading: false, data: { items: ['a'] } });
  });

  it('does not call again when the window regains focus', async () => {
    const { result } = render({ args: { locale: 'en' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('calls again when the screen is opened again, so each screen load is one recorded call', async () => {
    const first = render({ args: { locale: 'en' } });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    // Past the short time a closed screen keeps its answer.
    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = render({ args: { locale: 'en' } });
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(callTool).toHaveBeenCalledTimes(2);
  });
});
