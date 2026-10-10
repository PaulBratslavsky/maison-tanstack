import type { Core } from '@strapi/strapi';

import { aiEnabled } from '../ai/provider';
import { getConfig } from '../config';
import { UID } from '../constants';

type Doc = Record<string, any>;

/*
 * A stub of the labelling service. It keeps the entry point the cron job calls, `sweep()`, and its answer.
 * - With AI off it marks every pending inquiry skipped, as the original does. Inquiries still reach staff, and staff label them by hand.
 * - With a key or an Ollama host set it does nothing yet, and says so once. Phase 5 replaces it with TanStack AI.
 */

export interface SweepResult {
  labelled: number;
  failed: number;
  skipped: number;
  /** Set when another sweep was running: this one did nothing. */
  busy?: true;
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  /** Overlap guard: a second sweep that starts while one is running does nothing. */
  let sweeping = false;
  /** The line about phase 5 is logged once, not every minute. */
  let saidModelIsLater = false;

  /** Writes `data` to the inquiry. Strapi's types know only `id` and `documentId` for this content type, and `update` checks its data against them. */
  const updateInquiry = (documentId: string, data: Doc) => strapi.documents(UID.inquiry).update({ documentId, data });

  /** Marks the waiting inquiries skipped: `skipped` says AI was off when the sweep saw the row. */
  const skipPending = async (): Promise<SweepResult> => {
    const pending = (await strapi.documents(UID.inquiry).findMany({ filters: { analysisStatus: { $eq: 'pending' } }, fields: ['documentId'] })) as Doc[];
    for (const { documentId } of pending) await updateInquiry(documentId, { analysisStatus: 'skipped' });
    return { labelled: 0, failed: 0, skipped: pending.length };
  };

  return {
    /**
     * Meant to run every minute. It answers how many inquiries it labelled, failed on and skipped. A sweep that starts
     * while another is running does nothing and says `busy`. It throws only when Strapi itself fails: the cron job logs that.
     */
    async sweep(): Promise<SweepResult> {
      if (sweeping) return { labelled: 0, failed: 0, skipped: 0, busy: true };
      sweeping = true;
      try {
        if (!aiEnabled(getConfig(strapi))) {
          const result = await skipPending();
          if (result.skipped > 0) strapi.log.info(`[maison] Labelling sweep: ${result.labelled} labelled, ${result.failed} failed, ${result.skipped} skipped.`);
          return result;
        }
        if (!saidModelIsLater) {
          saidModelIsLater = true;
          strapi.log.info('[maison] AI is set, but labelling by a model arrives in phase 5. Until then, new inquiries stay pending.');
        }
        return { labelled: 0, failed: 0, skipped: 0 };
      } finally {
        sweeping = false;
      }
    },
  };
};
