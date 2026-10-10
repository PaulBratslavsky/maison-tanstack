import * as React from 'react';

import { useFetchClient, useNotification } from '@strapi/strapi/admin';

import type { ActionAnswer } from './inquiries';
import { replyNotice } from './questions';
import { singleFlight } from './singleFlight';
import { useMounted } from './useMounted';

/** What can be sent for an inquiry, as the last word of its route. */
export type Action = 'reply' | 'close' | 'label' | 'label-again';
/** What is on its way to the server: one action, for one inquiry. */
export type Acting = { documentId: string; action: Action };

/**
 * Reply on LINE, Close, Change label and Label again, for one inquiry (with a body, for the three that take one), and
 * what is on its way: `acting`, which the buttons show.
 *
 * Only one of them is in flight at a time. The server has no guard against a second click, so a reply sent twice would
 * reach the customer twice. `run` is one `singleFlight`, which closes the gap before the next render, and `acting`
 * keeps the buttons disabled until the answer has come back and `afterAction` has reloaded the rows.
 *
 * The notice is the server's own message: a warning when it says the customer has the reply but something after it went
 * wrong, a success otherwise, and when the server refused, why, in its words. `onSuccess` runs as soon as it went, so a
 * dialog closes at once; a refused one stays open, with what was written. The notice shows even if the tab was left in
 * the meantime, since it says what happened. Nothing else is done then: no state is set on a component that is gone.
 */
export const useInquiryActions = (afterAction: () => Promise<void>) => {
  const { post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const mounted = useMounted();
  const [acting, setActing] = React.useState<Acting | null>(null);
  /** What `run` uses, as of the latest render: it is made once, so it can't close over one render's values. */
  const latest = React.useRef({ post, toggleNotification, afterAction });
  latest.current = { post, toggleNotification, afterAction };

  // State, not useMemo: React may drop a memoised value, and a new `run` would forget that a request is in flight.
  const [run] = React.useState(() =>
    singleFlight(async (documentId: string, action: Action, body?: unknown, onSuccess?: () => void): Promise<void> => {
      setActing({ documentId, action });
      try {
        try {
          const { data } = await latest.current.post<ActionAnswer>(`/maison/inquiries/${documentId}/${action}`, body);
          latest.current.toggleNotification(replyNotice(data));
          if (mounted.current) onSuccess?.();
        } catch (error) {
          latest.current.toggleNotification({ type: 'danger', message: (error as Error).message });
        }
        if (mounted.current) await latest.current.afterAction(); // it reports its own errors
      } finally {
        if (mounted.current) setActing(null);
      }
    })
  );

  return { acting, run };
};
