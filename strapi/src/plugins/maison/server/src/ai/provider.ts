import { createAnthropicAdapter, createOllamaAdapter, type ChatAdapter } from './sdk';

/**
 * The one place a model provider is chosen: switching providers is a config change and not a code change. Anthropic is
 * the default. Ollama is for local use without a key, and its host is `aiBaseUrl`. Both go through TanStack AI, and
 * `ai/sdk.ts` is the only file that loads it.
 *
 * The settings are the plugin's config, `aiProvider`, `aiModel`, `aiApiKey` and `aiBaseUrl`, which the app maps from
 * AI_PROVIDER, AI_MODEL, AI_API_KEY and AI_BASE_URL.
 */
export const AI_PROVIDERS = ['anthropic', 'ollama'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** The settings that say which model is set up. */
export interface AiSettings {
  aiProvider: AiProvider;
  aiModel: string | null;
  aiApiKey: string | null;
  aiBaseUrl: string | null;
}

/**
 * A valid model ID per provider, so the first call after setting a key doesn't answer 404. A wrong default is worse than
 * no default: it fails at request time, far from the config that caused it.
 *
 * Haiku 4.5 for labelling, chosen on instruction-following and not on price. Anthropic lists it as active (its
 * deprecations page, October 2026), with a tentative retirement date of not sooner than October 15, 2026, and gives at
 * least 60 days' notice before it retires a publicly released model. `aiModel` (AI_MODEL) switches to another model.
 * The Ollama model is the local Qwen3 14B with a 32k context that the concierge uses too.
 */
export const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  ollama: 'qwen3-14b-32k',
};

/**
 * AI is optional. Each provider needs its own setting: Anthropic needs `aiApiKey`, and Ollama needs `aiBaseUrl` whatever the
 * key. Without it, labelling is off, not degraded: new inquiries are marked skipped and staff label them by hand. An empty
 * value counts as none.
 */
export const aiEnabled = (settings: Pick<AiSettings, 'aiProvider' | 'aiApiKey' | 'aiBaseUrl'>): boolean =>
  settings.aiProvider === 'ollama' ? Boolean(settings.aiBaseUrl) : Boolean(settings.aiApiKey);

/** An empty AI_MODEL in an env file gives '', which means not set. */
export const modelIdOf = (settings: AiSettings): string => settings.aiModel || DEFAULT_MODEL[settings.aiProvider];

/** Stamped on each labelled inquiry, so a re-label can tell which model produced a label. */
export const modelVersionOf = (settings: AiSettings): string => `${settings.aiProvider}/${modelIdOf(settings)}`;

/**
 * What `chat()` is given as `modelOptions`. Qwen3 thinks before every answer unless told not to, which is slow on a laptop
 * and adds nothing to a label, so Ollama gets `think: false`. Anthropic needs none: some Claude models refuse a sampling
 * parameter or a disabled thinking mode, so labelling sends neither.
 */
export const modelOptionsOf = (settings: AiSettings): { think: false } | undefined => (settings.aiProvider === 'ollama' ? { think: false } : undefined);

/**
 * The chat adapter for the settings, made on every call so a key or model change takes effect on the next sweep without a
 * restart. The key goes to the adapter and nowhere else. Nothing here reaches a network: the adapters connect when `chat()`
 * calls them.
 */
export const adapterFor = async (settings: AiSettings): Promise<ChatAdapter> => {
  const model = modelIdOf(settings);
  switch (settings.aiProvider) {
    case 'anthropic':
      if (!settings.aiApiKey) throw new Error("aiProvider 'anthropic' needs aiApiKey");
      return createAnthropicAdapter(model, settings.aiApiKey);
    case 'ollama':
      if (!settings.aiBaseUrl) throw new Error("aiProvider 'ollama' needs aiBaseUrl (e.g. http://127.0.0.1:11434)");
      return createOllamaAdapter(model, settings.aiBaseUrl);
  }
};
