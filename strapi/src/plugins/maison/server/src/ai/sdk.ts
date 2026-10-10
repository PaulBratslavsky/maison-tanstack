/**
 * The only file in the server that names @tanstack/*, and the only place the SDK is loaded.
 *
 * Maison's server is CommonJS, and @tanstack/ai and its adapters ship ESM only: their exports have no `require`
 * condition, so a `require` of any of them fails with ERR_PACKAGE_PATH_NOT_EXPORTED. A dynamic `import()` loads them from
 * CommonJS, and it costs nothing here, since every caller is async. The build keeps each `import()` as it is, and
 * `scripts/check-esm-import.mjs` fails if a built bundle loads any of the packages statically.
 *
 * Nothing else in `server/src` imports @tanstack/*, so "does Strapi load the SDK at boot?" is answered by reading imports:
 * it doesn't. A unit test holds that. Every static import in this file is a type, and the build erases it.
 */
import type { AnyTextAdapter, FetchWrapper } from '@tanstack/ai';

/**
 * What `chat()` takes as its adapter. The factories below give classes typed per model, which TypeScript 5.9 does not
 * match to this type's `any` slots, so each is cast once, here, where the adapters are made.
 */
export type ChatAdapter = AnyTextAdapter;
/** Wraps the fetch of one model call, as `chat({ wrapFetch })` takes it. */
export type FetchWrap = FetchWrapper;
export type Sdk = typeof import('@tanstack/ai');

/** The model IDs the Anthropic adapter lists. Its list has `claude-haiku-4-5` and not the dated ID that labelling uses. */
type AnthropicListedModel = Parameters<typeof import('@tanstack/ai-anthropic').createAnthropicChat>[0];

/** Said when a package can't be loaded: the SDK ships with the plugin, so it points at the install and keeps the cause. */
const notLoaded = (name: string, error: unknown) =>
  Object.assign(
    new Error(
      `[maison] Labelling needs ${name}, and it could not be loaded. It is a dependency of this plugin, so this usually means a broken install: run npm install, then restart Strapi. Original error: ${error instanceof Error ? error.message : String(error)}`
    ),
    { cause: error }
  );

let sdk: Sdk | null = null;

/** @tanstack/ai, loaded once. */
export const loadSdk = async (): Promise<Sdk> => {
  if (sdk) return sdk;
  try {
    sdk = await import('@tanstack/ai');
    return sdk;
  } catch (error) {
    throw notLoaded('@tanstack/ai', error);
  }
};

/**
 * The Anthropic chat adapter for a model and a key. `createAnthropicChat` takes them positionally. `anthropicText()` is
 * not used: it reads ANTHROPIC_API_KEY from the environment, and Maison's key is its own setting. This is the one typed
 * cast of a model ID: the adapter's list stops at `claude-haiku-4-5`, and the dated ID passes through to Anthropic as it is.
 */
export const createAnthropicAdapter = async (model: string, apiKey: string): Promise<ChatAdapter> => {
  let anthropic: typeof import('@tanstack/ai-anthropic');
  try {
    anthropic = await import('@tanstack/ai-anthropic');
  } catch (error) {
    throw notLoaded('@tanstack/ai-anthropic', error);
  }
  return anthropic.createAnthropicChat(model as AnthropicListedModel, apiKey) as unknown as ChatAdapter;
};

/**
 * The Ollama chat adapter for a model at a host. It takes no key: `aiApiKey` is the Anthropic key, and it must not go to
 * an Ollama host, a hosted one included.
 */
export const createOllamaAdapter = async (model: string, host: string): Promise<ChatAdapter> => {
  let ollama: typeof import('@tanstack/ai-ollama');
  try {
    ollama = await import('@tanstack/ai-ollama');
  } catch (error) {
    throw notLoaded('@tanstack/ai-ollama', error);
  }
  return ollama.createOllamaChat(model, host) as unknown as ChatAdapter;
};
