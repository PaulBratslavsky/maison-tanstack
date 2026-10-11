import { describe, expect, it, vi } from 'vitest';
import type { RawRunError, StaffError } from '../../server/src/assistant/errors';
import { CUSTOM_EVENTS, wrapStream, type Chunk, type WrapOptions } from '../../server/src/services/assistant';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The chunks a source gives, one after the other. */
async function* scripted(chunks: Chunk[]): AsyncGenerator<Chunk> {
  for (const chunk of chunks) yield chunk;
}

/** Everything a wrapped stream gives. */
const collect = async (stream: AsyncIterable<Chunk>): Promise<Chunk[]> => {
  const out: Chunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
};

/** The options a wrapper needs, with a describe that makes the staff text easy to see: STAFF(<code>). */
const optionsOf = (overrides: Partial<WrapOptions> = {}) => {
  const chatController = new AbortController();
  const responseController = new AbortController();
  const describe_ = vi.fn((raw: RawRunError): StaffError => ({ code: String(raw.code ?? 'error'), message: `STAFF(${raw.code ?? 'error'})` }));
  const onSourceError = vi.fn();
  const onDone = vi.fn();
  const options: WrapOptions = {
    describe: describe_,
    onSourceError,
    onDone,
    deadlineMs: 5_000,
    chatController,
    responseSignal: responseController.signal,
    ...overrides,
  };
  return { options, chatController, responseController, describe: describe_, onSourceError, onDone };
};

// The chunks chat() gives, as far as the wrapper reads them.
const started: Chunk = { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' };
const text = (delta: string): Chunk => ({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta });
const toolStart = (name: string, id = 'call-1'): Chunk => ({ type: 'TOOL_CALL_START', toolCallId: id, toolCallName: name });
const finished = (finishReason: string | null, extra: Record<string, unknown> = {}): Chunk => ({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', finishReason, ...extra });
const customNames = (chunks: Chunk[]) => chunks.filter((chunk) => chunk.type === 'CUSTOM').map((chunk) => chunk.name);

describe('CUSTOM_EVENTS', () => {
  it('names the two events the page reads', () => {
    expect(CUSTOM_EVENTS).toEqual({ maxTurns: 'max_turns', declined: 'declined' });
  });
});

describe('wrapStream, an ordinary run', () => {
  it('gives every chunk as it came, in order, and adds nothing to a run that ends with text', async () => {
    const chunks = [started, text('Hello'), text(' there.'), finished('stop')];
    const { options } = optionsOf();
    expect(await collect(wrapStream(scripted(chunks), options))).toEqual(chunks);
  });

  it('gives the same chunk objects, not copies', async () => {
    const chunk = text('Hi');
    const { options } = optionsOf();
    const [out] = await collect(wrapStream(scripted([chunk, finished('stop')]), options));
    expect(out).toBe(chunk);
  });

  it('pulls nothing from the source until it is read', async () => {
    let pulled = false;
    async function* source(): AsyncGenerator<Chunk> {
      pulled = true;
      yield finished('stop');
    }
    wrapStream(source(), optionsOf().options);
    await sleep(5);
    expect(pulled).toBe(false);
  });
});

describe('wrapStream, errors', () => {
  const providerError: Chunk = {
    type: 'RUN_ERROR',
    model: 'claude-sonnet-5-5',
    timestamp: 1_700_000_000_000,
    message: '401 {"error":{"message":"invalid x-api-key sk-ant-api03-SECRET"},"request_id":"req_1"}',
    code: '401',
    rawEvent: { status: 401, body: 'sk-ant-api03-SECRET' },
    error: { message: '401 {"error":{"message":"invalid x-api-key sk-ant-api03-SECRET"}}', code: '401' },
  };

  it('rewrites message, error.message, code and error.code from describe, and drops rawEvent, keeping the model and the time', async () => {
    const { options, describe } = optionsOf();
    const out = await collect(wrapStream(scripted([started, providerError]), options));
    expect(describe).toHaveBeenCalledExactlyOnceWith({ code: '401', message: providerError.message });
    expect(out[1]).toEqual({
      type: 'RUN_ERROR',
      model: 'claude-sonnet-5-5',
      timestamp: 1_700_000_000_000,
      message: 'STAFF(401)',
      code: '401',
      error: { message: 'STAFF(401)', code: '401' },
    });
    expect(out[1]).not.toHaveProperty('rawEvent');
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });

  // TanStack AI 0.68 sends an event's fields that are not in the AG-UI spec inside `metadata.tanstack`, and keeps `rawEvent` and `metadata`
  // as they are. So a field that is not on the short list below could carry the provider's own text to the page.
  it('keeps only the fields it knows are safe, so nothing else the provider put on the error reaches the page', async () => {
    const withExtras: Chunk = {
      ...providerError,
      threadId: 't1',
      runId: 'r1',
      retryAfterMs: 30_000,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      metadata: { tanstack: { detail: 'SECRET-metadata' } },
      error: { message: 'x', code: '401', type: 'authentication_error', request_id: 'SECRET-request' },
    };
    const { options } = optionsOf();
    const out = await collect(wrapStream(scripted([started, withExtras]), options));
    expect(out[1]).toEqual({
      type: 'RUN_ERROR',
      model: 'claude-sonnet-5-5',
      timestamp: 1_700_000_000_000,
      threadId: 't1',
      runId: 'r1',
      message: 'STAFF(401)',
      code: '401',
      error: { message: 'STAFF(401)', code: '401' },
    });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });

  it('does not change the chunk the source gave', async () => {
    const { options } = optionsOf();
    await collect(wrapStream(scripted([providerError]), options));
    expect(providerError.message).toContain('invalid x-api-key');
    expect(providerError.rawEvent).toBeDefined();
  });

  it('hands the original code and message to onSourceError once, before anything is rewritten', async () => {
    const { options, onSourceError } = optionsOf();
    await collect(wrapStream(scripted([providerError, { ...providerError, code: '529', message: 'overloaded' }]), options));
    expect(onSourceError).toHaveBeenCalledExactlyOnceWith({ code: '401', message: providerError.message });
  });

  it('reads the code and message from error when the top level has none', async () => {
    const { options, onSourceError } = optionsOf();
    const out = await collect(wrapStream(scripted([{ type: 'RUN_ERROR', error: { message: 'busy', code: '429' } }]), options));
    expect(onSourceError).toHaveBeenCalledWith({ code: '429', message: 'busy' });
    expect(out[0]).toMatchObject({ message: 'STAFF(429)', code: '429', error: { message: 'STAFF(429)', code: '429' } });
  });

  it('gives a missing code to describe as it is, and the staff code it answers', async () => {
    const { options, describe } = optionsOf();
    const out = await collect(wrapStream(scripted([{ type: 'RUN_ERROR', message: 'Unknown error occurred' }]), options));
    expect(describe).toHaveBeenCalledWith({ code: undefined, message: 'Unknown error occurred' });
    expect(out[0]).toMatchObject({ message: 'STAFF(error)', code: 'error' });
  });

  it('turns an error the source throws into a staff RUN_ERROR, and never lets the provider text through', async () => {
    async function* source(): AsyncGenerator<Chunk> {
      yield started;
      throw Object.assign(new Error('529 overloaded sk-ant-api03-SECRET'), { status: 529 });
    }
    const { options, onSourceError } = optionsOf();
    const out = await collect(wrapStream(source(), options));
    expect(onSourceError).toHaveBeenCalledExactlyOnceWith({ code: '529', message: '529 overloaded sk-ant-api03-SECRET' });
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ type: 'RUN_ERROR', message: 'STAFF(529)', code: '529', error: { message: 'STAFF(529)', code: '529' } });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });

  it('sends neither custom event after a RUN_ERROR', async () => {
    const { options } = optionsOf();
    const afterToolTurn = await collect(wrapStream(scripted([toolStart('list_requests'), finished('tool_calls'), providerError]), options));
    expect(customNames(afterToolTurn)).toEqual([]);
    const emptyStop = await collect(wrapStream(scripted([providerError, finished('stop')]), options));
    expect(customNames(emptyStop)).toEqual([]);
  });
});

describe('wrapStream, exactly one RUN_ERROR', () => {
  const sourceError: Chunk = { type: 'RUN_ERROR', model: 'claude-sonnet-5-5', message: 'busy', code: '529' };
  const errorsIn = (chunks: Chunk[]) => chunks.filter((chunk) => chunk.type === 'RUN_ERROR');

  it('sends nothing after the first RUN_ERROR when the source goes on with a RUN_FINISHED, and stops chat()', async () => {
    const { options, chatController } = optionsOf();
    const out = await collect(wrapStream(scripted([started, sourceError, finished('stop')]), options));
    expect(out.map((chunk) => chunk.type)).toEqual(['RUN_STARTED', 'RUN_ERROR']);
    expect(chatController.signal.aborted).toBe(true);
  });

  it('sends no timeout error after a source error, even when the source then hangs past the deadline', async () => {
    async function* hungAfterError(): AsyncGenerator<Chunk> {
      yield sourceError;
      await new Promise(() => {});
    }
    const { options } = optionsOf({ deadlineMs: 40 });
    const out = await collect(wrapStream(hungAfterError(), options));
    expect(errorsIn(out)).toHaveLength(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: '529' });
    await sleep(80);
    expect(out).toHaveLength(1);
  });

  it('sends no second error when the source throws after a source error', async () => {
    async function* throwsAfterError(): AsyncGenerator<Chunk> {
      yield sourceError;
      throw new Error('late failure sk-ant-api03-SECRET');
    }
    const { options, onSourceError } = optionsOf();
    const out = await collect(wrapStream(throwsAfterError(), options));
    expect(out).toHaveLength(1);
    expect(errorsIn(out)).toHaveLength(1);
    expect(onSourceError).toHaveBeenCalledTimes(1);
  });

  it('does not pull the source again after a RUN_ERROR', async () => {
    let pulls = 0;
    async function* counted(): AsyncGenerator<Chunk> {
      pulls += 1;
      yield sourceError;
      pulls += 1;
      yield finished('stop');
    }
    const { options } = optionsOf();
    await collect(wrapStream(counted(), options));
    expect(pulls).toBe(1);
  });

  it('sends only the safe code, whatever describe answers', async () => {
    const { options } = optionsOf({ describe: () => ({ code: 'sk-ant-SECRET-code', message: 'STAFF' }) });
    const out = await collect(wrapStream(scripted([sourceError]), options));
    expect(out[0]).toMatchObject({ code: 'error', error: { code: 'error' } });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });
});

describe('wrapStream, the deadline', () => {
  it('ends a source that never yields with one timeout RUN_ERROR, then stops chat(), and is not held up by the source', async () => {
    async function* hung(): AsyncGenerator<Chunk> {
      yield started;
      await new Promise(() => {});
    }
    const { options, chatController, describe } = optionsOf({ deadlineMs: 40 });
    const before = Date.now();
    const out = await collect(wrapStream(hung(), options));
    expect(Date.now() - before).toBeLessThan(1_000);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ type: 'RUN_ERROR', code: 'timeout', message: 'STAFF(timeout)', error: { message: 'STAFF(timeout)', code: 'timeout' } });
    expect(describe).toHaveBeenCalledWith(expect.objectContaining({ code: 'timeout' }));
    expect(chatController.signal.aborted).toBe(true);
  });

  it('measures the deadline from the first pull for the whole request, so a stream that keeps going still ends', async () => {
    async function* steady(): AsyncGenerator<Chunk> {
      for (let index = 0; ; index += 1) {
        await sleep(20);
        yield text(`chunk ${index} `);
      }
    }
    const { options } = optionsOf({ deadlineMs: 110 });
    const out = await collect(wrapStream(steady(), options));
    expect(out.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'timeout' });
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThan(8);
  });

  it('does not stop chat() or send an error for a run that ends before the deadline', async () => {
    const { options, chatController } = optionsOf({ deadlineMs: 200 });
    const out = await collect(wrapStream(scripted([text('Done.'), finished('stop')]), options));
    expect(out.some((chunk) => chunk.type === 'RUN_ERROR')).toBe(false);
    expect(chatController.signal.aborted).toBe(false);
  });

  it('sends neither custom event after the timeout error', async () => {
    async function* hung(): AsyncGenerator<Chunk> {
      yield toolStart('list_requests');
      yield finished('tool_calls');
      await new Promise(() => {});
    }
    const out = await collect(wrapStream(hung(), optionsOf({ deadlineMs: 30 }).options));
    expect(customNames(out)).toEqual([]);
  });

  it('leaves no timer running when the run ends', async () => {
    vi.useFakeTimers();
    try {
      const { options } = optionsOf({ deadlineMs: 90_000 });
      const stream = collect(wrapStream(scripted([text('Done.'), finished('stop')]), options));
      await vi.advanceTimersByTimeAsync(0);
      await stream;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('wrapStream, six turns used', () => {
  it('sends max_turns last when the last RUN_FINISHED is tool_calls and nothing is waiting for the browser', async () => {
    const { options } = optionsOf();
    const out = await collect(wrapStream(scripted([started, toolStart('list_requests'), finished('tool_calls', { outcome: { type: 'success' } })]), options));
    expect(out.at(-1)).toEqual({ type: 'CUSTOM', name: 'max_turns', value: {}, timestamp: expect.any(Number) });
    expect(customNames(out)).toEqual(['max_turns']);
  });

  it('reads the finish reason from the metadata TanStack puts it in, as ai-client does', async () => {
    const { options } = optionsOf();
    const last: Chunk = { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', metadata: { tanstack: { finishReason: 'tool_calls' } } };
    expect(customNames(await collect(wrapStream(scripted([toolStart('list_requests'), last]), options)))).toEqual(['max_turns']);
  });

  it('sends none for a client-tool interrupt: the browser has the draft to run', async () => {
    const { options } = optionsOf();
    const interrupted = finished('tool_calls', { outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'tool_call' }] } });
    expect(customNames(await collect(wrapStream(scripted([toolStart('draft_reply'), interrupted]), options)))).toEqual([]);
  });

  it('sends none when the last RUN_FINISHED is stop, even after earlier tool_calls turns', async () => {
    const { options } = optionsOf();
    const out = await collect(wrapStream(scripted([toolStart('list_requests'), finished('tool_calls'), text('Two requests are waiting.'), finished('stop')]), options));
    expect(customNames(out)).toEqual([]);
  });

  it('sends none when the source ended with no RUN_FINISHED at all', async () => {
    expect(customNames(await collect(wrapStream(scripted([started, text('Part')]), optionsOf().options)))).toEqual([]);
  });
});

describe('wrapStream, a declined answer', () => {
  it('sends declined right after a stop that had no text and no tool call', async () => {
    const { options } = optionsOf();
    const out = await collect(wrapStream(scripted([started, finished('stop'), { type: 'RUN_CLOSED' }]), options));
    expect(out.map((chunk) => chunk.type)).toEqual(['RUN_STARTED', 'RUN_FINISHED', 'CUSTOM', 'RUN_CLOSED']);
    expect(out[2]).toEqual({ type: 'CUSTOM', name: 'declined', value: {}, timestamp: expect.any(Number) });
  });

  it('treats blank text as no text', async () => {
    const { options } = optionsOf();
    expect(customNames(await collect(wrapStream(scripted([text(''), text('  \n'), finished('stop')]), options)))).toEqual(['declined']);
  });

  it('sends none when the turn had text before its RUN_FINISHED', async () => {
    expect(customNames(await collect(wrapStream(scripted([text('I looked.'), finished('stop')]), optionsOf().options)))).toEqual([]);
  });

  it('sends none when the turn called a tool', async () => {
    expect(customNames(await collect(wrapStream(scripted([toolStart('list_requests'), finished('stop')]), optionsOf().options)))).toEqual([]);
  });

  it('looks at each turn on its own: text in an earlier turn does not save an empty last one', async () => {
    const { options } = optionsOf();
    const out = await collect(wrapStream(scripted([text('Let me check.'), toolStart('list_requests'), finished('tool_calls'), finished('stop')]), options));
    expect(customNames(out)).toEqual(['declined']);
    const answered = await collect(wrapStream(scripted([toolStart('list_requests'), finished('tool_calls'), text('Done.'), finished('stop')]), options));
    expect(customNames(answered)).toEqual([]);
  });

  it.each(['length', 'content_filter', 'tool_calls', null])('sends none for a turn that finished with %s', async (reason) => {
    expect(customNames(await collect(wrapStream(scripted([finished(reason, { outcome: { type: 'interrupt' } })]), optionsOf().options)))).toEqual([]);
  });

  it('reads the finish reason from the metadata too', async () => {
    const { options } = optionsOf();
    const out = await collect(wrapStream(scripted([{ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', metadata: { tanstack: { finishReason: 'stop' } } }]), options));
    expect(customNames(out)).toEqual(['declined']);
  });
});

describe('wrapStream, aborts', () => {
  it('stops chat() at once when the response is already aborted', async () => {
    const { options, chatController, responseController } = optionsOf();
    responseController.abort();
    const stream = wrapStream(scripted([text('Hi'), finished('stop')]), options);
    await stream.next();
    expect(chatController.signal.aborted).toBe(true);
  });

  it('stops chat() at once when the response aborts mid-run, and ends even when the source ignores it', async () => {
    async function* hung(): AsyncGenerator<Chunk> {
      yield text('Part');
      await new Promise(() => {});
    }
    const { options, chatController, responseController, onDone } = optionsOf();
    const stream = wrapStream(hung(), options);
    await stream.next();
    const rest = collect(stream);
    await sleep(5);
    responseController.abort();
    expect(chatController.signal.aborted).toBe(true);
    expect(await rest).toEqual([]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("stops pulling, removes its listener and still calls onDone once when the consumer stops reading", async () => {
    let closed = false;
    async function* source(): AsyncGenerator<Chunk> {
      try {
        yield toolStart('list_requests');
        yield text('More');
      } finally {
        closed = true;
      }
    }
    const { options, chatController, responseController, onDone } = optionsOf();
    const stream = wrapStream(source(), options);
    await stream.next();
    await stream.return(undefined);
    await sleep(5);
    expect(onDone).toHaveBeenCalledExactlyOnceWith({ tools: ['list_requests'], ms: expect.any(Number) });
    expect(closed).toBe(true);
    responseController.abort();
    expect(chatController.signal.aborted, 'the listener is gone').toBe(false);
  });
});

describe('wrapStream, onDone', () => {
  it('gives the tools called, in order and with repeats, and the time taken, once, when the run ends', async () => {
    const { options, onDone } = optionsOf();
    await collect(wrapStream(scripted([toolStart('list_inquiries', 'a'), toolStart('list_inquiries', 'b'), toolStart('list_requests', 'c'), finished('stop')]), options));
    expect(onDone).toHaveBeenCalledExactlyOnceWith({ tools: ['list_inquiries', 'list_inquiries', 'list_requests'], ms: expect.any(Number) });
    expect(onDone.mock.calls[0][0].ms).toBeGreaterThanOrEqual(0);
  });

  it('reads the tool name from toolName when toolCallName is missing', async () => {
    const { options, onDone } = optionsOf();
    await collect(wrapStream(scripted([{ type: 'TOOL_CALL_START', toolCallId: 'a', toolName: 'inquiry_counts' }, finished('stop')]), options));
    expect(onDone).toHaveBeenCalledWith({ tools: ['inquiry_counts'], ms: expect.any(Number) });
  });

  it('is called once after an error, after the timeout, and for a source that throws', async () => {
    const error = optionsOf();
    await collect(wrapStream(scripted([{ type: 'RUN_ERROR', code: '429', message: 'busy' }]), error.options));
    expect(error.onDone).toHaveBeenCalledOnce();

    async function* hung(): AsyncGenerator<Chunk> {
      await new Promise(() => {});
    }
    const timeout = optionsOf({ deadlineMs: 20 });
    await collect(wrapStream(hung(), timeout.options));
    expect(timeout.onDone).toHaveBeenCalledOnce();

    async function* throws(): AsyncGenerator<Chunk> {
      throw new Error('boom');
    }
    const thrown = optionsOf();
    await collect(wrapStream(throws(), thrown.options));
    expect(thrown.onDone).toHaveBeenCalledOnce();
  });

  it('never breaks the stream when onDone or onSourceError throws', async () => {
    const { options } = optionsOf({
      onDone: () => {
        throw new Error('the log failed');
      },
      onSourceError: () => {
        throw new Error('the log failed');
      },
    });
    const out = await collect(wrapStream(scripted([{ type: 'RUN_ERROR', code: '429', message: 'busy' }]), options));
    expect(out[0]).toMatchObject({ type: 'RUN_ERROR', message: 'STAFF(429)' });
  });
});
