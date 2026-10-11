/**
 * What the assistant's drawer decides, apart from React: its quick questions, the state it shows, the notices under the messages, when
 * Send works, the line for each tool call, what stays in the chat after Stop or a failed turn, what happens to the text
 * box, and where the admin's token is. The components read these, and the unit tests hold them.
 */

/** The assistant's two routes, served under /maison. */
export const ASSISTANT_PATHS = { status: '/maison/assistant/status', chat: '/maison/assistant/chat' } as const;

/**
 * The five quick questions: buttons above the text box for the whole chat, in this order. Pressing one sends it as it is written, as a starter, which
 * leaves what staff have typed in the box. They replace the three starters of the first design, which showed in the empty chat only (Paul, 7 October:
 * so a demo can use them at any point). Each is a question the assistant's tools can answer.
 */
export const STARTERS: readonly string[] = [
  'Which visits are waiting for staff?',
  'Any complaints this week?',
  'Which customer questions still need an answer?',
  'How many inquiries are open in each queue?',
  'What are customers asking about today?',
];

/** A tool as the status lists it: its name, and what staff call it. */
export interface ToolInfo {
  name: string;
  label: string;
}

/**
 * What GET /maison/assistant/status answers: ready, with the model and the tools this admin's chat gets, or not ready with
 * the reason. Never the key.
 */
export type AssistantStatus = { ready: true; model: string; tools: ToolInfo[] } | { ready: false; reason: string };

const isToolInfo = (value: unknown): value is ToolInfo => {
  if (typeof value !== 'object' || value === null) return false;
  const { name, label } = value as Record<string, unknown>;
  return typeof name === 'string' && typeof label === 'string';
};

export const isStatus = (value: unknown): value is AssistantStatus => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { ready, model, reason, tools } = value as Record<string, unknown>;
  if (ready === true) return typeof model === 'string' && Array.isArray(tools) && tools.every(isToolInfo);
  return ready === false && typeof reason === 'string';
};

/** What the drawer shows: the check is running, the check failed, the assistant is not set up (a notice and no text box), or the chat. */
export type AskTabState =
  | { kind: 'loading' }
  | { kind: 'failed'; text: string }
  | { kind: 'not-ready'; text: string }
  | { kind: 'chat'; model: string; tools: ToolInfo[] };

/** What staff read when the check fails. It holds none of the error: the fetch client's own text goes to the console. */
export const STATUS_CHECK_FAILED = "Couldn't check the assistant.";

/** A status the drawer already has is kept when a later check fails: the chat stays as it was. */
export const askTabState = (status: AssistantStatus | null, statusFailed: boolean): AskTabState => {
  if (status) return status.ready ? { kind: 'chat', model: status.model, tools: status.tools } : { kind: 'not-ready', text: status.reason };
  if (statusFailed) return { kind: 'failed', text: STATUS_CHECK_FAILED };
  return { kind: 'loading' };
};

/** The two CUSTOM events the server's stream wrapper sends (`CUSTOM_EVENTS` in server/src/services/assistant.ts). */
export const CUSTOM_EVENT = { maxTurns: 'max_turns', declined: 'declined' } as const;

// The admin bundle can't import server code when it runs, so the number of steps is written out here. A unit test holds
// it to ASSISTANT_LIMITS.modelTurns on the server.
const CUSTOM_NOTES: Record<string, string> = {
  [CUSTOM_EVENT.maxTurns]: 'The assistant stopped after 6 steps. Ask a narrower question.',
  [CUSTOM_EVENT.declined]: 'The model declined to answer this. Rephrase the question.',
};

/** The note under the messages for a custom event, or null for any other. */
export const customEventNote = (name: string): string | null => (Object.prototype.hasOwnProperty.call(CUSTOM_NOTES, name) ? CUSTOM_NOTES[name] : null);

/** What the drawer says about a failed turn, whether it offers New chat as the way on, and the code of the RUN_ERROR it came from, if it came from one. */
export interface ErrorNotice {
  text: string;
  newChat: boolean;
  code?: string;
}

// These two texts are the server's own (CHAT_TOO_LONG_TEXT and SOMETHING_WRONG_TEXT in server/src/assistant/errors.ts).
// A unit test holds them to it.
const SOMETHING_WRONG = 'Something went wrong. Try again.';
const CHAT_TOO_LONG = 'This chat is long. Start a new chat.';

/** A 401 on the chat request means the admin's session ended while the page was open. Strapi's own sign-in shows only for requests made through its fetch client, and the chat is a plain fetch, so the page says what to do. */
const SESSION_ENDED = 'Your Strapi session has ended. Reload the page to sign in again.';
const CONNECTION_LOST = 'The connection to Strapi was lost. Try again.';

/** What a browser says when a request never reached the server: Chrome ("Failed to fetch"), Firefox ("NetworkError…") and Safari ("Load failed"). */
const NETWORK = /failed to fetch|load failed|network ?error|networkerror/i;

/** The message ai-client 0.39.2 gives every StreamReadError, which wraps a rejected fetch and a body that failed while it was read. */
const STREAM_READ_FAILED = 'Stream response body read failed';

/** The message of an error's cause: an Error's own, or the cause itself when it is text. */
const causeMessage = (cause: unknown): string => {
  if (typeof cause === 'string') return cause;
  const message = (typeof cause === 'object' && cause !== null ? (cause as { message?: unknown }).message : undefined) as unknown;
  return typeof message === 'string' ? message : '';
};

/**
 * The notice for an error `useChat` reports.
 * - An error from a RUN_ERROR has a string `code`, and its message is already the staff text the server wrote. A chat that is
 *   too long, or that Anthropic refused to continue, offers New chat.
 * - ai-client throws `HTTP error! status: <n>` for a failed request and never reads its body, so the status decides. The
 *   server sends a real HTTP error only for a bad body (400), a role that lost the permission (403), and a body over
 *   Strapi's limit (413). A 401 is a session that ended while the page was open.
 * - A request that never arrived, or a stream that broke, is a lost connection. ai-client wraps the browser's error in a
 *   StreamReadError, whose own message never says what happened (the browser's text is in its `cause`), and the RUN_ERROR it
 *   makes from it has the same message and no cause. So the name, that message, or a browser's message in the cause decide, and
 *   so does a browser's message in the error itself. A TypeError thrown by the page's own code is not a lost connection.
 */
export const errorNotice = (error: unknown): ErrorNotice => {
  const { code, message, name, cause } = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; message?: unknown; name?: unknown; cause?: unknown };
  const text = typeof message === 'string' ? message : '';

  if (typeof code === 'string' && code !== '') {
    return { text: text || SOMETHING_WRONG, newChat: code === 'chat_too_long' || code === 'history_rejected', code };
  }

  const status = /HTTP error! status: (\d{3})/.exec(text)?.[1];
  if (status === '401') return { text: SESSION_ENDED, newChat: false };
  if (status === '403') return { text: "Your role can't use the assistant any more. Reload the page.", newChat: false };
  if (status === '413') return { text: CHAT_TOO_LONG, newChat: true };
  if (status) return { text: SOMETHING_WRONG, newChat: false };

  if (name === 'StreamReadError' || text === STREAM_READ_FAILED || NETWORK.test(text) || NETWORK.test(causeMessage(cause))) {
    return { text: CONNECTION_LOST, newChat: false };
  }
  return { text: SOMETHING_WRONG, newChat: false };
};

/**
 * The notice after a check of the assistant's status. A "not set up" notice from a send is stale once the assistant is ready, so
 * it goes. Every other notice stays: the check says nothing about it.
 */
export const noticeAfterStatus = (notice: ErrorNotice | null, status: AssistantStatus): ErrorNotice | null =>
  notice?.code === 'not_ready' && status.ready ? null : notice;

/** Send works for a message with something in it, when the assistant is ready and not answering: a second message waits. */
export const canSend = ({ text, busy, ready }: { text: string; busy: boolean; ready: boolean }): boolean => ready && !busy && text.trim().length > 0;

/**
 * Whether a key press in the text box sends the message: Enter, without Shift (which adds a line break), and not while an
 * input method composes. Staff typing Japanese press Enter to confirm a conversion, and Safari reports that Enter after the
 * composition has ended, with keyCode 229 and `isComposing` false.
 */
export const shouldSendOnKey = (event: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }): boolean =>
  event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;

/** A part of a UIMessage, as TanStack AI keeps it: `type` says which, and the rest depends on it. */
export interface PartLike {
  type: string;
  [field: string]: any;
}

/** The line a tool call gets in the chat: its text, and how to draw it (the error tone is red). */
export interface ToolLineModel {
  text: string;
  tone: 'running' | 'ok' | 'error';
}

/** The tool-result part of a call, by the call's id. */
export const toolResultOf = (parts: readonly PartLike[], callId: string): PartLike | undefined =>
  parts.find((part) => part.type === 'tool-result' && part.toolCallId === callId);

/** What each read tool is called in its line, and which answer field holds its rows (none for the two with no count). */
const TOOL_LINES: Record<string, { what: string; rows?: string }> = {
  list_requests: { what: 'requests', rows: 'requests' },
  list_questions: { what: 'questions', rows: 'questions' },
  list_inquiries: { what: 'inquiries', rows: 'inquiries' },
  inquiry_counts: { what: 'inquiry counts' },
  search_knowledge: { what: 'knowledge', rows: 'entries' },
  search_products: { what: 'products', rows: 'products' },
  view_product: { what: 'product' },
};

const RUNNING = new Set(['awaiting-input', 'input-streaming', 'input-complete']);

/** What a call that TanStack AI refused says: the model sent input the tool's schema doesn't take, or arguments that are not JSON. */
export const UNREADABLE_REQUEST = 'Maison could not read that request.';

/**
 * The message of a failed call. Only Maison's own error object, `{ error: { message } }`, is shown as it is. When TanStack AI
 * refuses a call itself it answers `{ error: "<its text>" }`, and that text names the tool and holds the model's own input, so
 * it is never shown: a fixed sentence says the request could not be read. The result part's own `error` is TanStack AI's text
 * too (its "Tool execution failed", or the same string), so it is not shown either.
 */
const failureMessage = (output: any): string => {
  if (typeof output?.error?.message === 'string' && output.error.message) return output.error.message;
  if (typeof output?.error === 'string' && output.error) return UNREADABLE_REQUEST;
  return 'The tool failed.';
};

/** How a call stands: still running, failed (with the message to show), or done (with how many rows it gave, for the tools that give rows). */
type Outcome = { tone: 'running' } | { tone: 'error'; message: string } | { tone: 'ok'; count: number | null };

/** Whether the part is a call to one of the seven read tools. The draft tools have a card instead, and any other name has nothing. */
const isReadToolCall = (call: PartLike): boolean => call.type === 'tool-call' && Object.prototype.hasOwnProperty.call(TOOL_LINES, call.name);

const outcomeOf = (call: PartLike, result: PartLike | undefined): Outcome => {
  const { rows } = TOOL_LINES[call.name];
  const output = call.output;

  const failed = call.state === 'error' || result?.state === 'error' || (typeof output === 'object' && output !== null && 'error' in output && Boolean(output.error));
  if (failed) return { tone: 'error', message: failureMessage(output) };

  if (RUNNING.has(call.state) || (call.state !== 'complete' && !result)) return { tone: 'running' };

  const list = rows ? output?.[rows] : undefined;
  return { tone: 'ok', count: Array.isArray(list) ? list.length : null };
};

/** "12 results", "1 result", "0 results". */
const countText = (count: number): string => `${count} ${count === 1 ? 'result' : 'results'}`;

/**
 * The line for a tool call: `Maison · inquiries ✓ 12 results`, `Maison · requests …` while it runs, or in red
 * `Maison · requests ✕ No request APT-4812.` when it failed. Only the seven read tools have one: the drafts have a card
 * instead, and any other name has none.
 */
export const toolLineOf = (call: PartLike, result: PartLike | undefined): ToolLineModel | null => {
  if (!isReadToolCall(call)) return null;
  const { what } = TOOL_LINES[call.name];
  const outcome = outcomeOf(call, result);
  if (outcome.tone === 'error') return { text: `Maison · ${what} ✕ ${outcome.message}`, tone: 'error' };
  if (outcome.tone === 'running') return { text: `Maison · ${what} …`, tone: 'running' };
  return { text: outcome.count === null ? `Maison · ${what} ✓` : `Maison · ${what} ✓ ${countText(outcome.count)}`, tone: 'ok' };
};

/** The four tags the server wraps customer text in (`FENCED_TAGS` in server/src/domain/fence.ts, which a unit test holds this list to). */
export const CUSTOMER_TAGS = ['customer_message', 'customer_question', 'customer_note', 'concierge_reply'] as const;

const CUSTOMER_TAG = new RegExp(`</?(?:${CUSTOMER_TAGS.join('|')})>`, 'g');

/**
 * `value` with the customer-text tags taken out of every string in it, and the text inside them kept: what staff read in an opened
 * tool box. The tags are for the model, which reads customer text as data. The server writes a `<` before a tag name in customer text
 * as `&lt;`, so every tag left in a result is one of its own. Anything that is not a string, an array or a plain object is as it was,
 * and so is the masked customer (`line:U4af…88`). It makes a new value and never changes the one it was given.
 */
export const withoutCustomerTags = (value: unknown): unknown => {
  if (typeof value === 'string') return value.replace(CUSTOMER_TAG, '');
  if (Array.isArray(value)) return value.map(withoutCustomerTags);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, withoutCustomerTags(inner)]));
  return value;
};

/** What the opened box of a running call says. Three plain dots, as strapi-plugin-tanstack-ai's box does. */
export const WAITING_FOR_RESULT = 'Waiting for result...';

/** A tool call as its box in the chat shows it. */
export interface ToolBoxModel {
  /** The tool's name, which the header shows after "Tool: ". */
  name: string;
  state: 'running' | 'done' | 'failed';
  /** What the header says at the right: "3 results", "1 result" or "done" for a call that is over, "failed" for one that failed, and null while it runs, when a spinner shows. */
  status: string | null;
  /** What the opened box shows: the wait, the failure's message, or the result as indented JSON with the customer-text tags taken out. */
  body: string;
}

/** The result of a call: its output, else what its tool-result part carries (TanStack AI sends it as a JSON string). */
const outputOf = (call: PartLike, result: PartLike | undefined): unknown => {
  if (call.output !== undefined) return call.output;
  const content: unknown = result?.content;
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
};

/**
 * The box for a tool call, in the order the parts arrived. A running call waits. A failed call shows Maison's own message, or a fixed
 * sentence for a call TanStack AI refused, never TanStack AI's text (see failureMessage). A finished call shows its count in the
 * header (the same count as its line) and its result as JSON. Null for a part that has no box: the same parts that have no line.
 */
export const toolBoxOf = (call: PartLike, result: PartLike | undefined): ToolBoxModel | null => {
  if (!isReadToolCall(call)) return null;
  const outcome = outcomeOf(call, result);
  if (outcome.tone === 'running') return { name: call.name, state: 'running', status: null, body: WAITING_FOR_RESULT };
  if (outcome.tone === 'error') return { name: call.name, state: 'failed', status: 'failed', body: outcome.message };
  return {
    name: call.name,
    state: 'done',
    status: outcome.count === null ? 'done' : countText(outcome.count),
    body: JSON.stringify(withoutCustomerTags(outputOf(call, result)), null, 2) ?? '',
  };
};

/** What staff read under each tool's label in the list of tools: one plain line. A unit test holds this to the tools the server labels. */
export const TOOL_NOTES: Record<string, string> = {
  list_requests: 'Looks up visit requests: the ones waiting for staff, one visit day, or one request by its reference.',
  list_questions: 'Looks up the questions the concierge handed to staff, open or answered, or one by its reference.',
  list_inquiries: 'Looks up what customers wrote to the concierge, with its labels, or one inquiry by its ID.',
  inquiry_counts: 'Counts the open inquiries in each queue.',
  search_knowledge: 'Searches the product knowledge Maison wrote for customers.',
  search_products: 'Finds products, with prices and stock.',
  view_product: "Shows one product's details.",
};

/** The line for a tool in the list of tools, or null for a tool with none. */
export const toolNoteOf = (name: string): string | null => (Object.prototype.hasOwnProperty.call(TOOL_NOTES, name) ? TOOL_NOTES[name] : null);

/**
 * The address a link in an answer may have: only an `http:` or `https:` address is a link. Anything else, such as `javascript:`,
 * `data:`, `mailto:`, an address with no scheme, or one that does not parse, is not, and the answer shows its text as plain text.
 * It answers the address as the browser reads it, so what is checked is what a link would open.
 */
export const safeLink = (href: string | null | undefined): string | null => {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

/** A message as TanStack AI keeps it, as far as the helpers below read it. A UIMessage is one. */
export interface MessageLike {
  role: string;
  parts: readonly unknown[];
}

const partsOfMessage = (message: MessageLike): readonly PartLike[] => message.parts as readonly PartLike[];

/**
 * The parts of a message the chat draws: text with something in it, and a tool call that has a line. Thinking, a tool's result
 * (its call's line already reports it), and any other part are not drawn. The messages and the working line both read this,
 * so what counts as an answer is decided in one place.
 */
export const drawableParts = (parts: readonly PartLike[]): PartLike[] =>
  parts.filter((part) => {
    if (part.type === 'text') return typeof part.content === 'string' && part.content.trim() !== '';
    return part.type === 'tool-call' && toolLineOf(part, toolResultOf(parts, part.id)) !== null;
  });

/**
 * Whether the chat says the assistant is working: it is answering, and its message has nothing drawn yet, because it holds no
 * part at all, or only thinking, or because the last message is still the staff member's. Once text or a tool line is on the
 * screen, that is the sign of work.
 */
export const showsWorking = (busy: boolean, messages: readonly MessageLike[]): boolean => {
  if (!busy) return false;
  const last = messages.at(-1);
  return !(last?.role === 'assistant' && drawableParts(partsOfMessage(last)).length > 0);
};

/**
 * Whether the last message shows "Working on it…" under its tool boxes: the assistant is answering, its message already has text,
 * and one of its tools is still running. With no text yet, the box's own spinner shows the wait, and between the end of a tool and
 * the next words nothing shows.
 */
export const showsToolWait = (busy: boolean, messages: readonly MessageLike[]): boolean => {
  if (!busy) return false;
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return false;
  const parts = partsOfMessage(last);
  const hasText = parts.some((part) => part.type === 'text' && typeof part.content === 'string' && part.content.trim() !== '');
  return hasText && parts.some((part) => toolBoxOf(part, toolResultOf(parts, part.id))?.state === 'running');
};

/**
 * The messages without any tool call that was cut off, which Stop, a failed turn or a stream that ended early leaves behind.
 * TanStack AI finishes a call only when its stream ends normally, so a call that was being written when the stream stopped stays
 * `awaiting-input`, `input-streaming` or `input-complete`, with no `output` and no tool-result part. The chat would draw it as
 * "…" for ever, and the next send would replay it to Anthropic as a call with no answer.
 * - A call is open when it has no `output` and no tool-result part of the same message. A finished call stays.
 * - A tool-result part whose call is not in its message goes too: it is what a result that arrives after the call was removed
 *   leaves behind, and a result with no call is refused by Anthropic as well.
 * - An assistant message left with no parts is removed.
 * Gives back the same array when nothing needs to go, so a caller can tell, and sets nothing for no reason.
 */
export const withoutOpenToolCalls = <M extends MessageLike>(messages: M[]): M[] => {
  let changed = false;
  const kept: M[] = [];
  for (const message of messages) {
    const parts = partsOfMessage(message);
    const calls = new Set(parts.filter((part) => part.type === 'tool-call').map((part) => part.id));
    const answered = new Set(parts.filter((part) => part.type === 'tool-result').map((part) => part.toolCallId));
    const remaining = parts.filter((part) => {
      if (part.type === 'tool-call') return part.output !== undefined || answered.has(part.id);
      if (part.type === 'tool-result') return calls.has(part.toolCallId);
      return true;
    });
    if (remaining.length === parts.length) {
      kept.push(message);
      continue;
    }
    changed = true;
    // A message that is left with nothing goes: an assistant message of only a cut-off call.
    if (remaining.length > 0 || message.role !== 'assistant') kept.push({ ...message, parts: remaining });
  }
  return changed ? kept : messages;
};

/**
 * The messages without a turn that failed before anything came back: the staff member's question, and the empty assistant
 * message a failed run leaves after it (TanStack AI adds one for the RUN_ERROR). Staff read the notice, and the question goes
 * back into the text box, so sending it again doesn't put it in the chat twice. A turn that began to answer, with text or a
 * tool line, stays as staff can read it. Gives back the same array when there is nothing to take back.
 */
export const withoutFailedTurn = <M extends MessageLike>(messages: M[]): M[] => {
  let end = messages.length;
  const last = messages[end - 1];
  if (last?.role === 'assistant' && drawableParts(partsOfMessage(last)).length === 0) end -= 1;
  if (end > 0 && messages[end - 1].role === 'user') end -= 1;
  else if (end === messages.length) return messages;
  return messages.slice(0, end);
};

/** Where a message came from: typed in the text box, or one of the starter buttons. */
export type MessageSource = 'box' | 'starter';

/** The last question staff sent, kept so a failed turn can put it back. */
export interface SentQuestion {
  text: string;
  source: MessageSource;
}

/** The text box after a send. What was in the box is sent from the box, so it is emptied. A starter sends its own text and leaves the box as it was. */
export const draftAfterSend = (draft: string, source: MessageSource): string => (source === 'box' ? '' : draft);

/**
 * The text box after a turn failed. A question staff typed goes back into the box, when the box is empty, so they don't retype
 * it. A starter doesn't (staff did not type it, and its button is a click away), and a box with text in it is left alone. Stop is
 * not a failure and never gets here.
 */
export const draftAfterFailure = ({ draft, question }: { draft: string; question: SentQuestion | null }): string =>
  question?.source === 'box' && draft.trim() === '' ? question.text : draft;

/**
 * Whether the message box follows the newest message: while the reader is at its bottom, or within a few pixels of it (a browser
 * may stop short by a fraction). A reader who has scrolled up to read is not pulled back down by the answer that is arriving.
 */
export const followsNewest = ({ scrollTop, clientHeight, scrollHeight }: { scrollTop: number; clientHeight: number; scrollHeight: number }, slack = 24): boolean =>
  scrollHeight - (scrollTop + clientHeight) <= slack;

/**
 * Which buttons the text box has. Send and Stop sit side by side: Send is switched off while an answer is on its way, and Stop is
 * there only then. A second click on Send, as in a double click, lands on a switched-off button and never on Stop.
 */
export const composerButtons = ({ text, busy, ready }: { text: string; busy: boolean; ready: boolean }): { sendDisabled: boolean; showStop: boolean } => ({
  sendDisabled: !canSend({ text, busy, ready }),
  showStop: busy,
});

/**
 * The admin's token, as the page's own requests send it. Strapi keeps it in localStorage, written as a JSON string (a bare
 * token works too), and otherwise in a cookie, whose name the admin build is given (`jwtToken` unless the app renames it).
 * A stream can't go through Strapi's fetch client, which adds the token itself, so the page reads it the same way.
 */
export const adminTokenFrom = ({ stored, cookie, cookieName }: { stored: string | null; cookie: string; cookieName: string }): string | null => {
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed === 'string' && parsed !== '') return parsed;
    } catch {
      return stored;
    }
  }
  const prefix = `${cookieName}=`;
  const found = cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  const value = found?.slice(prefix.length) ?? '';
  if (value === '') return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
