/** What a RUN_ERROR carries that the staff text is chosen from. Anything else on it is the provider's own, and staff never read it. */
export interface RawRunError {
  code?: string | number | null;
  message?: string | null;
}

export interface StaffError {
  code: string;
  message: string;
}

export interface ErrorContext {
  /** The configured chat model, named when Anthropic doesn't know it. */
  model: string;
  /** Why the assistant isn't ready, from `notReadyReason`. */
  notReady?: string;
}

export const CHAT_TOO_LONG_TEXT = 'This chat is long. Start a new chat.';
export const SOMETHING_WRONG_TEXT = 'Something went wrong. Try again.';

const NO_KEY_TEXT = "The assistant isn't set up. It needs an Anthropic API key in AI_API_KEY, with AI_PROVIDER unset or anthropic. Then restart Strapi.";
const KEY_REFUSED_TEXT = 'Anthropic refused the key. Check AI_API_KEY.';
const BUSY_TEXT = 'Anthropic is busy. Try again in a minute.';
const HISTORY_REJECTED_TEXT = "This chat can't continue. Start a new chat.";

/** What Anthropic's 400 says when it refuses a replayed thinking block: it names a `thinking` block, or its `signature`. */
const HISTORY_REJECTED = /`?thinking`? block|`?signature`?/i;

/** The adapter writes `String(err.status)` for a failure with no status, which is the text "undefined". */
const hasCode = (code: RawRunError['code']): code is string | number => code !== null && code !== undefined && !['', 'undefined', 'null'].includes(String(code));

/** The codes the page may be sent: the HTTP statuses the table below names, and the codes this plugin makes (internal is for a turn that could not start). Any other code is sent as `error`. */
const SAFE_CODES = new Set(['400', '401', '403', '404', '429', '529', 'timeout', 'max_tokens', 'chat_too_long', 'not_ready', 'history_rejected', 'internal']);

/** The code the page reads: one of SAFE_CODES, or `error`. The provider's own code can be any text, and it never reaches staff's page. */
export const safeCode = (code: unknown): string => (typeof code === 'string' && SAFE_CODES.has(code) ? code : 'error');

/**
 * The staff text for a RUN_ERROR, chosen by its code, and the code staff's page reads. Nothing the provider wrote is
 * repeated: its message can hold the key, request IDs and the customer's words.
 */
export const staffErrorOf = (raw: RawRunError, context: ErrorContext): StaffError => {
  // An Anthropic error that arrives as a stream `error` event has no HTTP status, so it has no code here and gets the general text.
  // The original does the same, and the behaviour is kept.
  if (!hasCode(raw.code)) return { code: 'error', message: SOMETHING_WRONG_TEXT };
  const code = String(raw.code);
  switch (code) {
    case '401':
    case '403':
      return { code, message: KEY_REFUSED_TEXT };
    case '404':
      return { code, message: `Anthropic doesn't know the model ${context.model}. Check AI_CHAT_MODEL.` };
    case '429':
    case '529':
      return { code, message: BUSY_TEXT };
    case 'timeout':
      return { code, message: 'The assistant took too long and stopped. Try again.' };
    case 'max_tokens':
      return { code, message: 'The answer was cut off because it was too long. Ask for less.' };
    case 'chat_too_long':
      return { code, message: CHAT_TOO_LONG_TEXT };
    case 'not_ready':
      return { code, message: context.notReady ?? NO_KEY_TEXT };
    case '400':
      return HISTORY_REJECTED.test(raw.message ?? '')
        ? { code: 'history_rejected', message: HISTORY_REJECTED_TEXT }
        : { code, message: SOMETHING_WRONG_TEXT };
    case 'internal':
      return { code, message: SOMETHING_WRONG_TEXT };
    default:
      return { code: 'error', message: SOMETHING_WRONG_TEXT };
  }
};

/**
 * Why the chat can't run, in the words staff read, or null when it can: the provider is anthropic and there is a key.
 * The provider is checked first, since another provider's key is not an Anthropic key.
 */
export const notReadyReason = (settings: { aiProvider: string; aiApiKey: string | null }): string | null => {
  if (settings.aiProvider !== 'anthropic') return `The assistant works with Anthropic only. AI_PROVIDER is set to ${settings.aiProvider}.`;
  return settings.aiApiKey ? null : NO_KEY_TEXT;
};

/** `text` with every copy of the key taken out: nothing Strapi logs may carry it. */
export const withoutKey = (text: string, key: string | null): string => (key ? text.split(key).join('[key]') : text);
