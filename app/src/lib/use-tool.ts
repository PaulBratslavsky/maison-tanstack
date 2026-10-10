import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useMaison } from '../components/maison-provider';
import { toolErrorOf } from './mcp';
import { errorOf, type ScreenError } from './status';

/**
 * How long a closed screen keeps its answer. It is short on purpose: a screen opened again asks again (so the agent view
 * records one call per screen load, and My visits never shows a list from before a booking), but a screen that renders
 * and commits a moment apart must not lose its query in between.
 */
const KEEP_MS = 5_000;

/**
 * Calls one Maison tool once the customer is signed in, and again whenever `args` change.
 * Pass `null` as args to wait. Returns the structured result, or the tool's error.
 *
 * It runs on TanStack Query. The key is ['tool', screen, name, args], so two readers of one call share it, and the
 * query runs once per mount: no retries, and no refetch on focus or reconnect, because every call is shown in the agent
 * view and a repeat the customer did not cause would be noise. Like the original hook, it keeps the last answer on
 * screen while a new one loads (the booking sheet's days), and a retry shows the spinner, not the error it retries.
 * A tool's refusal is an answer, so it is returned and not thrown: only a failure on the way (network, sign-in) is a
 * Query error.
 */
export function useTool<T>(screen: string, name: string, args: Record<string, unknown> | null) {
  const { status, maison } = useMaison();
  const enabled = status === 'ready' && maison !== null && args !== null;
  const query = useQuery<CallToolResult>({
    queryKey: ['tool', screen, name, args],
    queryFn: () => maison!.callTool(screen, name, args!),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: KEEP_MS,
    placeholderData: keepPreviousData,
  });

  const result = query.data ?? null;
  const thrown = query.isFetching ? null : query.error;
  const error: ScreenError | null = (result && !query.isFetching ? toolErrorOf(result) : null) ?? (thrown ? errorOf(thrown) : null);
  // Loading until the first answer, as the original's hook is, even while it waits for sign-in or for args.
  const loading = query.isFetching || (result === null && thrown === null);
  return {
    loading,
    data: (result?.structuredContent as T | undefined) ?? null,
    error,
    // Nothing to retry while it waits for sign-in or for args.
    retry: () => {
      if (enabled) void query.refetch();
    },
  };
}
