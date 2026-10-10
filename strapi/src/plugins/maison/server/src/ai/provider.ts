/**
 * The model providers the plugin knows. Anthropic is the default. Ollama is for local use without a key, and its host
 * is `aiBaseUrl`. The adapters that call the models come with the labelling and assistant tasks.
 */
export const AI_PROVIDERS = ['anthropic', 'ollama'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
