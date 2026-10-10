import { describe, expect, it } from 'vitest';

import { MAX_BODY_BYTES, isCustomerSession, readBody } from './request-body';

const post = (init: RequestInit & { duplex?: 'half' }) => new Request('http://localhost:3004/api/concierge', { method: 'POST', ...init });

describe('readBody', () => {
  it('reads a body that fits, and an empty one', async () => {
    expect(new TextDecoder().decode((await readBody(post({ body: 'hello' }), 10))!)).toBe('hello');
    expect((await readBody(post({ body: 'a'.repeat(10) }), 10))!.byteLength).toBe(10);
    expect((await readBody(new Request('http://localhost:3004/api/concierge'), 10))!.byteLength).toBe(0);
  });

  it('answers null for a body over the limit: by its Content-Length, without reading it, or as it arrives', async () => {
    expect(await readBody(post({ body: 'a'.repeat(11) }), 10)).toBeNull();
    expect(await readBody(post({ body: 'x', headers: { 'Content-Length': '50' } }), 10)).toBeNull();
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i++) controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    expect(await readBody(post({ body: chunks, duplex: 'half' }), 10)).toBeNull();
  });

  it('throws when the body cannot be read to its end', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2));
        controller.error(new Error('the connection closed'));
      },
    });
    await expect(readBody(post({ body: broken, duplex: 'half' }), 10)).rejects.toThrow('the connection closed');
  });

  it('is 1 MB for the app', () => {
    expect(MAX_BODY_BYTES).toBe(1024 * 1024);
  });
});

describe('isCustomerSession', () => {
  it('accepts a Bearer token from the token exchange (mcp_at_) and nothing else', () => {
    expect(isCustomerSession('Bearer mcp_at_abc123')).toBe(true);
    for (const value of [null, '', 'Bearer', 'Bearer mcp_at_', 'Bearer an-admin-token', 'Basic dXNlcjpwYXNz', 'bearer mcp_at_abc', 'Bearer mcp_at_a b']) expect(isCustomerSession(value), String(value)).toBe(false);
  });
});
