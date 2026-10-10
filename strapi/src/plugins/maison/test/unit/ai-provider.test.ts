import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, DEFAULT_MODEL, adapterFor, aiEnabled, modelIdOf, modelOptionsOf, modelVersionOf, type AiSettings } from '../../server/src/ai/provider';

const KEY = 'sk-ant-test-0123456789';
const HOST = 'http://127.0.0.1:11434';
const settings = (fields: Partial<AiSettings> = {}): AiSettings => ({ aiProvider: 'anthropic', aiModel: null, aiApiKey: null, aiBaseUrl: null, ...fields });

describe('the AI providers', () => {
  it('are anthropic and ollama', () => {
    expect([...AI_PROVIDERS]).toEqual(['anthropic', 'ollama']);
  });

  it('have a default model each: Claude Haiku 4.5 with its dated ID, and the local Qwen3 the concierge uses', () => {
    expect(DEFAULT_MODEL).toEqual({ anthropic: 'claude-haiku-4-5-20251001', ollama: 'qwen3-14b-32k' });
  });
});

describe('aiEnabled', () => {
  it.each([
    ['anthropic with a key', { aiProvider: 'anthropic', aiApiKey: 'a-key', aiBaseUrl: null }, true],
    ['anthropic with no key', { aiProvider: 'anthropic', aiApiKey: null, aiBaseUrl: null }, false],
    ['anthropic with an empty key, as an empty AI_API_KEY in an env file gives', { aiProvider: 'anthropic', aiApiKey: '', aiBaseUrl: null }, false],
    ['anthropic with only a host, which it does not use', { aiProvider: 'anthropic', aiApiKey: null, aiBaseUrl: HOST }, false],
    ['ollama with a host and no key', { aiProvider: 'ollama', aiApiKey: null, aiBaseUrl: HOST }, true],
    ['ollama with a host and a key', { aiProvider: 'ollama', aiApiKey: 'a-key', aiBaseUrl: 'https://ollama.example.test' }, true],
    ['ollama with a key and no host, which labelling cannot reach', { aiProvider: 'ollama', aiApiKey: 'a-key', aiBaseUrl: null }, false],
    ['ollama with a key and an empty host', { aiProvider: 'ollama', aiApiKey: 'a-key', aiBaseUrl: '' }, false],
    ['anthropic with a host and no key', { aiProvider: 'anthropic', aiApiKey: null, aiBaseUrl: HOST }, false],
    ['anthropic with a key and a host', { aiProvider: 'anthropic', aiApiKey: 'a-key', aiBaseUrl: HOST }, true],
    ['ollama with neither a host nor a key', { aiProvider: 'ollama', aiApiKey: null, aiBaseUrl: null }, false],
  ] as const)('is %s', (_what, fields, expected) => {
    expect(aiEnabled(settings(fields))).toBe(expected);
  });
});

describe('the model', () => {
  it('is the provider default, unless aiModel names another', () => {
    expect(modelIdOf(settings())).toBe('claude-haiku-4-5-20251001');
    expect(modelIdOf(settings({ aiProvider: 'ollama' }))).toBe('qwen3-14b-32k');
    expect(modelIdOf(settings({ aiModel: 'claude-sonnet-4-5' }))).toBe('claude-sonnet-4-5');
    expect(modelIdOf(settings({ aiProvider: 'ollama', aiModel: 'llama3.1' }))).toBe('llama3.1');
    // An empty AI_MODEL in an env file gives '': it means not set.
    expect(modelIdOf(settings({ aiModel: '' }))).toBe('claude-haiku-4-5-20251001');
  });

  it('is stamped as provider/model', () => {
    expect(modelVersionOf(settings())).toBe('anthropic/claude-haiku-4-5-20251001');
    expect(modelVersionOf(settings({ aiProvider: 'ollama', aiModel: 'llama3.1' }))).toBe('ollama/llama3.1');
  });

  it('gets think: false on Ollama, where Qwen3 would think before every label, and no options on Anthropic', () => {
    expect(modelOptionsOf(settings({ aiProvider: 'ollama' }))).toEqual({ think: false });
    expect(modelOptionsOf(settings())).toBeUndefined();
  });
});

describe('adapterFor', () => {
  it('makes the Anthropic adapter for the default model, with the key', async () => {
    const adapter = await adapterFor(settings({ aiApiKey: KEY }));

    expect(adapter.name).toBe('anthropic');
    expect(adapter.model).toBe('claude-haiku-4-5-20251001');
  });

  it('makes the Anthropic adapter for the model aiModel names', async () => {
    expect((await adapterFor(settings({ aiApiKey: KEY, aiModel: 'claude-sonnet-4-5' }))).model).toBe('claude-sonnet-4-5');
  });

  it('makes the Ollama adapter for the default model, at the host', async () => {
    const adapter = await adapterFor(settings({ aiProvider: 'ollama', aiBaseUrl: HOST }));

    expect(adapter.name).toBe('ollama');
    expect(adapter.model).toBe('qwen3-14b-32k');
  });

  it('makes the Ollama adapter when a key is set too, and does not use the key', async () => {
    expect((await adapterFor(settings({ aiProvider: 'ollama', aiBaseUrl: 'https://ollama.example.test', aiApiKey: KEY }))).name).toBe('ollama');
  });

  it('is made fresh for each call, so a new key or model takes effect on the next sweep', async () => {
    const first = await adapterFor(settings({ aiApiKey: KEY }));
    const second = await adapterFor(settings({ aiApiKey: KEY }));

    expect(second).not.toBe(first);
  });

  it('refuses Anthropic with no key, and says what to set', async () => {
    await expect(adapterFor(settings())).rejects.toThrow("aiProvider 'anthropic' needs aiApiKey");
  });

  it('refuses Ollama with no host, and says what to set', async () => {
    await expect(adapterFor(settings({ aiProvider: 'ollama' }))).rejects.toThrow("aiProvider 'ollama' needs aiBaseUrl (e.g. http://127.0.0.1:11434)");
  });
});
