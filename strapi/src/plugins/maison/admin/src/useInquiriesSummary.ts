import * as React from 'react';

import { useFetchClient } from '@strapi/strapi/admin';

import { isSummary, type InquiriesSummary } from './inquiries';
import { startPolling } from './poll';

const REFRESH_MS = 5000;

/**
 * The open inquiries by queue (GET /maison/inquiries/summary), loaded now and then every 5 seconds. A refresh that fails
 * keeps the last summary and sets `loadError` until the next one works. A new `refreshKey`, or a call to `reload`,
 * starts the loading over, so it loads at once. Nothing is asked until `enabled`: the route refuses an admin who can't
 * review inquiries, and the page calls this before it knows what they may do.
 */
export const useInquiriesSummary = (refreshKey = 0, enabled = true) => {
  const { get } = useFetchClient();
  const [summary, setSummary] = React.useState<InquiriesSummary | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const load = async () => {
      try {
        const { data } = await get<unknown>('/maison/inquiries/summary');
        if (!isSummary(data)) throw new Error('The server sent something else than a summary.');
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
  }, [get, refreshKey, reloads, enabled]);

  const reload = React.useCallback(() => setReloads((count) => count + 1), []);

  return { summary, loadError, reload };
};
