import { vi, type Mock } from 'vitest';

/**
 * The server, as the assistant's page meets it, for the tests of the drawer's mount: Strapi's fetch client, which answers the status and holds
 * the admin's saved chats, and `fetch`, which answers each chat request with the next stream scripted for it. Nothing reaches a server or a model.
 *
 * Each test file makes the stand-in for the fetch client with `vi.hoisted` and mocks `@strapi/strapi/admin` with it, since a mock must be
 * declared in the file that is tested, and passes it to `assistantWorld`.
 */
export interface FakeFetchClient {
  get: Mock;
  post: Mock;
  put: Mock;
  del: Mock;
}

export const TOOLS = [
  { name: 'list_requests', label: 'Visit requests' },
  { name: 'inquiry_counts', label: 'Inquiry counts' },
];
export const READY = { ready: true, model: 'claude-sonnet-5-5', tools: TOOLS };
export const NOT_SET_UP = { ready: false, reason: 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.' };

const encoder = new TextEncoder();
export const event = (type: string, extra: Record<string, unknown> = {}) => ({ type, timestamp: Date.now(), threadId: 't', runId: 'r', ...extra });

/** A server-sent event stream of AG-UI events, as the server's chat route answers one. It ends after the last event. */
export const stream = (events: Array<Record<string, unknown>>) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const item of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );

/** An answer in one text message. Each has a message ID of its own: a message with an ID the chat already has is added to that message. */
let answers = 0;
export const answer = (text: string) => {
  answers += 1;
  const messageId = `answer-${answers}`;
  return [
    event('RUN_STARTED'),
    event('TEXT_MESSAGE_START', { messageId, role: 'assistant' }),
    event('TEXT_MESSAGE_CONTENT', { messageId, delta: text }),
    event('TEXT_MESSAGE_END', { messageId }),
    event('RUN_FINISHED', { finishReason: 'stop' }),
  ];
};

/** A chat as the server holds it: its row, and its messages. */
export interface SavedChat {
  documentId: string;
  title: string;
  updatedAt: string;
  messages: unknown[];
}
const staffSays = (id: string, content: string) => ({ id, role: 'user', parts: [{ type: 'text', content }] });
const assistantSays = (id: string, content: string) => ({ id, role: 'assistant', parts: [{ type: 'text', content }] });
export const savedChat = (documentId: string, title: string, messages: unknown[] = [staffSays(`${documentId}-u`, title), assistantSays(`${documentId}-a`, `The answer to ${title}`)], updatedAt = '2026-10-06T00:00:00.000Z'): SavedChat => ({
  documentId,
  title,
  updatedAt,
  messages,
});

/** The 404 Strapi's fetch client throws for a chat that is not there. */
const notFound = () => Object.assign(new Error('There is no saved chat with that ID.'), { status: 404 });

export interface WorldOptions {
  /** What `GET /maison/assistant/status` answers, or an error it throws. */
  status?: unknown;
  /** One entry for each chat request the page is going to make: what `fetch` answers. */
  chat?: Array<() => Response | Promise<Response>>;
  /** The admin's saved chats, newest first, as the server lists them. */
  saved?: SavedChat[];
}

/** Wires the fetch client and `fetch`. The test that calls it must `vi.unstubAllGlobals()` afterwards. `rows` is what is saved. */
export const assistantWorld = (client: FakeFetchClient, { status = READY, chat = [], saved = [] }: WorldOptions = {}) => {
  const rows: SavedChat[] = [...saved];
  let created = 0;
  let clock = Date.parse('2026-10-07T00:00:00.000Z');
  const row = ({ messages: _messages, ...summary }: SavedChat) => summary;
  const idOf = (url: string) => decodeURIComponent(url.split('/').at(-1) as string);

  for (const method of [client.get, client.post, client.put, client.del]) method.mockReset();
  client.get.mockImplementation(async (url: string) => {
    if (url === '/maison/assistant/status') {
      if (status instanceof Error) throw status;
      return { data: status };
    }
    if (url === '/maison/conversations') return { data: { conversations: rows.map(row) } };
    if (url.startsWith('/maison/conversations/')) {
      const found = rows.find((chatRow) => chatRow.documentId === idOf(url));
      if (!found) throw notFound();
      return { data: { conversation: found } };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
  client.post.mockImplementation(async (url: string, body: { title: string; messages: unknown[] }) => {
    if (url !== '/maison/conversations') throw new Error(`Unexpected POST ${url}`);
    created += 1;
    clock += 1000;
    const made = { documentId: `saved-${created}`, title: body.title, messages: body.messages, updatedAt: new Date(clock).toISOString() };
    rows.unshift(made);
    return { data: { conversation: row(made) } };
  });
  client.put.mockImplementation(async (url: string, body: { title?: string; messages?: unknown[] }) => {
    const index = rows.findIndex((chatRow) => chatRow.documentId === idOf(url));
    if (index < 0) throw notFound();
    clock += 1000;
    const [found] = rows.splice(index, 1);
    const changed = { ...found, ...body, updatedAt: new Date(clock).toISOString() };
    rows.unshift(changed as SavedChat);
    return { data: { conversation: row(changed as SavedChat) } };
  });
  client.del.mockImplementation(async (url: string) => {
    const index = rows.findIndex((chatRow) => chatRow.documentId === idOf(url));
    if (index < 0) throw notFound();
    rows.splice(index, 1);
    return { data: { documentId: idOf(url) } };
  });

  const scripted = [...chat];
  const fetchMock = vi.fn(async () => {
    const next = scripted.shift();
    if (!next) throw new Error('No answer was scripted for this request.');
    return next();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { rows, fetchMock };
};

/** How many times the page asked for `url` with GET. */
export const getsOf = (client: FakeFetchClient, url: string): number => client.get.mock.calls.filter(([called]) => called === url).length;
