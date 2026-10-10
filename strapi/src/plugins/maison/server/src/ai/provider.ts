/**
 * The model providers the plugin knows. Anthropic is the default. Ollama is for local use without a key, and its host
 * is `aiBaseUrl`. The adapters that call the models come with the labelling and assistant tasks.
 */
export const AI_PROVIDERS = ['anthropic', 'ollama'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** The settings that say whether a model is set up: the plugin's `aiProvider`, `aiApiKey` and `aiBaseUrl`. */
export interface AiSettings {
  aiProvider: AiProvider;
  aiApiKey: string | null;
  aiBaseUrl: string | null;
}

/**
 * AI is optional. With a key, or with an Ollama host, a model labels inquiries. Without either, labelling is off, not
 * degraded: new inquiries are marked skipped and staff label them by hand. An empty key counts as none.
 */
export const aiEnabled = (settings: AiSettings): boolean => Boolean(settings.aiApiKey) || (settings.aiProvider === 'ollama' && Boolean(settings.aiBaseUrl));
