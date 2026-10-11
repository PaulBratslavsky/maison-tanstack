import { ChatClient, fetchServerSentEvents, type UIMessage } from '@tanstack/ai-client';
import { describe, expect, it } from 'vitest';
import { drawableParts, errorNotice, withoutFailedTurn, withoutOpenToolCalls, type PartLike } from '../../admin/src/assistant';

/**
 * The rules of the Ask tab are tested on hand-made messages and errors in assistant-admin.test.ts. These tests run the same rules on
 * what the installed TanStack AI (ai-client 0.39.2) really produces: the messages a real ChatClient leaves after Stop and after a
 * failed request, and the errors a real connection adapter throws. They are why the rules are built the way they are.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until a condition holds, or fail with the message. */
const until = async (condition: () => boolean, message: string, limit = 3000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error(`Gave up waiting: ${message}`);
    await sleep(5);
  }
};

const event = (type: string, extra: Record<string, unknown> = {}) => ({ type, timestamp: Date.now(), threadId: 't', runId: 'r', ...extra });

const partsOf = (messages: readonly UIMessage[]): PartLike[] => messages.flatMap((message) => message.parts as unknown as PartLike[]);
const openCalls = (messages: readonly UIMessage[]) => partsOf(messages).filter((part) => part.type === 'tool-call' && part.output === undefined);

describe('Stop in the middle of a tool call, with the real ChatClient', () => {
  const ARG_CHUNKS = 40;

  /**
   * A stream that starts a tool call and then writes its arguments in many small chunks, and a client that calls stop() while the
   * third chunk is processed. The connection sends all the chunks at once, so the ones that are not processed yet wait in the
   * client's own queue: they are processed after stop(), as a stream in a browser has some in flight when staff press Stop.
   */
  const stoppedClient = () => {
    let processed = 0;
    let client: ChatClient;
    const connection = {
      async *connect() {
        yield event('RUN_STARTED');
        yield event('TEXT_MESSAGE_START', { messageId: 'm1', role: 'assistant' });
        yield event('TEXT_MESSAGE_CONTENT', { messageId: 'm1', delta: 'Looking. ' });
        yield event('TEXT_MESSAGE_END', { messageId: 'm1' });
        yield event('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'list_requests', parentMessageId: 'm1' });
        for (let index = 0; index < ARG_CHUNKS; index += 1) yield event('TOOL_CALL_ARGS', { toolCallId: 'c1', delta: 'x' });
      },
    };
    const errors: Error[] = [];
    client = new ChatClient({
      connection,
      onError: (error) => errors.push(error),
      onChunk: (chunk) => {
        processed += 1;
        // RUN_STARTED, the 3 text events, TOOL_CALL_START and 3 argument chunks have been processed.
        if (processed === 8) client.stop();
      },
    });
    return { client, errors };
  };

  it('leaves a call with no output and no result, which the chat would show as "…" for ever and the next send would replay', async () => {
    const { client, errors } = stoppedClient();
    await client.sendMessage('Which visits are waiting?');

    const calls = openCalls(client.getMessages());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'list_requests', state: 'input-streaming' });
    // Stop is no error.
    expect(errors).toEqual([]);

    const cleaned = withoutOpenToolCalls(client.getMessages());
    expect(openCalls(cleaned)).toEqual([]);
    expect(cleaned.map((message) => message.role)).toEqual(['user', 'assistant']);
    // The text before the call stays, so the answer stops where it was.
    expect(drawableParts(cleaned[1].parts as unknown as PartLike[]).map((part) => part.content)).toEqual(['Looking. ']);
  });

  // ai-client 0.29.2 processed the chunks that were already queued after sendMessage had settled, so a call that was cleaned could come back a
  // moment later. 0.39.2 processes them before sendMessage settles. The provider still cleans whenever the chat is idle, which holds for both.
  it('has processed the chunks that were already queued by the time the send settles, and a cleaned call stays out afterwards', async () => {
    const { client } = stoppedClient();
    await client.sendMessage('Which visits are waiting?');
    // The rest of the chunks that were in flight when stop() was called are in already: the arguments are whole.
    expect(openCalls(client.getMessages())[0]?.arguments).toBe('x'.repeat(ARG_CHUNKS));
    // The chat is idle: nothing is answering, and the call is open.
    expect(client.getIsLoading()).toBe(false);

    client.setMessagesManually(withoutOpenToolCalls(client.getMessages()));
    expect(openCalls(client.getMessages())).toEqual([]);
    await sleep(100);
    expect(openCalls(client.getMessages())).toEqual([]);
    expect(openCalls(withoutOpenToolCalls(client.getMessages()))).toEqual([]);
  });

  it('keeps a call that finished before Stop, and its result', async () => {
    let client: ChatClient;
    const connection = {
      async *connect() {
        yield event('RUN_STARTED');
        yield event('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'list_requests' });
        yield event('TOOL_CALL_ARGS', { toolCallId: 'c1', delta: '{}' });
        yield event('TOOL_CALL_END', { toolCallId: 'c1', toolCallName: 'list_requests', input: {} });
        yield event('TOOL_CALL_RESULT', { toolCallId: 'c1', messageId: 'r1', content: '{"requests":[{"reference":"APT-4821"}]}' });
        yield event('TOOL_CALL_START', { toolCallId: 'c2', toolCallName: 'list_questions' });
        yield event('TOOL_CALL_ARGS', { toolCallId: 'c2', delta: '{"sta' });
      },
    };
    let processed = 0;
    client = new ChatClient({
      connection,
      onChunk: () => {
        processed += 1;
        if (processed === 7) client.stop();
      },
    });
    await client.sendMessage('Which visits are waiting?');

    const cleaned = withoutOpenToolCalls(client.getMessages());
    const calls = partsOf(cleaned).filter((part) => part.type === 'tool-call');
    expect(calls.map((part) => part.id)).toEqual(['c1']);
    expect(calls[0].output).toEqual({ requests: [{ reference: 'APT-4821' }] });
    expect(partsOf(cleaned).some((part) => part.type === 'tool-result' && part.toolCallId === 'c1')).toBe(true);
  });
});

describe('a failed request, with the real connection adapter', () => {
  const noteErrors = (fetchClient: typeof globalThis.fetch) => {
    const errors: Error[] = [];
    const client = new ChatClient({ connection: fetchServerSentEvents('http://strapi.test/maison/assistant/chat', { fetchClient }), onError: (error) => errors.push(error) });
    return { client, errors };
  };

  it('says the connection was lost when the fetch is rejected, and takes the failed question back', async () => {
    const { client, errors } = noteErrors(async () => {
      throw new TypeError('Failed to fetch');
    });
    await client.sendMessage('Which visits are waiting?');

    expect(errors).toHaveLength(1);
    // The shape the review found: ai-client wraps the browser's error, and its own message is no help.
    expect(errors[0].name).toBe('StreamReadError');
    expect(errors[0].message).toBe('Stream response body read failed');
    expect(errorNotice(errors[0])).toEqual({ text: 'The connection to Strapi was lost. Try again.', newChat: false });

    // A failed run leaves an empty assistant message after the question, which the chat would draw as an empty box.
    expect(client.getMessages().map((message) => [message.role, message.parts.length])).toEqual([
      ['user', 1],
      ['assistant', 0],
    ]);
    expect(withoutFailedTurn(client.getMessages())).toEqual([]);
  });

  it('says the connection was lost when the body fails while it is read', async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.error(new TypeError('network error'));
      },
    });
    const { client, errors } = noteErrors(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    await client.sendMessage('Which visits are waiting?');

    expect(errors).toHaveLength(1);
    expect(errorNotice(errors[0])).toEqual({ text: 'The connection to Strapi was lost. Try again.', newChat: false });
    expect(withoutFailedTurn(client.getMessages())).toEqual([]);
  });

  it('tells staff the session has ended for a 401, which is what Strapi answers when the token has expired', async () => {
    const { client, errors } = noteErrors(async () => new Response('', { status: 401, statusText: 'Unauthorized' }));
    await client.sendMessage('Which visits are waiting?');

    expect(errors).toHaveLength(1);
    expect(errorNotice(errors[0])).toEqual({ text: 'Your Strapi session has ended. Reload the page to sign in again.', newChat: false });
  });

  it('keeps an answer that began: only a failed turn with nothing to read is taken back', async () => {
    const connection = {
      async *connect() {
        yield event('RUN_STARTED');
        yield event('TEXT_MESSAGE_START', { messageId: 'm1', role: 'assistant' });
        yield event('TEXT_MESSAGE_CONTENT', { messageId: 'm1', delta: 'The first visit is' });
        yield event('RUN_ERROR', { message: 'Anthropic is busy. Try again in a minute.', code: '529' });
      },
    };
    const errors: Error[] = [];
    const client = new ChatClient({ connection, onError: (error) => errors.push(error) });
    await client.sendMessage('Which visits are waiting?');

    expect(errorNotice(errors[0])).toEqual({ text: 'Anthropic is busy. Try again in a minute.', newChat: false, code: '529' });
    const messages = client.getMessages();
    expect(withoutFailedTurn(messages)).toBe(messages);
  });
});
