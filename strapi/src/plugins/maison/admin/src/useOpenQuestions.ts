import * as React from 'react';

import { useFetchClient } from '@strapi/strapi/admin';

import { startPolling } from './poll';
import { OPEN_QUESTIONS, countOfQuestions } from './questions';

const REFRESH_MS = 5000;

/**
 * How many questions are open or taken (GET /maison/questions with the Open filter, counted), loaded now and then every
 * 5 seconds, for the number on the Questions tab. The tab's own list asks for the same rows, but it asks only while it
 * is on screen, and the number is needed on the other tabs too. A refresh that fails keeps the last count and sets
 * `loadError` until the next one works. A new `refreshKey`, or a call to `reload`, starts the loading over, so it loads
 * at once. Nothing is asked until `enabled`: the route refuses an admin who can't read questions, and the page calls
 * this before it knows what they may do.
 */
export const useOpenQuestions = (refreshKey = 0, enabled = true) => {
  const { get } = useFetchClient();
  const [count, setCount] = React.useState<number | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const load = async () => {
      try {
        const { data } = await get<unknown>('/maison/questions', { params: OPEN_QUESTIONS });
        const counted = countOfQuestions(data);
        if (counted === null) throw new Error('The server sent something else than questions.');
        if (!mounted) return;
        setCount(counted);
        setLoadError(null);
      } catch (error) {
        // The last count stays on screen until a refresh works again.
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

  const reload = React.useCallback(() => setReloads((value) => value + 1), []);

  return { count, loadError, reload };
};
