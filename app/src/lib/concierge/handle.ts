// Server only: it holds the customer's own Authorization header and the model's key. The marker import makes TanStack
// Start's import protection fail the build when the client bundle reaches this file.
import '@tanstack/react-start/server-only';

import {
  EventType,
  StreamProcessor,
  chat,
  chatParamsFromRequestBody,
  convertMessagesToModelMessages,
  maxIterations,
  modelMessagesToUIMessages,
  toServerSentEventsResponse,
  type ChatMiddleware,
  type ModelMessage,
  type StreamChunk,
  type UIMessage,
} from '@tanstack/ai';

import { pieceSlugOf } from '../piece-slug';
import { MAX_BODY_BYTES, isCustomerSession, readBody } from '../request-body';
import { CHOOSE_VISIT } from '../visit-picker';
import { conciergeInstructions } from './instructions';
import { chooseVisitTool, resolveDateTool } from './local-tools';
import { openMcp, type MaisonMcp, type OpenMcpOptions } from './mcp-tools';
import { describeModelError, type ConciergeModel } from './model';
import { withAutoHandOff, withConversationLocale } from './tool-wrappers';
import {
  LOG_TIMEOUT_MS,
  MAX_CHARS,
  MAX_MESSAGES,
  MAX_REPLY,
  MAX_STEPS,
  NO_PICKER,
  PICKER_PASS_MIN_MS,
  PICKER_PASS_STEPS,
  PIECES_CHECK_TIMEOUT_MS,
  cutTo,
  lastQuestionOf,
  loggedReplyOf,
  needsPickerPass,
  pickerPassBudget,
  refusalTextOf,
  secondsOf,
  showsPicker,
  turnFactsOf,
  type TurnPart,
} from './turn';
import { chooseVisitCheck } from './visit-check';

/** How long each part of a turn may take. The defaults are the limits in turn.ts; a host or a test may give others. */
export interface ConciergeTimeouts {
  /** The end-of-turn log (LOG_TIMEOUT_MS). */
  logMs?: number;
  /** choose_visit's check of its pieces (PIECES_CHECK_TIMEOUT_MS). */
  piecesCheckMs?: number;
  /** How long a turn may run before the extra pass is skipped (TURN_BUDGET_MS). */
  budgetMs?: number;
  /** The most the extra pass may take (PICKER_PASS_TIMEOUT_MS). */
  pickerPassMs?: number;
  /** The least the extra pass is worth starting with (PICKER_PASS_MIN_MS). */
  pickerPassMinMs?: number;
}

export interface ConciergeDeps {
  /** The model (conciergeModel()): its adapter, its options, what to call it and what to do when it can't be reached. */
  model: ConciergeModel;
  /** Where the app's server reaches Strapi (`STRAPI_URL`). */
  strapiUrl: string;
  /** Makes the MCP transport. Tests give an in-memory one. Defaults to HTTP. */
  createTransport?: OpenMcpOptions['createTransport'];
  /** The clock. The request's start gives the instructions' calendar, and the time left for the extra pass. */
  now?: () => Date;
  timeouts?: ConciergeTimeouts;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const json = (body: Record<string, unknown>, status: number) => Response.json(body, { status });
const NOT_A_CHAT_REQUEST = 'The request is not a chat request: it needs a threadId, a runId and a list of messages.';
const BAD_MESSAGE = "Each message needs a role of user or assistant, and the customer's messages need their text as a string.";

/**
 * A message as the app sends it: the customer's (role user, text only) or the concierge's own earlier reply (assistant),
 * an object with a list of parts, each an object, and a text part's content a string. Anything else is the caller's
 * mistake, a 400. A system message was refused by the model call inside a 200 stream, and a number as the text reached it
 * before that.
 */
const isWellFormed = (message: UIMessage): boolean =>
  (message.role === 'user' || message.role === 'assistant') &&
  Array.isArray(message.parts) &&
  message.parts.every((part) => isObject(part) && (part.type !== 'text' || typeof (part as { content?: unknown }).content === 'string') && (message.role !== 'user' || part.type === 'text'));

/**
 * The conversation without the tool calls nobody answered. A visit picker the customer moved past by writing has no
 * answer, and an open client call would hang the next turn (chat() waits for the browser to answer it). A message that
 * held nothing else is left out whole.
 */
const withoutUnanswered = (messages: UIMessage[]): UIMessage[] =>
  messages.flatMap((message) => {
    if (message.role !== 'assistant') return [message];
    const answered = new Set(message.parts.flatMap((part) => (part.type === 'tool-result' ? [part.toolCallId] : [])));
    const parts = message.parts.filter((part) => part.type !== 'tool-call' || part.output !== undefined || answered.has(part.id));
    if (parts.length === message.parts.length) return [message];
    return parts.length === 0 ? [] : [{ ...message, parts }];
  });

/** Reads a run's events into the message the browser will build from them (the same processor `ChatClient` uses). */
class TurnRecorder {
  private readonly processor = new StreamProcessor();
  add(chunk: StreamChunk) {
    // A snapshot holds the whole conversation, the customer's messages too: those are no part of this turn.
    if (chunk.type !== EventType.MESSAGES_SNAPSHOT) this.processor.processChunk(chunk);
  }
  messages(): UIMessage[] {
    return this.processor.getMessages();
  }
  parts(): TurnPart[] {
    return this.messages().flatMap((message) => message.parts) as TurnPart[];
  }
}

/**
 * The extra pass's middleware for Anthropic: the first model call must call a tool, and a call after it must call
 * choose_visit until one was made (a call the check of its pieces refused counts: the model then needs only a tool).
 * `chat()` has no tool choice option, so this sets Anthropic's own `tool_choice` for each call, in `onConfig`. The Ollama
 * adapter has none: there the pass only offers the two tools.
 */
const requireChooseVisit = (): ChatMiddleware => {
  let called = false;
  return {
    name: 'require-choose-visit',
    onConfig: (ctx, config) => ({
      modelOptions: { ...config.modelOptions, tool_choice: ctx.iteration > 0 && !called ? { type: 'tool', name: CHOOSE_VISIT } : { type: 'any' } },
    }),
    onToolPhaseComplete: (_ctx, info) => {
      if (info.toolCalls.some((call) => call.function.name === CHOOSE_VISIT)) called = true;
    },
  };
};

/**
 * The model (Claude, or the local model) with the Maison tools, acting as the signed-in customer, as a server-sent event
 * stream for TanStack AI's `ChatClient`. The customer's own session token goes to Strapi unchanged; the route adds no
 * credential of its own. A host must allow it 60 seconds (TURN_BUDGET_MS plus the log).
 */
export async function handleConcierge(request: Request, deps: ConciergeDeps): Promise<Response> {
  const clock = () => deps.now?.() ?? new Date();
  // When the request started, for the extra pass's share of the route's time, and the "now" of the turn.
  const startedAt = clock();
  const timeouts = deps.timeouts ?? {};
  const logMs = timeouts.logMs ?? LOG_TIMEOUT_MS;

  const authorization = request.headers.get('authorization') ?? '';
  if (!isCustomerSession(authorization)) return json({ error: 'Sign in with LINE first.' }, 401);

  // At most 1 MB, as the body arrives: never more than that of one in memory.
  let raw: Uint8Array | null;
  try {
    raw = await readBody(request, MAX_BODY_BYTES);
  } catch {
    return json({ error: "The request's body couldn't be read." }, 400);
  }
  if (raw === null) return json({ error: 'The request body is over 1 MB.' }, 413);

  let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
  try {
    params = await chatParamsFromRequestBody(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    return json({ error: NOT_A_CHAT_REQUEST }, 400);
  }
  // The browser sends AG-UI messages (text, tool calls and tool results apart). This turns them back into a message with
  // its parts, which is what the rules in turn.ts read.
  let everything: UIMessage[];
  try {
    everything = modelMessagesToUIMessages(convertMessagesToModelMessages(params.messages));
  } catch {
    return json({ error: BAD_MESSAGE }, 400);
  }
  const messages = everything.slice(-MAX_MESSAGES);
  if (!messages.every(isWellFormed)) return json({ error: BAD_MESSAGE }, 400);
  // The customer's own messages are limited. What the concierge wrote earlier (sent back with each turn) isn't: a long reply must not refuse the next one.
  const oversized = messages.some((message) => message.role === 'user' && message.parts.some((part) => part.type === 'text' && part.content.length > MAX_CHARS));
  if (messages.length === 0 || oversized) return json({ error: `Send 1 to ${MAX_MESSAGES} messages of up to ${MAX_CHARS} characters.` }, 400);

  // Only these two come from the browser's forwarded props: anything else in them is ignored, never passed on.
  const locale = params.forwardedProps.locale === 'en' ? 'en' : 'ja';
  // The piece whose page the customer asked from, when they did: a value that isn't a slug is ignored.
  const piece = pieceSlugOf(params.forwardedProps.product);

  let mcp: MaisonMcp;
  try {
    mcp = await openMcp({ strapiUrl: deps.strapiUrl, authorization, createTransport: deps.createTransport });
  } catch (error) {
    return json({ error: `Could not reach the Maison tools: ${error instanceof Error ? error.message : String(error)}` }, 502);
  }

  try {
    // Set once, for the whole turn: aborted when the customer goes away (and by the response, when its stream is cancelled).
    const abortController = new AbortController();
    const goneAway = () => abortController.abort(request.signal.reason);
    if (request.signal.aborted) goneAway();
    else request.signal.addEventListener('abort', goneAway, { once: true });

    const now = startedAt; // one "now" for the instructions and for resolve_date
    const question = lastQuestionOf(messages);
    /**
     * A request whose last message is the concierge's own carries the customer's answer to a visit picker, and the reply
     * goes on in a new message. Its turn was logged when the customer's message arrived: one inquiry per customer message.
     */
    const resumed = messages.at(-1)?.role === 'assistant';
    const history = withoutUnanswered(messages);
    const instructions = conciergeInstructions(locale, now, piece);
    const resolveDate = resolveDateTool(locale, now);
    // The Maison tools, with the chat's locale, and with the hand-off an empty knowledge search makes on its own.
    const maisonTools = withAutoHandOff(withConversationLocale(mcp.tools, locale), { question, piece, locale });
    const tools = [...maisonTools, resolveDate, chooseVisitTool];
    const check = chooseVisitCheck({ client: mcp.client, locale, timeoutMs: timeouts.piecesCheckMs ?? PIECES_CHECK_TIMEOUT_MS });
    const { model } = deps;
    // One of two shapes, by provider (conciergeModel): chat() types it by the adapter, and the adapter here is either one.
    const modelOptions = model.modelOptions as never;

    /** What a failed model call tells the customer, and the server's log, in words only: an error object can carry the request. */
    const failureWords = (error: unknown) => describeModelError(error, model.label, model.fix);

    let logged = false;
    /**
     * Logs the finished turn in Strapi as an inquiry, for the staff's Inquiries tab. Nothing is logged without the tool (a
     * token without the permission) or without a question to log. A log that fails, is refused or runs past `logMs`
     * never changes the customer's turn: the reply is already written, so the log only warns, and this never throws.
     */
    const logTurn = async (parts: TurnPart[]) => {
      logged = true;
      if (!mcp.listed.includes('log_inquiry') || question === '' || resumed) return;
      // The call's own limit, not the request's signal: a customer who closes the chat after the last word doesn't cut the log.
      const timeout = AbortSignal.timeout(logMs);
      let why: string | undefined;
      try {
        const { knowledgeFound, handedOff, questionReference } = turnFactsOf(parts);
        const answer = await mcp.client.callTool(
          {
            name: 'log_inquiry',
            arguments: {
              message: question,
              // A long turn is logged cut to what the tool takes (the note included): refused whole, it wouldn't be logged at all.
              reply: cutTo(loggedReplyOf(parts), MAX_REPLY),
              knowledgeFound,
              handedOff,
              ...(questionReference ? { questionReference } : {}),
              ...(piece ? { productSlug: piece } : {}),
              locale,
            },
          },
          undefined,
          { signal: timeout }
        );
        if (isObject(answer) && answer.isError === true) why = refusalTextOf(answer) ?? 'its answer gives no reason';
      } catch (error) {
        // The MCP client words a call the signal cut off as "Request was aborted", which doesn't say who did it.
        why = timeout.aborted ? `it took longer than ${secondsOf(logMs)} seconds` : error instanceof Error ? error.message : String(error);
      }
      if (why !== undefined) console.warn("[concierge] The turn couldn't be logged:", why);
    };

    /**
     * The extra pass: a second `chat()` run with the same model and instructions, and only resolve_date and choose_visit
     * offered. On Anthropic a tool call is required, and choose_visit from the second call on (requireChooseVisit). It
     * stops at the picker (a client tool ends the run), or after PICKER_PASS_STEPS, and is cut off after `ms`. Its
     * messages are the conversation and the turn's own, without the reply's words when they come last: Claude Sonnet 5
     * refuses a request that ends with the assistant's turn (a prefill) with a 400.
     *
     * What it gives back is its events (without its start, its snapshot, or its finish), the finish, and its parts, only
     * when it ended whole with a picker. Otherwise it gives why it didn't, or null when the customer left, which isn't a
     * failure. Nothing of a pass that fails reaches the page.
     */
    const pickerPass = async (turnMessages: ModelMessage[], ms: number): Promise<{ why: string | null } | { events: StreamChunk[]; finish: StreamChunk; parts: TurnPart[] }> => {
      const timeout = AbortSignal.timeout(ms);
      const stopped = AbortSignal.any([abortController.signal, timeout]);
      const passAbort = new AbortController();
      const stop = () => passAbort.abort();
      if (stopped.aborted) stop();
      else stopped.addEventListener('abort', stop, { once: true });
      const recorder = new TurnRecorder();
      const events: StreamChunk[] = [];
      let finish: StreamChunk | null = null;
      let failure: unknown;
      try {
        const pass = chat({
          adapter: model.adapter,
          messages: [...history, ...turnMessages],
          systemPrompts: [instructions],
          tools: [resolveDate, chooseVisitTool],
          agentLoopStrategy: maxIterations(PICKER_PASS_STEPS),
          middleware: [check, ...(model.provider === 'anthropic' ? [requireChooseVisit()] : [])],
          abortController: passAbort,
          threadId: params.threadId,
          runId: params.runId,
          modelOptions,
          debug: false,
        }) as AsyncIterable<StreamChunk>;
        for await (const chunk of pass) {
          recorder.add(chunk);
          if (chunk.type === EventType.RUN_ERROR) failure ??= chunk;
          // The first run's start is the page's, and a snapshot would put the pass's messages in place of the conversation. Only the last finish is the pass's own.
          else if (chunk.type === EventType.RUN_FINISHED) finish = chunk;
          else if (chunk.type !== EventType.RUN_STARTED && chunk.type !== EventType.MESSAGES_SNAPSHOT) events.push(chunk);
        }
      } catch (error) {
        failure ??= error;
      }
      stopped.removeEventListener('abort', stop);
      if (abortController.signal.aborted) return { why: null };
      if (timeout.aborted) return { why: `it took longer than ${secondsOf(ms)} seconds` };
      if (failure !== undefined) return { why: failureWords(failure) };
      const parts = recorder.parts();
      if (!finish || !showsPicker(parts)) return { why: 'it ended without a visit picker' };
      return { events, finish, parts };
    };

    /**
     * The turn's events, as one response. The first run's events go out as they come, but its last finish is held back:
     * the extra pass adds its events to the same message first (a finish would close the stream for the browser), and
     * its own finish, the one that waits for the customer at the picker, ends the response. Without a picker, the first
     * run's finish ends it. The turn is logged once, after both passes, and the client is closed after the log.
     */
    async function* reply(): AsyncGenerator<StreamChunk> {
      let loggable: TurnPart[] | null = null;
      try {
        const first = chat({
          adapter: model.adapter,
          messages: history,
          systemPrompts: [instructions],
          tools,
          agentLoopStrategy: maxIterations(MAX_STEPS),
          middleware: [check],
          abortController,
          threadId: params.threadId,
          runId: params.runId,
          modelOptions,
          // The default logger prints error objects, which can hold the request: errors are logged here, in words.
          debug: false,
        }) as AsyncIterable<StreamChunk>;
        const recorder = new TurnRecorder();
        let held: StreamChunk | null = null;
        let failed = false;
        try {
          for await (const chunk of first) {
            if (failed) continue;
            if (held) {
              yield held; // not the last finish: a run that calls a tool has one before each tool phase
              held = null;
            }
            if (chunk.type === EventType.RUN_ERROR) {
              failed = true;
              const message = failureWords(chunk);
              console.error('[concierge]', message);
              yield { ...chunk, message, error: { ...(isObject((chunk as { error?: unknown }).error) ? (chunk as { error: object }).error : {}), message } } as StreamChunk;
              continue;
            }
            recorder.add(chunk);
            if (chunk.type === EventType.RUN_FINISHED) held = chunk;
            else yield chunk;
          }
        } catch (error) {
          // A customer who went away is no failure.
          if (abortController.signal.aborted) return;
          failed = true;
          const message = failureWords(error);
          console.error('[concierge]', message);
          yield { type: EventType.RUN_ERROR, timestamp: Date.now(), message, ...(isObject(error) && typeof error.code === 'string' ? { code: error.code } : {}), error: { message } } as StreamChunk;
        }
        // Only a turn that ended whole gets the extra pass and the log.
        if (failed || !held) return;

        let finish: StreamChunk = held;
        let turn = recorder.parts();
        loggable = turn;
        if (needsPickerPass({ resumed, question, piece, messages, turnParts: turn })) {
          const budget = pickerPassBudget(clock().getTime() - startedAt.getTime(), { budgetMs: timeouts.budgetMs, maxMs: timeouts.pickerPassMs, minMs: timeouts.pickerPassMinMs });
          if ('left' in budget) {
            console.warn(NO_PICKER, `the turn had ${secondsOf(Math.max(0, budget.left))} seconds left, under the ${secondsOf(timeouts.pickerPassMinMs ?? PICKER_PASS_MIN_MS)} the pass needs`);
          } else {
            const turnMessages = convertMessagesToModelMessages(recorder.messages());
            while (turnMessages.at(-1)?.role === 'assistant') turnMessages.pop();
            const pass = await pickerPass(turnMessages as ModelMessage[], budget.ms);
            if ('events' in pass) {
              yield* pass.events;
              finish = pass.finish;
              turn = [...turn, ...pass.parts];
              loggable = turn;
            } else if (pass.why !== null) {
              console.warn(NO_PICKER, pass.why);
            }
          }
        }
        yield finish;
      } finally {
        request.signal.removeEventListener('abort', goneAway);
        // After the last word, or when the customer cancelled after it: the turn is logged either way. Never before the finish was sent.
        if (loggable && !logged) await logTurn(loggable);
        // Only now: closing the client first would cut the log short. Always closed, on an abort or an error too.
        await mcp.close().catch(() => {});
      }
    }

    return toServerSentEventsResponse(reply(), {
      abortController,
      // Nothing may hold the events back: no proxy buffer, no cache.
      headers: { 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
    });
  } catch (error) {
    await mcp.close().catch(() => {});
    throw error;
  }
}
