import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, aiEnabled } from '../../server/src/ai/provider';

describe('the AI providers', () => {
  it('are anthropic and ollama', () => {
    expect([...AI_PROVIDERS]).toEqual(['anthropic', 'ollama']);
  });
});

describe('aiEnabled', () => {
  it.each([
    ['anthropic with a key', { aiProvider: 'anthropic', aiApiKey: 'a-key', aiBaseUrl: null }, true],
    ['anthropic with no key', { aiProvider: 'anthropic', aiApiKey: null, aiBaseUrl: null }, false],
    ['anthropic with an empty key, as an empty AI_API_KEY in an env file gives', { aiProvider: 'anthropic', aiApiKey: '', aiBaseUrl: null }, false],
    ['anthropic with only a host, which it does not use', { aiProvider: 'anthropic', aiApiKey: null, aiBaseUrl: 'http://127.0.0.1:11434' }, false],
    ['ollama with a host and no key', { aiProvider: 'ollama', aiApiKey: null, aiBaseUrl: 'http://127.0.0.1:11434' }, true],
    ['ollama with a host and a key', { aiProvider: 'ollama', aiApiKey: 'a-key', aiBaseUrl: 'https://ollama.example.test' }, true],
    ['ollama with neither a host nor a key', { aiProvider: 'ollama', aiApiKey: null, aiBaseUrl: null }, false],
  ] as const)('is %s', (_what, settings, expected) => {
    expect(aiEnabled(settings)).toBe(expected);
  });
});
