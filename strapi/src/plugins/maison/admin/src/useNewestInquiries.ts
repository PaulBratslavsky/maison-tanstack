import * as React from 'react';

import { useFetchClient } from '@strapi/strapi/admin';

import type { StaffInquiry } from './inquiries';
import { startPolling } from './poll';

const REFRESH_MS = 5000;

/** How many of the newest inquiries the Homepage widget shows. */
export const WIDGET_ROWS = 5;

/**
 * The newest inquiries of every kind (GET /maison/inquiries, newest first, customers masked), as many as the Homepage
 * widget shows, loaded now and then every 5 seconds. A refresh that fails keeps the last rows and sets `loadError` until
 * the next one works. `startPolling` starts each load after the last one has finished, so loads never overlap.
 */
export const useNewestInquiries = () => {
  const { get } = useFetchClient();
  const [inquiries, setInquiries] = React.useState<StaffInquiry[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const { data } = await get<{ inquiries?: StaffInquiry[] }>('/maison/inquiries', { params: { filter: 'all', limit: WIDGET_ROWS } });
        if (!Array.isArray(data?.inquiries)) throw new Error('The server sent something else than a list of inquiries.');
        if (!mounted) return;
        setInquiries(data.inquiries);
        setLoadError(null);
      } catch (error) {
        // The last rows stay on screen, with a note, until a refresh works again.
        if (mounted) setLoadError((error as Error).message);
      }
    };
    const stop = startPolling(load, REFRESH_MS);
    return () => {
      mounted = false;
      stop();
    };
  }, [get]);

  return { inquiries, loadError };
};
