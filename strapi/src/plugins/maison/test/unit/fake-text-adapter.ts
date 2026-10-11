import type { ChatAdapter } from '../../server/src/ai/sdk';

/*
 * A text adapter for chat() that gives scripted answers, so the tests run the real @tanstack/ai and never reach a model.
 * Each model call takes the next scripted turn. A turn is the events one model call yields, or 'never': the call yields
 * nothing until its signal (options.request.signal, which chat() makes from its abortController) aborts, as a model call
 * that hangs does.
 */

export type ScriptedChunk = { type: string; [field: string]: any };
export type ScriptedTurn = ScriptedChunk[] | 'never';
/** What chatStream was given for one model call: the model, messages, systemPrompts, tools, modelOptions, request (whose signal aborts the call) and the rest. */
export type TextRequest = Record<string, any>;

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

/** A turn that answers with `text` and finishes. */
export const textTurn = (text: string): ScriptedTurn => {
  const messageId = nextId('msg');
  return [
    { type: 'RUN_STARTED' },
    { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text, content: text },
    { type: 'TEXT_MESSAGE_END', messageId },
    { type: 'RUN_FINISHED', finishReason: 'stop' },
  ];
};

/** A turn that calls one tool and stops for its result. */
export const toolCallTurn = (name: string, args: Record<string, unknown>, toolCallId: string = nextId('call')): ScriptedTurn => {
  const json = JSON.stringify(args);
  return [
    { type: 'RUN_STARTED' },
    { type: 'TOOL_CALL_START', toolCallId, toolCallName: name, toolName: name },
    { type: 'TOOL_CALL_ARGS', toolCallId, delta: json, args: json },
    { type: 'TOOL_CALL_END', toolCallId, toolCallName: name, toolName: name, input: args },
    { type: 'RUN_FINISHED', finishReason: 'tool_calls' },
  ];
};

/** A turn that finishes with "stop" and says nothing, which is what the adapter yields for a refusal. */
export const stopTurn = (): ScriptedTurn => [{ type: 'RUN_STARTED' }, { type: 'RUN_FINISHED', finishReason: 'stop' }];

/** A turn the provider fails, as the Anthropic adapter reports it: its own text in message, error.message and rawEvent. */
export const errorTurn = (code: string, message: string): ScriptedTurn => [
  { type: 'RUN_STARTED' },
  { type: 'RUN_ERROR', message, code, rawEvent: { provider: 'anthropic', status: Number(code) || undefined, body: message }, error: { message, code } },
];

/** An adapter that plays `turns` in order, and the options of every call it got. A call past the last turn fails. */
export const fakeTextAdapter = (turns: ScriptedTurn[]): { adapter: ChatAdapter; requests: TextRequest[] } => {
  const requests: TextRequest[] = [];
  const adapter = {
    kind: 'text',
    name: 'fake',
    model: 'claude-sonnet-5-5',
    async *chatStream(options: TextRequest) {
      const turn = turns[requests.length];
      requests.push(options);
      if (turn === undefined) throw new Error(`The fake adapter has no turn ${requests.length}: the script has ${turns.length}.`);
      if (turn === 'never') {
        await new Promise<void>((resolve) => {
          const signal: AbortSignal | undefined = options.request?.signal;
          if (!signal || signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return;
      }
      for (const chunk of turn) {
        const isRunEvent = chunk.type === 'RUN_STARTED' || chunk.type === 'RUN_FINISHED';
        yield {
          ...(isRunEvent ? { threadId: options.threadId ?? 'thread-fake', runId: options.runId ?? 'run-fake' } : {}),
          model: options.model,
          timestamp: Date.now(),
          ...chunk,
        };
      }
    },
    async structuredOutput() {
      throw new Error('The fake adapter has no structured output.');
    },
  };
  return { adapter: adapter as unknown as ChatAdapter, requests };
};
