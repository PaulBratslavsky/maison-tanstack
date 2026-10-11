// Server only: it reads ANTHROPIC_API_KEY, which the browser never has. The marker import makes TanStack Start's import
// protection fail the build when the client bundle reaches this file.
import '@tanstack/react-start/server-only';

import { createAnthropicChat } from '@tanstack/ai-anthropic';
import { createOllamaChat } from '@tanstack/ai-ollama';

/** The concierge's hosted model, from `ANTHROPIC_API_KEY`. */
const CLAUDE_MODEL = 'claude-sonnet-5-5';
/** The local model when there is no key: a Qwen3 14B with a 32k context, made from a Modelfile (see the README). */
const DEFAULT_OLLAMA_MODEL = 'qwen3-14b-32k';
/** Where Ollama listens by default. Ollama's own client takes the host without a path. */
const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const OFFLINE_FIX = "Check the laptop's internet connection.";

/**
 * Ollama's own client wants the host with no path. maison-demo used Ollama's OpenAI-compatible address, which ends in
 * /v1, so a value carried over from it still works: a trailing /v1 or /v1/ (and any trailing slash) is dropped.
 */
const ollamaHost = (value: string) => value.replace(/(\/v1)?\/*$/, '');

const claude = (key: string) => createAnthropicChat(CLAUDE_MODEL, key);
const ollama = (model: string, host: string) => createOllamaChat(model, host);

/** What `conciergeModel` gives: the adapter for `chat()`, and what to say about it. */
export type ConciergeModel =
  | {
      provider: 'anthropic';
      adapter: ReturnType<typeof claude>;
      /** Anthropic needs no model options here. */
      modelOptions: undefined;
      /** Which model answers, for logs and error messages. Never contains a key. */
      label: string;
      /** What to do when the model can't be reached, in the concierge's error. */
      fix: string;
    }
  | {
      provider: 'ollama';
      adapter: ReturnType<typeof ollama>;
      /** Qwen3 thinks before every reply unless told not to, which is slow on a laptop. */
      modelOptions: { think: false };
      label: string;
      fix: string;
    };

/**
 * Claude Sonnet 5.5 with ANTHROPIC_API_KEY. With no key, a local model through Ollama's own API (TanStack AI's
 * `@tanstack/ai-ollama`): OLLAMA_MODEL (qwen3-14b-32k) at OLLAMA_BASE_URL (http://127.0.0.1:11434, with or without a trailing /v1). The original also
 * had Vercel AI Gateway. TanStack AI has no adapter for it, so it is left out. The key goes to the adapter and nowhere else.
 */
export const conciergeModel = (env: Record<string, string | undefined> = process.env): ConciergeModel => {
  const key = env.ANTHROPIC_API_KEY;
  if (key) return { provider: 'anthropic', adapter: claude(key), modelOptions: undefined, label: 'Claude Sonnet 5.5 (Anthropic)', fix: OFFLINE_FIX };
  const model = env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const host = ollamaHost(env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_HOST);
  return {
    provider: 'ollama',
    adapter: ollama(model, host),
    modelOptions: { think: false },
    label: `${model} (Ollama at ${host})`,
    fix: `Start Ollama with ${model}, or set ANTHROPIC_API_KEY in app/.env and restart the app.`,
  };
};

/**
 * How a model call that can't connect fails. Both adapters catch the error and end the run with a RUN_ERROR that holds
 * only its message and code (`toRunErrorPayload` in @tanstack/ai). Ollama's client lets fetch's error through, so the
 * message is "fetch failed". Anthropic's SDK says "Connection error.". Node's own error says ECONNREFUSED.
 */
const CANNOT_CONNECT = /Connection error|fetch failed|ECONNREFUSED/i;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The words of an error: an Error's message, a RUN_ERROR's message, or a string itself. Empty when there are none. */
const messageOf = (error: unknown): string => (typeof error === 'string' ? error : isObject(error) && typeof error.message === 'string' ? error.message : '');

/** Whether the error, or anything in its cause chain, says the connection failed. */
const cannotConnect = (error: unknown, seen = new Set<unknown>()): boolean => {
  if (seen.has(error)) return false;
  seen.add(error);
  if (CANNOT_CONNECT.test(messageOf(error))) return true;
  if (!isObject(error)) return false;
  return error.code === 'ECONNREFUSED' || cannotConnect(error.cause, seen);
};

/**
 * What the customer sees when the model fails. `error` is what a failed run gives: the RUN_ERROR chunk of a `chat()` run
 * (it has a `message` and a `code`), or a thrown error. A run fails with a RUN_ERROR only when the model call fails. A
 * tool that can't reach Strapi gives the model an error result instead, so this never blames the model for it. A call
 * that can't connect is named, with its provider's fix. Any other error gives its own message.
 */
export const describeModelError = (error: unknown, modelLabel?: string, modelFix?: string): string => {
  if (cannotConnect(error)) return `The concierge's model${modelLabel ? ` (${modelLabel})` : ''} isn't reachable.${modelFix ? ` ${modelFix}` : ''}`;
  return messageOf(error) || 'The concierge had a problem.';
};
