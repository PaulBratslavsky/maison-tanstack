import type { ChatAdapter } from '../../server/src/ai/sdk';

/*
 * A text adapter for chat() that gives scripted labels, so the tests run the real @tanstack/ai and never reach a model.
 * Labelling calls `structuredOutput` once per inquiry, so that is the one call this adapter plays. `answer` is given what
 * the customer wrote and the call, and says what the model answers:
 * - an Error is thrown as it is,
 * - a string is the model's raw text, which the adapter parses as JSON, as the real adapters do,
 * - anything else is sent as JSON,
 * - `httpFailure(status, text)` is the provider answering with that status, and `noConnection()` is a connection that never
 *   came up. Both go out through the call's `wrapFetch`, as the real adapters' requests do, and then fail as the real adapters
 *   fail, with the message only: the real adapters keep no status on the error they throw,
 * - `hangs()` is a model that never answers and ignores its signal, as the Ollama adapter does,
 * - `hangsUntilAborted()` is a model that gives up when its signal aborts, as the Anthropic SDK does.
 */

type Doc = Record<string, any>;

/** What the adapter was given for one call: the chat options and the output schema, as the real adapters get them. */
export interface LabelCall {
  customerMessage: string;
  chatOptions: Doc;
  outputSchema: Doc;
}

const HTTP = Symbol('httpFailure');
const NO_CONNECTION = Symbol('noConnection');
const HANGS = Symbol('hangs');
const HANGS_UNTIL_ABORTED = Symbol('hangsUntilAborted');

export const httpFailure = (status: number, text: string) => ({ [HTTP]: { status, text } });
export const noConnection = () => ({ [NO_CONNECTION]: true });
export const hangs = () => ({ [HANGS]: true });
export const hangsUntilAborted = () => ({ [HANGS_UNTIL_ABORTED]: true });

/** What the customer wrote, as one call showed it to the model. */
export const customerMessageOf = (messages: Doc[]): string => {
  const text = messages
    .filter((message) => message.role === 'user')
    .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
    .join('');
  return /<customer_message>\n([\s\S]*?)\n<\/customer_message>/.exec(text)?.[1] ?? '';
};

/** The words a real adapter puts on the error it throws: its own text, with the provider's after it. */
const wrapped = (message: string) => new Error(`Structured output generation failed: ${message}`);

export const fakeLabelAdapter = (
  answer: (customerMessage: string, call: LabelCall) => unknown | Promise<unknown>,
  { model = 'claude-haiku-4-5-20251001', name = 'anthropic' }: { model?: string; name?: string } = {}
) => {
  const calls: LabelCall[] = [];
  const adapter = {
    kind: 'text',
    name,
    model,
    async *chatStream() {
      throw new Error('Labelling makes no chat call: only structured output.');
    },
    async structuredOutput({ chatOptions, outputSchema }: { chatOptions: Doc; outputSchema: Doc }) {
      const call: LabelCall = { customerMessage: customerMessageOf(chatOptions.messages), chatOptions, outputSchema };
      calls.push(call);
      const outcome = (await answer(call.customerMessage, call)) as Doc | string | Error;

      if (outcome instanceof Error) throw outcome;
      if (outcome && typeof outcome === 'object' && HTTP in outcome) {
        const { status, text } = outcome[HTTP] as { status: number; text: string };
        const fetched: typeof fetch = chatOptions.wrapFetch
          ? chatOptions.wrapFetch(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'error', message: text } }), { status }))
          : fetch;
        await fetched('https://provider.example.test/v1/messages', { method: 'POST' });
        throw wrapped(`${status} ${text}`);
      }
      if (outcome && typeof outcome === 'object' && NO_CONNECTION in outcome) {
        const fetched: typeof fetch = chatOptions.wrapFetch
          ? chatOptions.wrapFetch(async () => {
              throw new TypeError('fetch failed');
            })
          : fetch;
        await fetched('https://provider.example.test/v1/messages', { method: 'POST' }).catch(() => undefined);
        throw wrapped('Connection error.');
      }
      if (outcome && typeof outcome === 'object' && HANGS in outcome) return new Promise<never>(() => undefined);
      if (outcome && typeof outcome === 'object' && HANGS_UNTIL_ABORTED in outcome) {
        const signal: AbortSignal | undefined = chatOptions.request?.signal;
        return new Promise<never>((_resolve, reject) => {
          if (signal?.aborted) reject(wrapped('Request was aborted.'));
          else signal?.addEventListener('abort', () => reject(wrapped('Request was aborted.')), { once: true });
        });
      }

      const rawText = typeof outcome === 'string' ? outcome : JSON.stringify(outcome);
      try {
        return { data: JSON.parse(rawText), rawText };
      } catch {
        throw wrapped(`Failed to parse structured output as JSON. Content: ${rawText.slice(0, 200)}`);
      }
    },
  };
  return { adapter: adapter as unknown as ChatAdapter, calls };
};
