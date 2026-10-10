import { config } from './config';
import { COPY } from './copy';
import type { ToolError } from './mcp';
import { SessionError } from './session';
import type { Appointment, Locale } from './types';

/** An error as a screen shows it: a tool's error, or one thrown on the way (errorOf). */
export interface ScreenError extends ToolError {
  /** For a sign-in error: the wait the server named (Retry-After), in seconds. */
  retryAfterSeconds?: number | null;
}

export const statusLabel = (visit: Appointment, locale: Locale) => {
  const t = COPY[locale];
  if (visit.status === 'requested') return t.requested;
  return visit.confirmationSent ? t.confirmationSent : t.confirmed;
};

/**
 * A visit's status as a monochrome tag (components/status-tag.tsx): outlined while it awaits the boutique, filled ink
 * once confirmed, and a small check when the LINE confirmation went out. The same words statusLabel uses.
 */
export const statusTag = (visit: Pick<Appointment, 'status' | 'confirmationSent'>, locale: Locale) => {
  const t = COPY[locale];
  const confirmed = visit.status === 'confirmed';
  return { label: confirmed ? t.confirmed : t.requested, filled: confirmed, lineSent: confirmed && visit.confirmationSent };
};

/** Whether the list holds this reference as a request still waiting for the boutique: only then is "Request sent" true. */
export const requestSentFor = (visits: Appointment[] | undefined, reference: string | null): boolean =>
  reference !== null && (visits ?? []).some((visit) => visit.reference === reference && visit.status === 'requested');

/**
 * A thrown error as the screens show it. A sign-in error keeps its OAuth code and any wait the server named. A failed
 * fetch is a TypeError in every browser ("Failed to fetch", "Load failed"), so it's `network`. Anything else is `error`.
 */
export const errorOf = (error: unknown): ScreenError => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof SessionError) return { code: error.code, message, hint: '', retryAfterSeconds: error.retryAfterSeconds };
  return { code: error instanceof TypeError ? 'network' : 'error', message, hint: '' };
};

/** What the browsers say when a fetch can't reach its server: Chrome, Safari and Firefox. */
const FETCH_FAILED = /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/;

/**
 * A chat's error, as the concierge page shows it (errorOf's, with two more ways to a code). @tanstack/ai-client turns
 * whatever its connection throws into a plain Error with the same message (a RUN_ERROR), so the class that says "network"
 * is gone: the browsers' own words for a failed fetch say it instead. It throws "HTTP error! status: 401 ..." when the
 * route refuses the session, which the screens' copy names `not_signed_in`. A failure the model or the stream reports
 * gets the generic copy: its words are for the technical line.
 */
export const chatErrorOf = (error: unknown): ScreenError => {
  const found = errorOf(error);
  if (found.code !== 'error') return found;
  if (FETCH_FAILED.test(found.message)) return { ...found, code: 'network' };
  return /\bstatus: 401\b/.test(found.message) ? { ...found, code: 'not_signed_in' } : found;
};

/**
 * An error in the customer's words. An unknown code, or a name Object inherits such as `constructor`, gets the generic
 * copy: nothing falls back to the raw message, which is in English and written for developers or agents. When the
 * server named a wait (Retry-After), the copy says how long it is. The booking sheet passes the boutique's name, in the
 * customer's language, so boutique_closed can name it: the tool's own message names it in the catalog's default language.
 */
export const errorText = (error: Pick<ScreenError, 'code' | 'message' | 'retryAfterSeconds'>, locale: Locale, boutique?: string): string => {
  const t = COPY[locale];
  const errors: Readonly<Record<string, string>> = t.errors;
  const text =
    error.code === 'boutique_closed' && boutique
      ? t.closedAtTime(boutique)
      : Object.hasOwn(errors, error.code)
        ? errors[error.code]
        : errors.error;
  return error.retryAfterSeconds ? `${text} ${t.tryAgainIn(error.retryAfterSeconds)}` : text;
};

/** The likely fix for a setup or connection failure, for the mock-mode technical line. */
const MOCK_FIXES: Readonly<Record<string, string>> = {
  network: `Is Strapi running on ${config.strapiUrl}? Open the app at http://localhost:3004, not 127.0.0.1.`,
  // In mock mode, Strapi refuses the LIFF mock's ID tokens when it isn't checking them with the verify mock: it's in
  // LINE mode, or hasn't been restarted since `npm run mode:local`.
  invalid_grant: 'Check npm run mode; after a switch, restart Strapi and the app.',
  invalid_client: "The app's OAuth client isn't active in Strapi. Run `npm run setup` and restart the app.",
};

/**
 * The technical line under an error's copy in mock mode (the stage and development): the raw message, plus the likely
 * fix when there's a known one. Null when there's nothing to say.
 */
export const errorDetail = (error: Pick<ScreenError, 'code' | 'message'>): string | null => {
  const fix = Object.hasOwn(MOCK_FIXES, error.code) ? MOCK_FIXES[error.code] : '';
  return [error.message, fix].filter(Boolean).join(': ') || null;
};

/**
 * Whether an error leads home instead of offering a retry, because trying again can't fix it. That's always so for
 * not_found, and for invalid_input when the input came from the URL (a slug): there's nothing typed to correct.
 */
export const leadsHome = (code: string, fromUrl: boolean): boolean => code === 'not_found' || (fromUrl && code === 'invalid_input');
