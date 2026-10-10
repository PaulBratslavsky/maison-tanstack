import type { Core } from '@strapi/strapi';

import { adapterFor, aiEnabled, modelOptionsOf, modelVersionOf, type AiSettings } from '../ai/provider';
import { loadSdk, type FetchWrap } from '../ai/sdk';
import { getConfig } from '../config';
import { LABEL_BATCH, MAX_LABEL_ATTEMPTS, UID } from '../constants';
import {
  PROMPT_VERSION,
  labelSystemPrompt,
  labelUserMessage,
  labelsSchema,
  type LabelInput,
  type Labels,
} from '../domain/inquiry-criteria';
import { queueFor } from '../domain/inquiry-queue';

type Doc = Record<string, any>;

/** What `label` reads of an inquiry: the words and the turn's two facts, never the customer. A missing or null reply is no reply. */
export type LabelRequest = Omit<LabelInput, 'reply'> & { reply?: string | null };

export interface SweepResult {
  labelled: number;
  failed: number;
  skipped: number;
  /** Set when another sweep was running: this one did nothing. */
  busy?: true;
}

/**
 * The rows worth a model call: waiting (pending), passed over while AI was off (skipped, so labelling catches up once a
 * key is set), or failed fewer than MAX_LABEL_ATTEMPTS times. A failed row that used its attempts is parked until staff
 * press Label again: otherwise a row that always fails would take a place in every batch and starve the rows behind it.
 * A row a person labelled is never picked: their label wins.
 */
const TO_LABEL: Doc = {
  humanCorrected: { $ne: true },
  $or: [
    { analysisStatus: { $in: ['pending', 'skipped'] } },
    { analysisStatus: { $eq: 'failed' }, analysisAttempts: { $lt: MAX_LABEL_ATTEMPTS } },
  ],
};

/** The statuses a row has while the sweep may still write its labels. */
const LABELLABLE = ['pending', 'skipped', 'failed'];

/** How long one model call may take, as in Pulse. */
const LABEL_TIMEOUT_MS = 30_000;

/** `text` with every copy of the key taken out: nothing Strapi logs may carry it. */
const withoutKey = (text: string, key: string | null): string => (key ? text.split(key).join('[key]') : text);

/** What went wrong, from whatever was thrown, without the key. */
const reasonOf = (error: unknown, key: string | null): string => withoutKey(String((error as Error | undefined)?.message ?? error), key);

/**
 * What a model call's fetch showed, written by `watchFetch` as the adapters' requests go out. The adapters keep no HTTP
 * status on the error `chat()` throws. Both catch what the SDK threw and throw `Error("Structured output generation
 * failed: <message>")` (`@tanstack/ai-anthropic` and `@tanstack/ai-ollama`, `adapters/text.js`, `structuredOutput`).
 * `chat()` then rethrows that with its message, and Anthropic models that take the schema in the chat request itself end
 * in a `RUN_ERROR` that holds a message and a code, and no more. So the status is read where it is seen, in the fetch.
 * - `status`: the status of the last response. The Anthropic SDK retries a 408, 409, 429, a 5xx and a lost connection twice,
 *   so the last response is the one the call failed on.
 * - `noAnswer`: the last fetch threw, which is a connection that never came up (`fetch failed`) or one that was aborted.
 */
interface Seen {
  status?: number;
  noAnswer?: boolean;
}

/** Records, in `seen`, how each request of the call ends. It changes nothing about the request or the answer. */
const watchFetch =
  (seen: Seen): FetchWrap =>
  (next) =>
  async (input, init) => {
    try {
      const response = await next(input, init);
      seen.status = response.status;
      seen.noAnswer = false;
      return response;
    } catch (error) {
      seen.status = undefined;
      seen.noAnswer = true;
      throw error;
    }
  };

/**
 * Why a sweep stops on a failed call, when the failure says nothing against the inquiry: every row would meet it until it
 * is fixed, so the row is left as it was and the next sweep tries again.
 * - `refused`: the provider answered, and refused the key or the setup: 401 or 403 (a wrong key), or 404 (a model it doesn't
 *   know, which is what a wrong AI_MODEL gives, or a wrong address).
 * - `no-answer`: the provider didn't answer. A connection that never came up, a 408, 409, 429 or a 5xx (the Anthropic SDK has
 *   already tried those three times), the 30-second timeout, and an abort, which are errors named `TimeoutError` and
 *   `AbortError`.
 * Anything else counts against the inquiry, and this answers null: a wrong answer (labels that fail the schema, or text that
 * is not JSON), a status that comes with that inquiry's own text (a 400, a 413, a 422), an error nobody has a class for,
 * Strapi failing to save. The inquiry fails, and the sweep goes on with the next one.
 */
type Stop = 'refused' | 'no-answer';

const stopFor = (error: unknown, seen: Seen): Stop | null => {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'no-answer';
  if (seen.noAnswer) return 'no-answer';
  const { status } = seen;
  if (status === 401 || status === 403 || status === 404) return 'refused';
  if (status !== undefined && (status === 408 || status === 409 || status === 429 || status >= 500)) return 'no-answer';
  return null;
};

/** What the warning says when a sweep stops. */
const STOPPED: Record<Stop, string> = {
  refused: 'The AI provider refused the key or the setup',
  'no-answer': 'The AI provider gave no answer',
};

/** What the adapter factory is given: the AI settings, and none of the plugin's other config. */
const aiSettingsOf = (strapi: Core.Strapi): AiSettings => {
  const { aiProvider, aiModel, aiApiKey, aiBaseUrl } = getConfig(strapi);
  return { aiProvider, aiModel, aiApiKey, aiBaseUrl };
};

export default ({ strapi }: { strapi: Core.Strapi }) => {
  /**
   * Overlap guard: ten sequential model calls can outlast the minute between cron ticks, and a second sweep would label
   * the same rows again and double the model spend.
   */
  let sweeping = false;

  /**
   * The labels for one exchange, with the settings the caller read. Throws on any failure. `seen` is filled in as the
   * call's requests go out, for `stopFor`.
   *
   * `chat()` with an `outputSchema` makes one model call, with no tools, and checks the answer against the schema as a Standard
   * Schema, which Zod 4 is: a wrong shape throws, and the trimmed and checked labels come back.
   */
  const labelWith = async (settings: AiSettings, input: LabelRequest, seen: Seen = {}): Promise<Labels> => {
    const { chat } = await loadSdk();
    const adapter = await adapterFor(settings);
    // A labelling that takes longer than this is a hung connection, not a slow model: the sweep leaves the row as it was, stops, and tries again on the next one.
    const timeout = AbortSignal.timeout(LABEL_TIMEOUT_MS);
    const abortController = new AbortController();
    // The Anthropic SDK stops a request when this aborts. The Ollama adapter does not read it, so the call is also raced
    // against the timeout: a hung Ollama call must not hold the sweep.
    let onTimeout!: () => void;
    const timedOut = new Promise<never>((_resolve, reject) => {
      onTimeout = () => {
        abortController.abort(timeout.reason);
        reject(timeout.reason);
      };
      if (timeout.aborted) onTimeout();
      else timeout.addEventListener('abort', onTimeout, { once: true });
    });
    const modelOptions = modelOptionsOf(settings);
    // The timeout promise may reject with no one racing it: when chat() throws before it returns, or when the call wins.
    timedOut.catch(() => undefined);
    try {
      // `debug: false` keeps the SDK's own logger quiet: it prints error objects, and nothing may carry the key to a log.
      // The call is inside the `try`, so a chat() that throws at once still removes the listener.
      const call = chat({
        adapter,
        systemPrompts: [labelSystemPrompt()],
        messages: [{ role: 'user', content: labelUserMessage({ ...input, reply: input.reply ?? '' }) }],
        outputSchema: labelsSchema,
        abortController,
        wrapFetch: watchFetch(seen),
        debug: false,
        ...(modelOptions ? { modelOptions } : {}),
      });
      // If the timeout wins the race, a late failure of the call has no one left to hear it.
      call.catch(() => undefined);
      return (await Promise.race([call, timedOut])) as Labels;
    } finally {
      timeout.removeEventListener('abort', onTimeout);
    }
  };

  const findRow = async (documentId: string): Promise<Doc | null> => (await strapi.documents(UID.inquiry).findOne({ documentId })) as Doc | null;

  /** Writes `data` to the inquiry. Strapi's types know only `id` and `documentId` for this content type, and `update` checks its data against them. */
  const updateInquiry = (documentId: string, data: Doc) => strapi.documents(UID.inquiry).update({ documentId, data });

  /**
   * The row as it is now, if the sweep may still write to it. A person can change a label while the model is answering
   * (Change label sets `humanCorrected`), and theirs must win: so the row is read again right before anything is
   * written, and null means it is no longer the sweep's: a person labelled it, it has its labels already, or it is gone.
   */
  const stillWaiting = async (documentId: string): Promise<Doc | null> => {
    const row = await findRow(documentId);
    return row && !row.humanCorrected && LABELLABLE.includes(row.analysisStatus) ? row : null;
  };

  /**
   * Labels one row: its outcome, or null when the row was left as it is because it is no longer the sweep's. A failure that
   * says nothing against the row (the provider refusing the key or the setup, or giving no answer) leaves it as it was,
   * with no write and no attempt, logs one warning that says which kind it was, and answers `stopped`, for the batch to
   * end. Any other failure counts an attempt: the row fails, and is parked after MAX_LABEL_ATTEMPTS.
   */
  const labelRow = async (row: Doc, settings: AiSettings): Promise<'labelled' | 'failed' | 'stopped' | null> => {
    const seen: Seen = {};
    try {
      const labels = await labelWith(
        settings,
        {
          message: row.message,
          reply: row.reply,
          knowledgeFound: Boolean(row.knowledgeFound),
          handedOff: Boolean(row.handedOff),
        },
        seen
      );
      const current = await stillWaiting(row.documentId);
      if (!current) return null;
      // The queue is the code's rule over the labels and the hand-off, never the model's own say.
      await updateInquiry(row.documentId, {
        ...labels,
        analysisStatus: 'analyzed',
        modelVersion: modelVersionOf(settings),
        promptVersion: PROMPT_VERSION,
        queue: queueFor({ handedOff: Boolean(current.handedOff), kind: labels.kind, answered: labels.answered }),
      });
      return 'labelled';
    } catch (error) {
      const stop = stopFor(error, seen);
      if (stop) {
        strapi.log.warn(`[maison] Labelling stopped until the next sweep. ${STOPPED[stop]}: ${reasonOf(error, settings.aiApiKey)}`);
        return 'stopped';
      }
      const current = await stillWaiting(row.documentId);
      if (!current) return null;
      const attempts = (current.analysisAttempts ?? 0) + 1;
      strapi.log.warn(
        `[maison] Labelling inquiry ${row.documentId} failed (attempt ${attempts} of ${MAX_LABEL_ATTEMPTS}): ${reasonOf(error, settings.aiApiKey)}`
      );
      await updateInquiry(row.documentId, { analysisStatus: 'failed', analysisAttempts: attempts });
      return 'failed';
    }
  };

  /**
   * With AI off, the sweep only marks the new rows skipped: inquiries still reach staff, a hand-off is in Needs an
   * answer from the start, and Change label labels by hand. `skipped` says AI was off when the sweep saw the row.
   */
  const skipPending = async (): Promise<SweepResult> => {
    const pending = (await strapi.documents(UID.inquiry).findMany({ filters: { analysisStatus: { $eq: 'pending' } }, fields: ['documentId'] })) as Doc[];
    for (const { documentId } of pending) await updateInquiry(documentId, { analysisStatus: 'skipped' });
    return { labelled: 0, failed: 0, skipped: pending.length };
  };

  const labelBatch = async (settings: AiSettings): Promise<SweepResult> => {
    const rows = (await strapi.documents(UID.inquiry).findMany({ filters: TO_LABEL, sort: 'createdAt:asc', limit: LABEL_BATCH })) as Doc[];
    let labelled = 0;
    let failed = 0;
    // One at a time, each in its own try: a row the model fails on never stops the rows after it. Only a failure that says
    // nothing against the inquiry (a refused key or setup, no answer) ends the batch: every row would meet it, and the next
    // sweep tries again.
    for (const row of rows) {
      const outcome = await labelRow(row, settings);
      if (outcome === 'stopped') break;
      if (outcome === 'labelled') labelled += 1;
      if (outcome === 'failed') failed += 1;
    }
    return { labelled, failed, skipped: 0 };
  };

  return {
    /** The labels for one exchange, from the configured model. Throws on any failure: a wrong answer, a timeout, a refused key. */
    label: (input: LabelRequest): Promise<Labels> => labelWith(aiSettingsOf(strapi), input),

    /**
     * Labels the oldest waiting inquiries, as Pulse's analysis sweep does its mentions. Meant to run every minute, and it
     * answers how many it labelled, failed on and skipped. A sweep that starts while another is running does nothing and
     * says `busy`. It throws only when Strapi itself fails: the cron job logs that.
     */
    async sweep(): Promise<SweepResult> {
      if (sweeping) return { labelled: 0, failed: 0, skipped: 0, busy: true };
      sweeping = true;
      try {
        const settings = aiSettingsOf(strapi);
        const result = aiEnabled(settings) ? await labelBatch(settings) : await skipPending();
        if (result.labelled + result.failed + result.skipped > 0) {
          strapi.log.info(`[maison] Labelling sweep: ${result.labelled} labelled, ${result.failed} failed, ${result.skipped} skipped.`);
        }
        return result;
      } finally {
        sweeping = false;
      }
    },
  };
};
