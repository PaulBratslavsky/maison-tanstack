import * as React from 'react';

import { useFetchClient } from '@strapi/strapi/admin';

import { startPolling } from './poll';

/** GET /maison/appointments/summary (RequestsSummary on the server). */
export interface RequestsSummary {
  counts: { waitingForStaff: number; confirmedUpcoming: number; confirmationsSent: number };
  /** The newest requests, newest first. Each is a row of the board's All requests view, without the products. */
  recent: Array<{
    reference: string;
    status: 'requested' | 'confirmed';
    /** Masked on the server, like line:U4af…88. */
    customer: string;
    boutique: { slug: string; name: string } | null;
    requestedFor: string;
    /** What the customer wrote, or an empty string. */
    note: string;
    confirmationSent: boolean;
    /** One of Load demo activity's made-up customers, who gets no LINE message. */
    demoCustomer: boolean;
    /** The presenter's own LINE account (the plugin's demoLineUserId): shown with a "Your LINE" label. */
    yourLine: boolean;
    /** When the request came in, written like `requestedFor`. */
    createdAt: string;
  }>;
}

const REFRESH_MS = 5000;

/**
 * The Maison request summary, loaded now and then every 5 seconds. A refresh that fails keeps the last summary and sets
 * `loadError` until the next one works. A new `refreshKey` starts the loading over, so it loads at once. Nothing is asked
 * until `enabled`: the route refuses an admin who can't review requests, and the Maison page calls this before it knows
 * what they may do.
 */
export const useRequestsSummary = (refreshKey = 0, enabled = true) => {
  const { get } = useFetchClient();
  const [summary, setSummary] = React.useState<RequestsSummary | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const load = async () => {
      try {
        const { data } = await get<RequestsSummary>('/maison/appointments/summary');
        if (!data?.counts || !Array.isArray(data.recent)) throw new Error('The server sent something else than a summary.');
        if (!mounted) return;
        setSummary(data);
        setLoadError(null);
      } catch (error) {
        // The last summary stays on screen, with a note, until a refresh works again.
        if (mounted) setLoadError((error as Error).message);
      }
    };
    // The next refresh starts only after the last one finished, so a slow server never gets overlapping requests.
    const stop = startPolling(load, REFRESH_MS);
    return () => {
      mounted = false;
      stop();
    };
  }, [get, refreshKey, enabled]);

  return { summary, loadError };
};
