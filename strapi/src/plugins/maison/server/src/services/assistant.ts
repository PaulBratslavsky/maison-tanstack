import type { Core } from '@strapi/strapi';

import { notReadyReason, safeCode, staffErrorOf, withoutKey, type RawRunError, type StaffError } from '../assistant/errors';
import { instructions } from '../assistant/instructions';
import { createAnthropicAdapter, loadSdk, toTools, type ChatAdapter, type ChatParams } from '../ai/sdk';
import { assistantTools, toolLabel, type Ability, type AssistantToolSpec } from '../assistant/tools';
import { getConfig } from '../config';
import { ASSISTANT_LIMITS } from '../constants';

/** One event of the stream chat() gives: AG-UI's, with the fields this file reads. */
export interface Chunk {
  type: string;
  [field: string]: any;
}

/** The two events the wrapper adds to a stream, which the page turns into a note under the messages. */
export const CUSTOM_EVENTS = { maxTurns: 'max_turns', declined: 'declined' } as const;

export interface WrapOptions {
  /** The staff text for a RUN_ERROR, for the source's and for the wrapper's own timeout. */
  describe: (raw: RawRunError) => StaffError;
  /** Called once per RUN_ERROR the source sent, with the original, before it is rewritten. */
  onSourceError?: (original: RawRunError) => void;
  /** Called once when the stream ends, whatever the way: the tool names called (from TOOL_CALL_START) and the time taken. */
  onDone?: (summary: { tools: string[]; ms: number }) => void;
  deadlineMs: number;
  /** Held only by chat() and this wrapper. */
  chatController: AbortController;
  /** The response's signal: when it aborts (a closed tab, or Stop), the wrapper aborts chatController at once. */
  responseSignal: AbortSignal;
}

/** The fields of a RUN_ERROR that the SDK writes and the provider does not: the run's ids and the model, as strings. */
const SAFE_FIELDS = ['threadId', 'runId', 'model'] as const;

const TIMED_OUT = Symbol('timed out');
const RESPONSE_CLOSED = Symbol('response closed');

/** `finishReason` of a RUN_FINISHED. chat() 0.68 writes it in `metadata.tanstack`. An adapter's own chunk has it at the top level. */
const finishReasonOf = (chunk: Chunk): string | null | undefined => chunk.finishReason ?? chunk.metadata?.tanstack?.finishReason;

const customEvent = (name: string): Chunk => ({ type: 'CUSTOM', name, value: {}, timestamp: Date.now() });

/** Runs a callback that only logs: whatever it throws, the stream goes on. */
const quietly = (run: () => void) => {
  try {
    run();
  } catch {
    // A failed log line must never break an answer.
  }
};

/** What an error thrown by the source says, in the shape of a RUN_ERROR: the code is its code, else its HTTP status. */
const rawOfThrown = (error: unknown): RawRunError => {
  const thrown = error as { code?: unknown; status?: unknown; message?: unknown } | null | undefined;
  const code = typeof thrown?.code === 'string' || typeof thrown?.code === 'number' ? thrown.code : typeof thrown?.status === 'number' ? String(thrown.status) : undefined;
  return { code, message: typeof thrown?.message === 'string' ? thrown.message : String(error) };
};

/**
 * Takes the stream chat() gives and returns the stream the response sends.
 * - Each RUN_ERROR, and an error the source throws, becomes one with the staff text. The provider's own text goes to
 *   `onSourceError` and nowhere else.
 * - The whole request has `deadlineMs`, from the first pull. When it passes, the stream ends with a RUN_ERROR `timeout`,
 *   and chat() is stopped. The source need not answer: a call that hangs doesn't hold the wrapper up.
 * - When six model turns are spent on tool calls, chat() ends the run as a success, with a last RUN_FINISHED of
 *   `tool_calls`. The wrapper adds a `max_turns` event, unless the run is waiting for the browser to run a draft tool.
 * - A model turn that ends with "stop", no text and no tool call is a refusal, which the adapter can't report as one.
 *   The wrapper adds a `declined` event right after it.
 */
export async function* wrapStream(source: AsyncIterable<Chunk>, options: WrapOptions): AsyncGenerator<Chunk> {
  const { describe, onSourceError, onDone, deadlineMs, chatController, responseSignal } = options;
  const startedAt = Date.now();
  const tools: string[] = [];
  const iterator = source[Symbol.asyncIterator]();

  // The response closing (a closed tab, or Stop) stops the model call at once, and stops this stream waiting for the source.
  const stopChat = () => chatController.abort();
  let signalResponseClosed: () => void = () => {};
  const responseClosed = new Promise<typeof RESPONSE_CLOSED>((resolve) => {
    signalResponseClosed = () => resolve(RESPONSE_CLOSED);
  });
  const onResponseClosed = () => {
    stopChat();
    signalResponseClosed();
  };
  if (responseSignal.aborted) onResponseClosed();
  else responseSignal.addEventListener('abort', onResponseClosed, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let sourceDone = false;
  let timedOut = false;
  let lastFinished: Chunk | null = null;
  let sawText = false;
  let sawToolCall = false;

  /**
   * The RUN_ERROR staff read, for what the source or the wrapper says went wrong. `rest` is the source's own event.
   *
   * Only the fields in SAFE_FIELDS are kept from it. TanStack AI 0.68 sends `rawEvent` and `metadata` as they are, and moves every
   * other field it does not know into `metadata.tanstack`, so a field copied from the provider's error could carry its text to the
   * page. The ids and the model are from the SDK, not from the provider, and they stay so the page can tell which run failed.
   */
  const staffError = (raw: RawRunError, rest: Record<string, any> = {}): Chunk => {
    const staff = describe(raw);
    const kept: Record<string, any> = {};
    for (const field of SAFE_FIELDS) if (typeof rest[field] === 'string') kept[field] = rest[field];
    const inMetadata: Record<string, any> = {};
    for (const field of SAFE_FIELDS) if (typeof rest.metadata?.tanstack?.[field] === 'string') inMetadata[field] = rest.metadata.tanstack[field];
    return {
      ...kept,
      type: 'RUN_ERROR',
      timestamp: typeof rest.timestamp === 'number' ? rest.timestamp : Date.now(),
      message: staff.message,
      code: safeCode(staff.code),
      error: { message: staff.message, code: safeCode(staff.code) },
      ...(Object.keys(inMetadata).length > 0 ? { metadata: { tanstack: inMetadata } } : {}),
    };
  };

  try {
    while (true) {
      const remaining = startedAt + deadlineMs - Date.now();
      let step: IteratorResult<Chunk> | typeof TIMED_OUT | typeof RESPONSE_CLOSED;
      try {
        step =
          remaining <= 0
            ? TIMED_OUT
            : await Promise.race([
                iterator.next(),
                responseClosed,
                new Promise<typeof TIMED_OUT>((resolve) => {
                  timer = setTimeout(() => resolve(TIMED_OUT), remaining);
                }),
              ]);
      } catch (error) {
        sourceDone = true;
        const raw = rawOfThrown(error);
        if (onSourceError) quietly(() => onSourceError(raw));
        yield staffError(raw);
        return;
      } finally {
        clearTimeout(timer);
      }

      if (step === RESPONSE_CLOSED) return;
      if (step === TIMED_OUT) {
        timedOut = true;
        yield staffError({ code: 'timeout', message: 'The request took too long.' });
        return;
      }
      if (step.done) {
        sourceDone = true;
        break;
      }

      const chunk = step.value;
      switch (chunk.type) {
        case 'RUN_ERROR': {
            const raw: RawRunError = { code: chunk.code ?? chunk.error?.code, message: chunk.message ?? chunk.error?.message };
          if (onSourceError) quietly(() => onSourceError(raw));
          yield staffError(raw, chunk);
          // One RUN_ERROR ends the stream: nothing the source sends after it, and no deadline or later throw, reaches the page.
          stopChat();
          return;
        }
        case 'TOOL_CALL_START':
          sawToolCall = true;
          tools.push(chunk.toolCallName ?? chunk.toolName ?? 'unknown');
          yield chunk;
          break;
        case 'TEXT_MESSAGE_CONTENT':
          if (typeof chunk.delta === 'string' && chunk.delta.trim() !== '') sawText = true;
          yield chunk;
          break;
        case 'RUN_FINISHED': {
          lastFinished = chunk;
          const declined = finishReasonOf(chunk) === 'stop' && !sawText && !sawToolCall;
          sawText = false;
          sawToolCall = false;
          yield chunk;
          if (declined) yield customEvent(CUSTOM_EVENTS.declined);
          break;
        }
        default:
          yield chunk;
      }
    }

    if (lastFinished && finishReasonOf(lastFinished) === 'tool_calls' && lastFinished.outcome?.type !== 'interrupt') {
      yield customEvent(CUSTOM_EVENTS.maxTurns);
    }
  } finally {
    clearTimeout(timer);
    responseSignal.removeEventListener('abort', onResponseClosed);
    // A source that is still running, or hung, is told to stop and not waited for: its return() can't run until its pending pull ends.
    if (!sourceDone) quietly(() => void Promise.resolve(iterator.return?.()).catch(() => {}));
    if (timedOut) stopChat();
    if (onDone) quietly(() => onDone({ tools, ms: Date.now() - startedAt }));
  }
}

export type AdapterFor = (model: string, apiKey: string) => ChatAdapter | Promise<ChatAdapter>;

export interface TurnRequest {
  ability: Ability;
  adminId: number | null;
  /** Held by the controller. Aborted only when the response closes before it ends. */
  responseController: AbortController;
  /** Tests only. Default: createAnthropicAdapter. */
  adapterFor?: AdapterFor;
  now?: Date;
  deadlineMs?: number;
}

export type AssistantStatus = { ready: true; model: string } | { ready: false; reason: string };

/**
 * A tool as the Ask tab lists it: its name, and what staff call it. It is exported although no other file imports it: the type of this
 * service, which the plugin's declaration files spell out, includes it, and the build reports an error (TS4082) when it cannot be named.
 */
export interface ToolInfo {
  name: string;
  label: string;
}

/** What GET /assistant/status answers: the status, and for a ready assistant the tools this admin's chat gets. */
type AssistantStatusAnswer = { ready: true; model: string; tools: ToolInfo[] } | { ready: false; reason: string };

/** How many messages staff have sent in a chat: the ones with the role `user`. The model's answers and the tool results are not counted. */
export const countStaffMessages = (messages: ReadonlyArray<{ role?: string }>): number => messages.filter((message) => message.role === 'user').length;

/**
 * What a thrown value says, for a log line that starts with the plugin's own `[maison]` tag. The loader's errors start
 * with the tag already, so it is taken off, and the line shows it once.
 */
export const thrownText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/^\[maison\]\s*/, '');

/**
 * What a tool answers when its service throws: fixed text, in the shape of the tools' other expected failures. Without
 * this, @tanstack/ai catches the throw and gives the model "Error executing tool: <the message>", and sends the same text
 * to the page in the tool's result event. The message can hold database text.
 */
const toolFailed = () => ({
  error: {
    code: 'tool_failed',
    message: 'Maison could not read that just now.',
    hint: 'Tell staff the lookup failed and suggest trying again. Do not guess the answer.',
  },
});

/**
 * The spec with an `execute` that never throws: when the original does, `onFailure` hears of it and the tool answers
 * `toolFailed()`. A spec with no `execute` (a draft tool, which the browser runs) is as it was.
 */
const guarded = (spec: AssistantToolSpec, onFailure: (name: string, error: unknown) => void): AssistantToolSpec => {
  const { execute } = spec;
  if (!execute) return spec;
  return {
    ...spec,
    async execute(args) {
      try {
        return await execute(args);
      } catch (error) {
        quietly(() => onFailure(spec.name, error));
        return toolFailed();
      }
    },
  };
};

/** The assistant: whether it is ready, the tools an admin gets, and one chat turn streamed with @tanstack/ai. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const status = (): AssistantStatus => {
    const config = getConfig(strapi);
    const reason = notReadyReason(config);
    return reason === null ? { ready: true, model: config.aiChatModel } : { ready: false, reason };
  };

  /**
   * An answer that is a 200 event stream holding one RUN_ERROR with the staff text. ai-client 0.39.2 never reads the body
   * of an HTTP error, so a refusal sent as one would reach staff as a bare status. A stream's error reaches them whole.
   *
   * It is written by hand and loads nothing: it is also what staff get when the SDK itself cannot be loaded. It is what
   * toServerSentEventsResponse writes for one RUN_ERROR, the same status, headers and bytes: a unit test compares the two.
   * That function sends each event as `data: <the event as JSON>\n\n`, with the event cut to the fields the AG-UI spec
   * names for it, which for a RUN_ERROR are `type`, `message`, `code` and `timestamp`.
   */
  const errorResponse = async (code: 'not_ready' | 'chat_too_long' | 'internal'): Promise<Response> => {
    const config = getConfig(strapi);
    const staff = staffErrorOf({ code }, { model: config.aiChatModel, notReady: notReadyReason(config) ?? undefined });
    const event = { type: 'RUN_ERROR', message: staff.message, code: staff.code, timestamp: Date.now() };
    return new Response(`data: ${JSON.stringify(event)}\n\n`, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  };

  /**
   * The status for one admin. A ready assistant also lists the tools this admin's chat really gets, which are the ones their
   * role allows after `disabledTools`, never every tool the plugin has. An assistant that is not ready has none.
   */
  const statusFor = (ability: Ability): AssistantStatusAnswer => {
    const current = status();
    if (current.ready === false) return current;
    return { ...current, tools: assistantTools(strapi, ability).map(({ name }) => ({ name, label: toolLabel(name) })) };
  };

  return {
    status,
    statusFor,
    errorResponse,

    /** The tools this admin may use. */
    tools(ability: Ability): AssistantToolSpec[] {
      return assistantTools(strapi, ability);
    },

    /** The request body as chat parameters. It throws, with a message for staff's developer, when the body is not an AG-UI run input. */
    async parseBody(body: unknown): Promise<ChatParams> {
      const { chatParamsFromRequestBody } = await loadSdk();
      return chatParamsFromRequestBody(body);
    },

    /** One turn of the chat, streamed. Every failure reaches staff as a RUN_ERROR in the stream, never as an HTTP error. */
    async turn(params: ChatParams, request: TurnRequest): Promise<Response> {
      const config = getConfig(strapi);
      if (notReadyReason(config) !== null) return errorResponse('not_ready');
      try {
        const { chat, maxIterations, toServerSentEventsResponse } = await loadSdk();
        const logToolFailure = (name: string, error: unknown) =>
          strapi.log.error(withoutKey(`[maison] assistant tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`, config.aiApiKey));
        const specs = assistantTools(strapi, request.ability).map((spec) => guarded(spec, logToolFailure));
        const names = specs.map((spec) => spec.name);
        const tools = await toTools(specs);
        const system = instructions({ today: request.now ?? new Date(), timezone: config.timezone, tools: names });
        const adapter = await (request.adapterFor ?? createAnthropicAdapter)(config.aiChatModel, config.aiApiKey as string);

        // Held only by chat() and the wrapper, so the wrapper can send its timeout error before chat() is stopped.
        const chatController = new AbortController();
        const stream = chat({
          adapter,
          stream: true,
          messages: params.messages,
          threadId: params.threadId,
          runId: params.runId,
          parentRunId: params.parentRunId,
          // The assistant has no interrupts and no client tools, so the browser's `resume` and `state` are never passed on.
          systemPrompts: [system],
          ...(tools.length > 0 ? { tools: tools as never } : {}),
          agentLoopStrategy: maxIterations(ASSISTANT_LIMITS.modelTurns),
          abortController: chatController,
          // The SDK's own logging would write the provider's errors to the console, without going through withoutKey.
          debug: false,
          modelOptions: { max_tokens: ASSISTANT_LIMITS.maxTokens, output_config: { effort: 'medium' } },
        } as never);

        const wrapped = wrapStream(stream as unknown as AsyncIterable<Chunk>, {
          describe: (raw) => staffErrorOf(raw, { model: config.aiChatModel }),
          onSourceError: (original) =>
            strapi.log.error(withoutKey(`[maison] The assistant's model call failed (${original.code ?? 'no code'}): ${original.message ?? 'no message'}`, config.aiApiKey)),
          onDone: ({ tools: called, ms }) =>
            strapi.log.info(`[maison] Assistant turn for admin ${request.adminId ?? 'unknown'}: tools ${called.length > 0 ? called.join(', ') : 'none'}, ${ms} ms.`),
          deadlineMs: request.deadlineMs ?? ASSISTANT_LIMITS.deadlineMs,
          chatController,
          responseSignal: request.responseController.signal,
        });
        return toServerSentEventsResponse(wrapped as never, { abortController: request.responseController });
      } catch (error) {
        strapi.log.error(withoutKey(`[maison] The assistant could not start a turn: ${thrownText(error)}`, config.aiApiKey));
        return errorResponse('internal');
      }
    },
  };
};
