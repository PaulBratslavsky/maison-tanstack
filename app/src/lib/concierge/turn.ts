import { pieceSlugOf } from '../piece-slug';
import { toolPartOf } from '../tool-view';
import { CHOOSE_VISIT, isRefusal } from '../visit-picker';
import { asksToVisit } from './asks-to-visit';

/**
 * The concierge route's pure rules about a turn, read from TanStack AI's message parts: a message is `{ role, parts }`,
 * where a part is text (`type: 'text'`, `content`) or a tool call (`type: 'tool-call'`, with `id`, `name`, `input` once
 * the whole call is in, `state`, and `output` once its result is in). A Maison tool's output is the whole MCP result
 * (`content`, `structuredContent`, `isError`). TanStack AI also keeps a `tool-result` part beside each call, and a
 * `thinking` part for a model's reasoning: neither is read here.
 */

/** What these rules need from a part. */
export interface TurnPart {
  type: string;
  /** A text part's words (a string), or whatever another part holds there: it is read only when it is a string. */
  content?: unknown;
  /** A tool-call part's id, tool name, state, input and output. */
  id?: string;
  name?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

/** What these rules need from a message. TanStack AI's `UIMessage` fits it. */
export interface TurnMessage {
  role: string;
  parts: ReadonlyArray<TurnPart>;
}

/** The most messages of a conversation the route reads: the last ones. */
export const MAX_MESSAGES = 20;
/** The most characters in one of the customer's messages. */
export const MAX_CHARS = 1000;
/** The longest question hand_off_to_staff takes (its schema's limit), in UTF-16 units: how Strapi counts a string's length. */
export const MAX_QUESTION = 1000;
/** The longest reply log_inquiry takes (its schema's limit), in UTF-16 units as above: a longer turn is cut to it, not refused whole. */
export const MAX_REPLY = 8000;
/** The model calls one turn may make at most (`maxIterations`). resolve_date adds one to most visits: the original 6 left a long search no room to answer. */
export const MAX_STEPS = 8;
/** How long the end-of-turn log may take: Strapi is close, and the customer's stream waits for it to finish. */
export const LOG_TIMEOUT_MS = 5000;
/** How long the visit picker's extra pass may take at most. The customer has the first reply meanwhile. */
export const PICKER_PASS_TIMEOUT_MS = 20_000;
/** The least time the extra pass is worth starting with: with less left, it is skipped. */
export const PICKER_PASS_MIN_MS = 5_000;
/**
 * How long a turn may run, from the request's start to the end of the extra pass: the route's 60 seconds less the log's
 * LOG_TIMEOUT_MS, which comes after the pass.
 */
export const TURN_BUDGET_MS = 55_000;
/** The extra pass's steps at most: resolve_date for a day the customer named, choose_visit, and one to spare. */
export const PICKER_PASS_STEPS = 3;
/** How long choose_visit's check of its pieces may take: Strapi is close, and the reply waits for it. */
export const PIECES_CHECK_TIMEOUT_MS = 5000;
/** What the server's log says when the extra pass shows no picker, before the reason. */
export const NO_PICKER = '[concierge] The extra pass for a visit picker showed none, so the turn keeps its first reply:';
/** What the log says of a turn that ended at a visit picker, for the staff who read it: the concierge's words aren't the whole of what it did. */
export const PICKER_NOTE = '(The concierge showed a visit picker so the customer can request a visit.)';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `text` cut to `max` UTF-16 units, how Strapi counts a string's length: never through half of an emoji, and without the
 * blanks the cut leaves at its end. Text that fits is returned as it is.
 */
export const cutTo = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  return (/[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head).trimEnd(); // the cut may have left a lone half of a pair
};

/**
 * The customer's last message as the question for staff: its text parts, trimmed, and cut to what hand_off_to_staff
 * takes, never through half of an emoji. Empty when it has no text.
 */
export const lastQuestionOf = (messages: ReadonlyArray<TurnMessage>): string => {
  const text = messages.findLast((message) => message.role === 'user')?.parts.flatMap((part) => (part.type === 'text' && typeof part.content === 'string' ? [part.content] : [])).join('\n') ?? '';
  return cutTo(text.trim(), MAX_QUESTION);
};

/**
 * The piece a question is about, for the hand-off an empty search makes: the one the search was about, which isn't always
 * the page's (a customer on one piece's page may ask about another, and staff see, and an answer saved to knowledge is
 * tagged to, the piece recorded here). `input` is what the model sent search_knowledge, and `page` the piece whose page
 * the customer asked from. A value in productSlugs that isn't a slug names no piece, and a piece named twice is one.
 * - The search names exactly one piece: that one.
 * - It names none, or its pieces include the page's: the page's piece (none, on no page).
 * - Otherwise (it names several, and the page's isn't among them): none, since there's no telling which one it is about.
 */
export const pieceOfSearch = (input: unknown, page: string | null): string | null => {
  const named = [...new Set((isObject(input) && Array.isArray(input.productSlugs) ? input.productSlugs : []).flatMap((slug) => pieceSlugOf(slug) ?? []))];
  if (named.length === 1) return named[0];
  return named.length === 0 || (page !== null && named.includes(page)) ? page : null;
};

/** The question Strapi recorded, as hand_off_to_staff answers it. */
export interface RecordedQuestion {
  reference: string;
  status: 'open';
  product: { slug: string; name: string } | null;
}

/** The question a hand_off_to_staff result says Strapi recorded: null for a refusal, and for a result with no reference. */
export const recordedQuestionOf = (result: unknown): RecordedQuestion | null => {
  if (!isObject(result) || result.isError === true || !isObject(result.structuredContent)) return null;
  const { question } = result.structuredContent;
  if (!isObject(question) || typeof question.reference !== 'string' || question.reference === '') return null;
  const { product } = question;
  return {
    reference: question.reference,
    status: 'open',
    product: isObject(product) && typeof product.slug === 'string' && typeof product.name === 'string' ? { slug: product.slug, name: product.name } : null,
  };
};

/** hand_off_to_staff's own answer for a question that is already recorded, in the shape Strapi's tool gives it. */
export const recordedResult = (question: RecordedQuestion) => {
  const data = { question };
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
};

/** The first text part of an error result, which is where a Maison tool puts its refusal. */
const refusalItemOf = (answer: unknown): { text: string } | null => {
  const item = isObject(answer) && answer.isError === true && Array.isArray(answer.content) ? answer.content.find((part) => isObject(part) && part.type === 'text') : undefined;
  return isObject(item) && typeof item.text === 'string' ? { text: item.text } : null;
};

/** Strapi's refusal as it gave it, for the log: the first text part of an error result, cut to 300. None for any other answer, and for a refusal with no text. */
export const refusalTextOf = (answer: unknown): string | undefined => refusalItemOf(answer)?.text.slice(0, 300);

/**
 * Strapi's words for a not_found refusal, as a Maison tool answers one (an isError result with its error as JSON): its
 * message and its hint. Null for any other answer.
 */
export const notFoundOf = (answer: unknown): string | null => {
  const item = refusalItemOf(answer);
  if (!item) return null;
  let error: unknown;
  try {
    error = (JSON.parse(item.text) as { error?: unknown } | null)?.error;
  } catch {
    return null; // not JSON: no refusal of Strapi's
  }
  if (!isObject(error) || error.code !== 'not_found' || typeof error.message !== 'string') return null;
  return [error.message, error.hint].filter((words) => typeof words === 'string' && words !== '').join(' ');
};

/** What a hand-off that recorded nothing says, for the log: Strapi's refusal as it gave it, or that its answer has no reference. */
export const whyNothingWasRecorded = (answer: unknown): string => refusalTextOf(answer) ?? 'its answer has no reference';

/** Whether a search_knowledge result came back whole and found nothing: not a refusal, and its `entries` an empty list. */
export const foundNothing = (result: unknown): result is Record<string, unknown> & { structuredContent: Record<string, unknown> } =>
  isObject(result) && result.isError !== true && isObject(result.structuredContent) && Array.isArray(result.structuredContent.entries) && result.structuredContent.entries.length === 0;

/** A tool's name and its result. */
export interface ToolResult {
  toolName: string;
  output: unknown;
}

/**
 * The calls among `parts` that came back whole (the state `complete`), each as its tool's name and result. A call still
 * running, one that ended in an error (its output is `{ error }`, not a result), and a part that is no call are left out.
 */
export const toolResultsOf = (parts: ReadonlyArray<TurnPart>): ToolResult[] =>
  parts.flatMap((part) => {
    const call = toolPartOf(part);
    return call?.state === 'complete' ? [{ toolName: call.toolName, output: call.output }] : [];
  });

/** What a finished turn did, for the inquiry it logs: whether knowledge answered, and the question a hand-off recorded. */
export const turnFactsOf = (parts: ReadonlyArray<TurnPart>): { knowledgeFound: boolean; handedOff: boolean; questionReference: string | null } => {
  let knowledgeFound = false;
  let questionReference: string | null = null;
  for (const { toolName, output } of toolResultsOf(parts)) {
    if (toolName === 'search_knowledge' && isObject(output) && output.isError !== true && isObject(output.structuredContent)) {
      const { entries, handOff } = output.structuredContent;
      if (Array.isArray(entries) && entries.length > 0) knowledgeFound = true;
      if (isObject(handOff) && typeof handOff.reference === 'string' && handOff.reference !== '') questionReference ??= handOff.reference;
    }
    if (toolName === 'hand_off_to_staff') questionReference ??= recordedQuestionOf(output)?.reference ?? null;
  }
  return { knowledgeFound, handedOff: questionReference !== null, questionReference };
};

/** The concierge's words for the turn: every text part of every step, as the customer read them. */
export const turnReplyOf = (parts: ReadonlyArray<TurnPart>): string =>
  parts
    .flatMap((part) => (part.type === 'text' && typeof part.content === 'string' ? [part.content] : []))
    .join('\n\n')
    .trim();

/**
 * Whether a turn holds a choose_visit call that showed the picker. A call the server refused showed none: one that ended
 * in an error, or was answered with a refusal (the check of its pieces).
 */
export const showsPicker = (parts: ReadonlyArray<TurnPart>): boolean =>
  parts.some((part) => {
    const call = toolPartOf(part);
    return call?.toolName === CHOOSE_VISIT && call.state !== 'error' && !isRefusal(call.output);
  });

/**
 * The reply a finished turn is logged with: its words (turnReplyOf), and, when the turn holds a choose_visit call that
 * showed the picker, the note above on a paragraph of its own, or alone when no words came before the call. A turn that
 * ends at the call has nothing after it: the customer's answer comes in a later request, which isn't logged, so without
 * the note staff's labeller would see a customer with no answer. A call the server refused showed no picker, and doesn't
 * count (showsPicker).
 */
export const loggedReplyOf = (parts: ReadonlyArray<TurnPart>): string => {
  const words = turnReplyOf(parts);
  return showsPicker(parts) ? [words, PICKER_NOTE].filter((paragraph) => paragraph !== '').join('\n\n') : words;
};

/** Whether a turn holds a choose_visit call in any state: one that showed the picker, or one that was refused. */
export const callsPicker = (parts: ReadonlyArray<TurnPart>): boolean => parts.some((part) => toolPartOf(part)?.toolName === CHOOSE_VISIT);

/** Whether a turn holds a my_appointments call, in any state: the customer asked about the visits they have. */
export const callsMyAppointments = (parts: ReadonlyArray<TurnPart>): boolean => parts.some((part) => toolPartOf(part)?.toolName === 'my_appointments');

/**
 * The pieces a tool result names by slug: a search_products result's products, or a view_product result's product. None
 * for a refusal (an isError result), a result with no structuredContent, any other tool, and a value that isn't a slug.
 */
export const piecesFoundBy = ({ toolName, output }: ToolResult): string[] => {
  if (!isObject(output) || output.isError === true || !isObject(output.structuredContent)) return [];
  const { products, product } = output.structuredContent;
  if (toolName === 'search_products' && Array.isArray(products)) return products.flatMap((found) => (isObject(found) ? (pieceSlugOf(found.slug) ?? []) : []));
  const viewed = toolName === 'view_product' && isObject(product) ? pieceSlugOf(product.slug) : null;
  return viewed ? [viewed] : [];
};

/**
 * Whether the conversation holds a visit picker the customer answered with a request: a visit was requested in this chat.
 * The answer's status is enough, whatever the visit it carries: a second picker after it could book the visit twice.
 */
export const visitRequestedIn = (messages: ReadonlyArray<TurnMessage>): boolean =>
  messages.some((message) =>
    message.parts.some((part) => {
      const call = toolPartOf(part);
      return call?.toolName === CHOOSE_VISIT && call.state === 'complete' && isObject(call.output) && call.output.status === 'requested';
    })
  );

/** The tool calls in the conversation's earlier replies that came back whole (toolResultsOf), from the concierge's messages only. */
export const earlierResultsOf = (messages: ReadonlyArray<TurnMessage>): ToolResult[] => messages.flatMap((message) => (message.role === 'assistant' ? toolResultsOf(message.parts) : []));

/**
 * The visit picker's safety net. Rule 3 says to call choose_visit for a visit, but the model decides, and once in
 * production it asked for the boutique, day and time in words instead. So a turn that ended whole (the route checks that
 * it didn't fail) gets one extra pass when all of these hold:
 * - it isn't a resume (`resumed`: the customer's answer to a picker);
 * - the customer's message asks for a new visit, in the words of a request (asksToVisit);
 * - no visit was requested in this chat yet (visitRequestedIn): after one, a question about it must not get a fresh
 *   picker that books it twice, so the model alone decides;
 * - the turn made no choose_visit call, in any state, a refused one included (callsPicker), and no my_appointments
 *   call (callsMyAppointments): that customer asked about the visits they have;
 * - a piece is known: the page's (`piece`), or one that search_products or view_product returned in this conversation, in
 *   an earlier reply or in this turn. Without one, asking which piece is the right reply.
 * The route then checks the time left (pickerPassBudget). `messages` are the conversation, and `turnParts` the parts the
 * turn made.
 */
export const needsPickerPass = ({
  resumed,
  question,
  piece,
  messages,
  turnParts,
}: {
  resumed: boolean;
  question: string;
  piece: string | null;
  messages: ReadonlyArray<TurnMessage>;
  turnParts: ReadonlyArray<TurnPart>;
}): boolean =>
  !resumed &&
  asksToVisit(question) &&
  !visitRequestedIn(messages) &&
  !callsPicker(turnParts) &&
  !callsMyAppointments(turnParts) &&
  (piece !== null || [...earlierResultsOf(messages), ...toolResultsOf(turnParts)].some((result) => piecesFoundBy(result).length > 0));

/** The limits of the extra pass's time. The defaults are the constants above. */
export interface PickerPassLimits {
  /** How long a turn may run, from the request's start. */
  budgetMs?: number;
  /** The most the pass may take. */
  maxMs?: number;
  /** The least the pass is worth starting with. */
  minMs?: number;
}

/**
 * How long the extra pass may take: what is left of the turn's budget (TURN_BUDGET_MS) after `elapsedMs` since the request
 * started, PICKER_PASS_TIMEOUT_MS at most. Or what is left, when that is under PICKER_PASS_MIN_MS: the pass is then skipped.
 * `limits` replaces any of the three constants.
 */
export const pickerPassBudget = (elapsedMs: number, { budgetMs = TURN_BUDGET_MS, maxMs = PICKER_PASS_TIMEOUT_MS, minMs = PICKER_PASS_MIN_MS }: PickerPassLimits = {}): { ms: number } | { left: number } => {
  const left = budgetMs - elapsedMs;
  return left < minMs ? { left } : { ms: Math.min(maxMs, left) };
};

/** Seconds, for the server's log: 15 for 15000, 4.2 for 4200. */
export const secondsOf = (ms: number): number => Number((ms / 1000).toFixed(1));
