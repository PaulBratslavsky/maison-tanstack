import { ChatClient, fetchServerSentEvents, type UIMessage } from '@tanstack/ai-client';
import { describe, expect, it, vi } from 'vitest';
import { CUSTOM_EVENT, customEventNote, errorNotice, toolBoxOf, toolLineOf, toolResultOf, withoutOpenToolCalls, type PartLike } from '../../admin/src/assistant';
import assistantService, { type AdapterFor } from '../../server/src/services/assistant';
import { fakeStrapi } from './fake-strapi';
import { errorTurn, fakeTextAdapter, textTurn, toolCallTurn, type ScriptedTurn } from './fake-text-adapter';

/**
 * The page and the server on the real code of both, and nothing between them but a function in place of `fetch`. The page is TanStack AI's
 * `ChatClient` (ai-client 0.39.2, which `useChat` in ai-react 0.30.3 drives) reading with `fetchServerSentEvents`. The server is the assistant's
 * service on the real `chat()` (@tanstack/ai 0.68.0) with a fake model. Nothing reaches Anthropic.
 *
 * They hold what the drawer relies on: the request body the client writes is one the server accepts, the tool calls and results the server streams come
 * out as the parts the drawer reads, the staff texts and codes of an error reach `onError`, and the two custom events reach `onCustomEvent`.
 */

type Doc = Record<string, any>;

const NOW = new Date('2026-10-05T16:30:00.000Z');
const everything = { can: () => true };
const REQUEST = {
  reference: 'APT-1001',
  status: 'requested',
  customer: 'line:U4af...88',
  boutique: { slug: 'ginza', name: 'Ginza Flagship' },
  requestedFor: '2026-10-10T14:00:00+09:00',
  products: [{ slug: 'weekender-50', name: 'Weekender 50' }],
  note: '',
  createdVia: 'concierge',
  confirmationSent: true,
  demoCustomer: false,
  createdAt: '2026-10-05T16:30:00.000Z',
};

/** A page whose fetch is answered by the real service, which plays `turns`. It keeps what the page sent and what the server asked of the model. */
const world = (turns: ScriptedTurn[]) => {
  const fake = fakeTextAdapter(turns);
  const listRequests = vi.fn(async () => ({ ok: true as const, value: [REQUEST] }));
  const strapi = fakeStrapi({ services: { appointments: { listRequests } }, config: { aiApiKey: 'sk-ant-api03-TEST-KEY-123' } });
  const service = assistantService({ strapi });
  const adapterFor = vi.fn<AdapterFor>(() => fake.adapter);
  const bodies: Doc[] = [];
  const fetchClient = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const params = await service.parseBody(body);
    return service.turn(params, { ability: everything, adminId: 7, responseController: new AbortController(), adapterFor, now: NOW });
  };
  const errors: Error[] = [];
  const notes: string[] = [];
  const client = new ChatClient({
    connection: fetchServerSentEvents('http://strapi.test/maison/assistant/chat', { fetchClient: fetchClient as typeof globalThis.fetch }),
    queue: 'drop',
    onError: (error) => errors.push(error),
    onCustomEvent: (name) => {
      const note = customEventNote(name);
      if (note) notes.push(note);
    },
  });
  return { client, errors, notes, bodies, requests: fake.requests, listRequests };
};

const partsOf = (messages: readonly UIMessage[]): PartLike[] => messages.flatMap((message) => message.parts as unknown as PartLike[]);

describe('the page and the server, on the real code of both', () => {
  it('sends a body the server accepts, and shows its text answer as one assistant message', async () => {
    const { client, errors, bodies } = world([textTurn('None wait.')]);
    await client.sendMessage('Which visits are waiting?');

    expect(errors).toEqual([]);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ messages: [{ role: 'user', content: 'Which visits are waiting?' }] });
    expect(typeof bodies[0].threadId).toBe('string');
    expect(typeof bodies[0].runId).toBe('string');
    expect(client.getMessages().map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(partsOf(client.getMessages()).filter((part) => part.type === 'text').map((part) => part.content)).toEqual(['Which visits are waiting?', 'None wait.']);
  });

  it('shows a tool call as the part the drawer reads: its output, a finished state, a result part, a line and a box', async () => {
    const { client, errors, listRequests } = world([toolCallTurn('list_requests', { status: 'requested' }, 'call-1'), textTurn('One visit waits.')]);
    await client.sendMessage('Which visits are waiting?');

    expect(errors).toEqual([]);
    expect(listRequests).toHaveBeenCalledOnce();
    const parts = partsOf(client.getMessages());
    const call = parts.find((part) => part.type === 'tool-call')!;
    expect(call).toMatchObject({ id: 'call-1', name: 'list_requests', state: 'complete' });
    expect(call.output).toMatchObject({ requests: [expect.objectContaining({ reference: 'APT-1001' })], capped: false });
    const result = toolResultOf(parts, 'call-1');
    expect(result).toBeDefined();
    expect(toolLineOf(call, result)).toEqual({ text: 'Maison · requests ✓ 1 result', tone: 'ok' });
    expect(toolBoxOf(call, result)).toMatchObject({ name: 'list_requests', state: 'done', status: '1 result' });
    // A finished call stays when the chat is cleaned.
    expect(withoutOpenToolCalls(client.getMessages())).toBe(client.getMessages());
  });

  it('sends the whole chat again with the next question, tool call and result included', async () => {
    const { client, errors, bodies, requests } = world([toolCallTurn('list_requests', {}, 'call-1'), textTurn('One visit waits.'), textTurn('Nothing else.')]);
    await client.sendMessage('Which visits are waiting?');
    await client.sendMessage('Anything else?');

    expect(errors).toEqual([]);
    expect(bodies).toHaveLength(2);
    // The AG-UI wire of ai-client 0.39.2 puts all the text of one assistant message and all its tool calls on one assistant entry, then each tool
    // result: the answer that came after the call is written ahead of it. Anthropic accepts it. The tool pair stays whole, which is what matters.
    const wire = bodies[1].messages as Doc[];
    expect(wire.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(wire[1]).toMatchObject({ content: 'One visit waits.', toolCalls: [expect.objectContaining({ id: 'call-1' })] });
    // The third model call has the earlier tool pair, and the new question last.
    const sent = requests[2].messages as Doc[];
    expect(sent.find((message) => message.role === 'tool')).toMatchObject({ toolCallId: 'call-1' });
    expect(sent.at(-1)).toMatchObject({ role: 'user', content: 'Anything else?' });
  });

  it('reports a provider error as the staff text with its code, and leaves an empty assistant message that the drawer takes back', async () => {
    const { client, errors } = world([errorTurn('529', 'overloaded_error: SECRET provider text')]);
    await client.sendMessage('Which visits are waiting?');

    expect(errors).toHaveLength(1);
    expect(errorNotice(errors[0])).toEqual({ text: 'Anthropic is busy. Try again in a minute.', newChat: false, code: '529' });
    expect(JSON.stringify(errors[0].message)).not.toContain('SECRET');
    expect(client.getMessages().map((message) => [message.role, message.parts.length])).toEqual([
      ['user', 1],
      ['assistant', 0],
    ]);
  });

  it('reports a chat that Anthropic refuses to continue as a notice that offers a new chat', async () => {
    const { client, errors } = world([errorTurn('400', 'messages.1.content.0: Invalid `signature` in `thinking` block')]);
    await client.sendMessage('Which visits are waiting?');

    expect(errors).toHaveLength(1);
    expect(errorNotice(errors[0])).toMatchObject({ newChat: true, code: 'history_rejected' });
    expect(errors[0].message).not.toContain('signature');
  });

  it('tells the page the assistant stopped after 6 steps', async () => {
    const turns = Array.from({ length: 6 }, (_, index) => toolCallTurn('list_requests', {}, `call-${index}`));
    const { client, errors, notes, requests } = world(turns);
    await client.sendMessage('Which visits are waiting?');

    expect(errors).toEqual([]);
    expect(requests).toHaveLength(6);
    expect(notes).toEqual([customEventNote(CUSTOM_EVENT.maxTurns)]);
    expect(notes[0]).toBe('The assistant stopped after 6 steps. Ask a narrower question.');
  });

  it('tells the page the model declined, when it answered with nothing', async () => {
    const { client, errors, notes } = world([[{ type: 'RUN_STARTED' }, { type: 'RUN_FINISHED', finishReason: 'stop' }]]);
    await client.sendMessage('Which visits are waiting?');

    expect(errors).toEqual([]);
    expect(notes).toEqual([customEventNote(CUSTOM_EVENT.declined)]);
  });
});
