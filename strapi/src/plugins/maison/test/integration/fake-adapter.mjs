/*
 * A text adapter for chat() that plays scripted answers, so the integration suites run the real TanStack AI from the built
 * plugin and never reach a model. Each model call takes the next scripted turn. A turn is the events one call yields, or 'never':
 * the call yields nothing until its signal aborts, as a call that hangs does. `requests` keeps the options of every call.
 */

let counter = 0;
const nextId = (prefix) => `${prefix}-${(counter += 1)}`;

/** A turn that answers with `text` and finishes. */
export const textTurn = (text) => {
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
export const toolCallTurn = (name, args) => {
  const toolCallId = nextId('call');
  const json = JSON.stringify(args);
  return [
    { type: 'RUN_STARTED' },
    { type: 'TOOL_CALL_START', toolCallId, toolCallName: name, toolName: name },
    { type: 'TOOL_CALL_ARGS', toolCallId, delta: json, args: json },
    { type: 'TOOL_CALL_END', toolCallId, toolCallName: name, toolName: name, input: args },
    { type: 'RUN_FINISHED', finishReason: 'tool_calls' },
  ];
};

export const fakeAdapter = (turns) => {
  const requests = [];
  const adapter = {
    kind: 'text',
    name: 'fake',
    model: 'claude-sonnet-5-5',
    async *chatStream(options) {
      const turn = turns[requests.length];
      requests.push(options);
      if (turn === undefined) throw new Error(`The fake adapter has no turn ${requests.length}: the script has ${turns.length}.`);
      if (turn === 'never') {
        await new Promise((resolve) => {
          const signal = options.request?.signal;
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
  return { adapter, requests };
};
