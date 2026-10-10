import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { EventType, chat, type StreamChunk } from '@tanstack/ai';
import { createAnthropicChat } from '@tanstack/ai-anthropic';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { describe, expect, it } from 'vitest';

import { conciergeModel, describeModelError } from './model';

const KEY = 'sk-ant-test-key-1234';

describe('conciergeModel', () => {
  it('uses Claude Sonnet 5.5 through Anthropic when ANTHROPIC_API_KEY is set', () => {
    const { adapter, label, provider } = conciergeModel({ ANTHROPIC_API_KEY: KEY });
    expect(provider).toBe('anthropic');
    expect(adapter.name).toBe('anthropic');
    expect(adapter.model).toBe('claude-sonnet-5-5');
    expect(label).toBe('Claude Sonnet 5.5 (Anthropic)');
  });

  it('leaves the Ollama settings alone when there is a key, and sets no model options', () => {
    const { modelOptions } = conciergeModel({ ANTHROPIC_API_KEY: KEY, OLLAMA_MODEL: 'gemma4-26b-32k' });
    expect(modelOptions).toBeUndefined();
  });

  it('otherwise uses the local model on Ollama, qwen3-14b-32k at 127.0.0.1:11434 by default', () => {
    const { adapter, label, provider } = conciergeModel({});
    expect(provider).toBe('ollama');
    expect(adapter.name).toBe('ollama');
    expect(adapter.model).toBe('qwen3-14b-32k');
    expect(label).toBe('qwen3-14b-32k (Ollama at http://127.0.0.1:11434)');
  });

  it('takes the local model and server from OLLAMA_MODEL and OLLAMA_BASE_URL', () => {
    const { adapter, label } = conciergeModel({ OLLAMA_MODEL: 'gemma4-26b-32k', OLLAMA_BASE_URL: 'http://127.0.0.1:11500' });
    expect(adapter.model).toBe('gemma4-26b-32k');
    expect(label).toBe('gemma4-26b-32k (Ollama at http://127.0.0.1:11500)');
  });

  it('treats an empty ANTHROPIC_API_KEY, OLLAMA_MODEL and OLLAMA_BASE_URL as not set', () => {
    const { adapter, label } = conciergeModel({ ANTHROPIC_API_KEY: '', OLLAMA_MODEL: '', OLLAMA_BASE_URL: '' });
    expect(adapter.model).toBe('qwen3-14b-32k');
    expect(label).toBe('qwen3-14b-32k (Ollama at http://127.0.0.1:11434)');
  });

  it('turns thinking off for the local model', () => {
    expect(conciergeModel({}).modelOptions).toEqual({ think: false });
  });

  it("says what to do when the model can't be reached: the internet for Claude, Ollama with its model for the local model", () => {
    expect(conciergeModel({ ANTHROPIC_API_KEY: KEY }).fix).toBe("Check the laptop's internet connection.");
    expect(conciergeModel({}).fix).toBe('Start Ollama with qwen3-14b-32k, or set ANTHROPIC_API_KEY in app/.env and restart the app.');
    expect(conciergeModel({ OLLAMA_MODEL: 'gemma4-26b-32k' }).fix).toMatch(/^Start Ollama with gemma4-26b-32k,/);
  });

  it('never puts the key in the label or the fix', () => {
    const { label, fix } = conciergeModel({ ANTHROPIC_API_KEY: KEY });
    expect(label).not.toContain(KEY);
    expect(fix).not.toContain(KEY);
  });

  it('asks Ollama to skip thinking: the request carries think: false', async () => {
    let request: Record<string, unknown> = {};
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        request = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end(`${JSON.stringify({ model: 'qwen3-14b-32k', created_at: '2026-10-10T00:00:00Z', message: { role: 'assistant', content: 'ok' }, done: true, done_reason: 'stop' })}\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const { adapter, modelOptions } = conciergeModel({ OLLAMA_BASE_URL: `http://127.0.0.1:${port}` });
      const chunks: StreamChunk[] = [];
      for await (const chunk of chat({ adapter: adapter as never, messages: [{ role: 'user', content: 'Hello' }], modelOptions: modelOptions as never }) as AsyncIterable<StreamChunk>) chunks.push(chunk);
      expect(chunks.some((chunk) => chunk.type === EventType.RUN_ERROR)).toBe(false);
    } finally {
      server.close();
    }
    expect(request).toMatchObject({ model: 'qwen3-14b-32k', think: false });
  });
});

/** A local port nobody listens on: a connection to it is refused, as when Ollama is not running. */
const closedPort = async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

/** The RUN_ERROR a chat() run with `adapter` ends in. */
const runErrorOf = async (adapter: unknown) => {
  const errors: Array<{ message?: string; code?: string }> = [];
  for await (const chunk of chat({ adapter: adapter as never, messages: [{ role: 'user', content: 'Hello' }], debug: false }) as AsyncIterable<StreamChunk>) {
    if (chunk.type === EventType.RUN_ERROR) errors.push(chunk as { message?: string; code?: string });
  }
  expect(errors).toHaveLength(1);
  return errors[0];
};

describe('describeModelError', () => {
  it('names the model and its fix when Ollama refuses the connection (the real RUN_ERROR of the adapter)', async () => {
    const error = await runErrorOf(createOllamaChat('qwen3-14b-32k', `http://127.0.0.1:${await closedPort()}`));
    expect(error.message).toBe('fetch failed');
    expect(describeModelError(error, 'qwen3-14b-32k (Ollama at http://127.0.0.1:11434)', 'Start Ollama with qwen3-14b-32k.')).toBe(
      "The concierge's model (qwen3-14b-32k (Ollama at http://127.0.0.1:11434)) isn't reachable. Start Ollama with qwen3-14b-32k."
    );
  });

  it('names the model and its fix when Anthropic cannot be reached (the real RUN_ERROR of the adapter)', async () => {
    const adapter = createAnthropicChat('claude-sonnet-5-5', KEY, { baseURL: `http://127.0.0.1:${await closedPort()}`, maxRetries: 0 });
    const error = await runErrorOf(adapter);
    expect(error.message).toBe('Connection error.');
    const words = describeModelError(error, 'Claude Sonnet 5.5 (Anthropic)', "Check the laptop's internet connection.");
    expect(words).toBe("The concierge's model (Claude Sonnet 5.5 (Anthropic)) isn't reachable. Check the laptop's internet connection.");
    expect(words).not.toContain(KEY);
  });

  it('reads a thrown error and its cause the same way', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' });
    expect(describeModelError(new TypeError('fetch failed', { cause: refused }), 'M', 'Fix it.')).toBe("The concierge's model (M) isn't reachable. Fix it.");
    expect(describeModelError(new Error('Something broke', { cause: refused }), 'M', 'Fix it.')).toBe("The concierge's model (M) isn't reachable. Fix it.");
    expect(describeModelError({ message: 'connect ECONNREFUSED 127.0.0.1:11434' }, 'M')).toBe("The concierge's model (M) isn't reachable.");
  });

  it('says only that the model is not reachable when it has no label or fix', () => {
    expect(describeModelError({ message: 'fetch failed' })).toBe("The concierge's model isn't reachable.");
  });

  it("gives any other error's own message", () => {
    expect(describeModelError({ message: '401 invalid x-api-key', code: '401' }, 'M', 'Fix it.')).toBe('401 invalid x-api-key');
    expect(describeModelError(new Error('Rate limited'))).toBe('Rate limited');
  });

  it('gives a plain sentence for an error with no message', () => {
    expect(describeModelError({})).toBe('The concierge had a problem.');
    expect(describeModelError(undefined)).toBe('The concierge had a problem.');
    expect(describeModelError('')).toBe('The concierge had a problem.');
  });

  it('reads a bare string as the message', () => {
    expect(describeModelError('fetch failed', 'M')).toBe("The concierge's model (M) isn't reachable.");
    expect(describeModelError('Overloaded')).toBe('Overloaded');
  });
});
