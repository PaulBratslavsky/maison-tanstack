// @vitest-environment jsdom
import { darkTheme, lightTheme } from '@strapi/design-system';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTERS } from '../../admin/src/assistant';
import { AssistantProvider, useAssistant } from '../../admin/src/components/assistant/AssistantProvider';
import { ChatDrawer } from '../../admin/src/components/assistant/ChatDrawer';
import { declarationsOf, keyframesCss, mediaDeclarationsOf, mediaQueriesOf } from './css';
import { renderInTheme } from './render';

/*
 * The assistant's drawer as staff meet it: the real provider, with `useChat` and the real connection adapter, over a stand-in for Strapi's
 * fetch client (the status call and the saved chats) and for `fetch` (the chat stream). Nothing here reaches a server or a model. Before the
 * drawer, the same chat was a tab of the Maison page, and these tests moved here with it: what they hold is the chat's behaviour, which is the same.
 */
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@strapi/strapi/admin', () => ({ useFetchClient: () => client }));

const TOOLS = [
  { name: 'list_requests', label: 'Visit requests' },
  { name: 'inquiry_counts', label: 'Inquiry counts' },
];
const READY = { ready: true, model: 'claude-sonnet-5-5', tools: TOOLS };
const NOT_SET_UP = { ready: false, reason: 'The assistant works with Anthropic only. AI_PROVIDER is set to openai.' };

const encoder = new TextEncoder();
const event = (type: string, extra: Record<string, unknown> = {}) => ({ type, timestamp: Date.now(), threadId: 't', runId: 'r', ...extra });
/** A server-sent event stream of AG-UI events, as the server's chat route answers one. It ends after the last event. */
const stream = (events: Array<Record<string, unknown>>) =>
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
const answer = (text: string) => {
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
interface SavedChat {
  documentId: string;
  title: string;
  updatedAt: string;
  messages: unknown[];
}
const staffSays = (id: string, content: string) => ({ id, role: 'user', parts: [{ type: 'text', content }] });
const assistantSays = (id: string, content: string) => ({ id, role: 'assistant', parts: [{ type: 'text', content }] });
const savedChat = (documentId: string, title: string, messages: unknown[] = [staffSays(`${documentId}-u`, title), assistantSays(`${documentId}-a`, `The answer to ${title}`)], updatedAt = '2026-10-06T00:00:00.000Z'): SavedChat => ({
  documentId,
  title,
  updatedAt,
  messages,
});
/** The 404 Strapi's fetch client throws for a chat that is not there. */
const notFound = () => Object.assign(new Error('There is no saved chat with that ID.'), { status: 404 });

/**
 * The drawer as GlobalAssistant draws it. Whether it is open, and its width, belong to its parent, so the parent's part is played here: the width is
 * in state, and `open` is a prop a test changes with `rerender`. The drawer stays in the page while it is closed, and is hidden.
 */
const Drawer = ({ open = true, onClose = () => {} }: { open?: boolean; onClose?: () => void }) => {
  const [expanded, setExpanded] = useState(false);
  return <ChatDrawer open={open} expanded={expanded} onToggleExpanded={() => setExpanded((value) => !value)} onClose={onClose} />;
};

/**
 * The drawer over stand-ins: Strapi's fetch client, which answers the status and holds the admin's saved chats (newest first, as the server
 * lists them), and `fetch`, which answers each chat request with the next stream scripted for it. `server.rows` is what is saved.
 */
const world = ({ status = READY as unknown, chat = [] as Array<() => Response | Promise<Response>>, saved = [] as SavedChat[], mount = true } = {}) => {
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

  const answers = [...chat];
  const fetchMock = vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error('No answer was scripted for this request.');
    return next();
  });
  vi.stubGlobal('fetch', fetchMock);
  /** Puts the drawer, or another tree, inside the provider, which has started: the drawer is open. A test that changes the stand-ins first passes `mount: false` and calls this itself. */
  const show = (ui: ReactElement = <Drawer />) =>
    renderInTheme(
      <AssistantProvider started>
        {ui}
      </AssistantProvider>
    );
  if (mount) show();
  return { fetchMock, rows, show };
};

const box = () => screen.getByRole('textbox', { name: 'Chat message' }) as HTMLTextAreaElement;
const region = () => screen.getByRole('region', { name: 'Chat messages' });
/** Waits until the chat is on the screen and shows `text` in its messages. */
const shows = async (text: string) => within(await screen.findByRole('region', { name: 'Chat messages' })).findByText(text);
/** The body of the request the page sent to the chat route. */
const sentBody = (fetchMock: ReturnType<typeof vi.fn>, index = 0) => JSON.parse((fetchMock.mock.calls[index] as unknown as [string, { body: string }])[1].body);
/** The row of quick questions above the text box, and its buttons. */
const quickQuestions = () => screen.getByRole('group', { name: 'Quick questions' });
const chips = () => within(quickQuestions()).getAllByRole('button') as HTMLButtonElement[];
/** An answer that has begun and does not end until `finish()` is called, so a test can look at the chat while an answer is on its way. */
const heldAnswer = () => {
  let finish: () => void = () => {};
  const respond = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          const send = (events: Array<Record<string, unknown>>) => {
            for (const item of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
          };
          send([event('RUN_STARTED'), event('TEXT_MESSAGE_START', { messageId: 'held', role: 'assistant' }), event('TEXT_MESSAGE_CONTENT', { messageId: 'held', delta: 'Looking into it' })]);
          finish = () => {
            send([event('TEXT_MESSAGE_CONTENT', { messageId: 'held', delta: ' and found two visits.' }), event('TEXT_MESSAGE_END', { messageId: 'held' }), event('RUN_FINISHED', { finishReason: 'stop' })]);
            controller.close();
          };
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
  return { respond, finish: () => finish() };
};

/**
 * A stream that has sent `events` and then stays open. When the request is aborted (Stop, or New chat), the stream fails with an abort error, as
 * a real connection does. Without a signal it stays open for the whole test. `onStart` is called when the stream has sent its events.
 */
const openStream = (events: Array<Record<string, unknown>>, signal?: AbortSignal, onStart?: () => void) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const item of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
        onStart?.();
        signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
/** An answer that has begun with "Looking into it" and does not end. */
const slow = (signal?: AbortSignal, onStart?: () => void) => openStream(answer('Looking into it').slice(0, 3), signal, onStart);
/** An answer whose first text has come and whose tool call is cut in the middle of its arguments. */
const midTool = (signal?: AbortSignal) =>
  openStream(
    [
      event('RUN_STARTED'),
      event('TEXT_MESSAGE_START', { messageId: 'm1', role: 'assistant' }),
      event('TEXT_MESSAGE_CONTENT', { messageId: 'm1', delta: 'Looking. ' }),
      event('TEXT_MESSAGE_END', { messageId: 'm1' }),
      event('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'list_requests', parentMessageId: 'm1' }),
      event('TOOL_CALL_ARGS', { toolCallId: 'c1', delta: '{"sta' }),
    ],
    signal
  );
/** A run that has started and sent nothing else. */
const silent = (signal?: AbortSignal) => openStream([event('RUN_STARTED')], signal);
/** Makes `fetch` answer every chat request with `make(signal)`, so the stream ends when the request is aborted. */
const answerWith = (make: (signal?: AbortSignal) => Response) => vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => make(init?.signal)));
/**
 * Lets the page finish what it does after a stand-in has answered. A test that proves something did NOT happen has no event to wait for, so it
 * waits for a timer that is queued after every promise the page is already working through. Where there is an event to wait for, a test waits for it.
 */
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('before the chat', () => {
  it('shows "Checking the assistant…" with a loader, and no text box, until the status answers', async () => {
    let answerStatus: (value: unknown) => void = () => {};
    client.get.mockReset();
    client.get.mockImplementation(() => new Promise((resolve) => (answerStatus = resolve)));
    renderInTheme(
      <AssistantProvider started>
        <Drawer />
      </AssistantProvider>
    );
    expect(screen.getByText('Checking the assistant…')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    answerStatus({ data: READY });
    expect(await screen.findByRole('textbox', { name: 'Chat message' })).toBeTruthy();
    expect(screen.queryByText('Checking the assistant…')).toBeNull();
  });

  it('shows the reason and Check again, and no text box, when the assistant is not set up', async () => {
    world({ status: NOT_SET_UP });
    expect(await screen.findByRole('heading', { name: "The assistant isn't set up" })).toBeTruthy();
    expect(screen.getByText(NOT_SET_UP.reason)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('asks again when Check again is pressed, and shows the chat once the assistant is ready', async () => {
    world({ status: NOT_SET_UP });
    await screen.findByRole('button', { name: 'Check again' });
    client.get.mockImplementation(async () => ({ data: READY }));
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('textbox', { name: 'Chat message' })).toBeTruthy();
  });

  // Staff read a fixed text. What the fetch client said goes to the console, for whoever looks into it.
  it('says the assistant could not be checked, in a fixed text, when the status call fails, with Check again, and logs the error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      world({ status: new Error('Forbidden') });
      expect(await screen.findByText("Couldn't check the assistant.")).toBeTruthy();
      expect(screen.queryByText(/Forbidden/)).toBeNull();
      expect(logged.mock.calls.some((call) => call.some((item) => item instanceof Error && item.message === 'Forbidden'))).toBe(true);
    } finally {
      logged.mockRestore();
    }
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

});

describe('the chat area', () => {
  it('has the tools, the model and New chat in the top bar, the empty state, the quick questions above the text box, and the composer', async () => {
    world();
    expect(await screen.findByRole('button', { name: 'Tools (2)' })).toBeTruthy();
    expect(screen.getByText('claude-sonnet-5-5')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Ask Maison')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Which visits are waiting for staff?' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// Paul, 7 October: five quick questions, always at the bottom, so a demo can use them at any point and they do not disappear after the first message.
describe('the five quick questions', () => {
  const sendOne = async (text = 'Which visits are waiting?') => {
    await userEvent.type(box(), `${text}{Enter}`);
    await within(region()).findByText(text);
  };

  it('are five buttons in the empty chat, in the order the spec gives them, and the empty state does not repeat them', async () => {
    world();
    await screen.findByRole('textbox', { name: 'Chat message' });
    expect(chips().map((chip) => chip.textContent)).toEqual([...STARTERS]);
    expect(chips()).toHaveLength(5);
    expect(screen.getByText('Ask Maison')).toBeTruthy();
    // Each question is on the screen once: the empty state has none of its own.
    for (const question of STARTERS) expect(screen.getAllByRole('button', { name: question }), question).toHaveLength(1);
  });

  it('sit directly above the text box and under the messages, inside the chat column, and not in the message list, so they never scroll with it', async () => {
    world();
    await screen.findByRole('textbox', { name: 'Chat message' });
    expect(chatColumn().contains(quickQuestions())).toBe(true);
    expect(region().contains(quickQuestions())).toBe(false);
    expect(Boolean(region().compareDocumentPosition(quickQuestions()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    // The next thing in the column is the composer, so nothing sits between the questions and the box.
    expect(quickQuestions().nextElementSibling).toBe(box().closest('form'));
    expect(quickQuestions().parentElement).toBe(region().parentElement);
  });

  it('are still there after a message is sent, while the answer comes and after it, and after the next question', async () => {
    const held = heldAnswer();
    world({ chat: [held.respond, () => stream(answer('Three questions.'))] });
    await screen.findByRole('textbox', { name: 'Chat message' });

    await sendOne();
    await within(region()).findByText('Looking into it');
    expect(screen.queryByText('Ask Maison')).toBeNull();
    expect(chips().map((chip) => chip.textContent)).toEqual([...STARTERS]);

    held.finish();
    await within(region()).findByText('Looking into it and found two visits.');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(chips().map((chip) => chip.textContent)).toEqual([...STARTERS]);

    await sendOne('And the questions?');
    await within(region()).findByText('Three questions.');
    expect(chips().map((chip) => chip.textContent)).toEqual([...STARTERS]);
  });

  it('are there in a saved chat that was reopened, with its messages, and after New chat', async () => {
    world({ saved: [savedChat('c1', 'Which visits are waiting?')] });
    await shows('The answer to Which visits are waiting?');
    expect(chips()).toHaveLength(5);

    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.getByText('Ask Maison')).toBeTruthy();
    expect(chips()).toHaveLength(5);
  });

  it('send the question as it is written, from the chat that is on the screen, and leave the draft in the text box', async () => {
    const { fetchMock } = world({ chat: [() => stream(answer('Two visits wait.')), () => stream(answer('Two complaints.'))] });
    await screen.findByRole('textbox', { name: 'Chat message' });
    await sendOne('Which visits are waiting?');
    await within(region()).findByText('Two visits wait.');
    await userEvent.type(box(), 'A half-written question');

    await userEvent.click(screen.getByRole('button', { name: 'Any complaints this week?' }));

    expect(await within(region()).findByText('Two complaints.')).toBeTruthy();
    expect(sentBody(fetchMock, 1).messages.at(-1)).toMatchObject({ role: 'user', content: 'Any complaints this week?' });
    expect(sentBody(fetchMock, 1).messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(box().value).toBe('A half-written question');
    expect(document.activeElement).toBe(box());
  });

  it('send each of the five as it is written', async () => {
    const { fetchMock } = world({ chat: STARTERS.map(() => () => stream(answer('Done.'))) });
    await screen.findByRole('textbox', { name: 'Chat message' });
    for (const [index, question] of STARTERS.entries()) {
      await userEvent.click(screen.getByRole('button', { name: question }));
      // Each answer says "Done.", so the number of answers on the screen says when this turn is over, and the questions are switched on again.
      await waitFor(() => expect(within(region()).getAllByText('Done.')).toHaveLength(index + 1));
      await waitFor(() => expect(chips().every((chip) => !chip.disabled)).toBe(true));
      expect(sentBody(fetchMock, index).messages.at(-1), question).toMatchObject({ role: 'user', content: question });
    }
    expect(fetchMock).toHaveBeenCalledTimes(STARTERS.length);
  });

  it('are switched off while an answer comes, send nothing then, and are switched on again when it is over', async () => {
    const held = heldAnswer();
    const { fetchMock } = world({ chat: [held.respond] });
    await screen.findByRole('textbox', { name: 'Chat message' });
    expect(chips().every((chip) => !chip.disabled)).toBe(true);

    await sendOne();
    await within(region()).findByText('Looking into it');
    expect(chips()).toHaveLength(5);
    expect(chips().every((chip) => chip.disabled)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Any complaints this week?' }));
    expect(fetchMock).toHaveBeenCalledOnce();

    held.finish();
    await within(region()).findByText('Looking into it and found two visits.');
    await waitFor(() => expect(chips().every((chip) => !chip.disabled)).toBe(true));
  });

  it('are not there before the assistant is ready: while it is checked, when it is not set up, and when the check failed', async () => {
    let answerStatus: (value: unknown) => void = () => {};
    client.get.mockReset();
    client.get.mockImplementation(() => new Promise((resolve) => (answerStatus = resolve)));
    renderInTheme(
      <AssistantProvider started>
        <Drawer />
      </AssistantProvider>
    );
    expect(screen.getByText('Checking the assistant…')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Quick questions' })).toBeNull();

    answerStatus({ data: NOT_SET_UP });
    await screen.findByRole('heading', { name: "The assistant isn't set up" });
    expect(screen.queryByRole('group', { name: 'Quick questions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Which visits are waiting for staff?' })).toBeNull();
  });

  it('are there when the assistant becomes ready after Check again', async () => {
    world({ status: NOT_SET_UP });
    await screen.findByRole('button', { name: 'Check again' });
    expect(screen.queryByRole('group', { name: 'Quick questions' })).toBeNull();
    client.get.mockImplementation(async () => ({ data: READY }));
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByRole('textbox', { name: 'Chat message' });
    expect(chips()).toHaveLength(5);
  });

  it('stay above the box when the red box shows, which sits between the messages and the questions', async () => {
    world({ chat: [() => stream([event('RUN_STARTED'), event('RUN_ERROR', { message: 'Anthropic is busy. Try again in a minute.', code: '529' })])] });
    await screen.findByRole('textbox', { name: 'Chat message' });
    await userEvent.click(screen.getByRole('button', { name: 'Which visits are waiting for staff?' }));
    const alert = (await screen.findByText('Anthropic is busy. Try again in a minute.')).closest('[role="alert"]') as HTMLElement;
    expect(Boolean(alert.compareDocumentPosition(quickQuestions()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(quickQuestions().nextElementSibling).toBe(box().closest('form'));
    expect(chips()).toHaveLength(5);
  });
});

describe('a turn', () => {
  it('sends what staff typed with Enter, draws the answer as Markdown, and brings Send back', async () => {
    const table = ['| Reference | Status |', '| --- | --- |', '| APT-4821 | requested |'].join('\n');
    const { fetchMock } = world({ chat: [() => stream(answer(table))] });
    await screen.findByRole('textbox', { name: 'Chat message' });

    await userEvent.type(box(), 'Which visits are waiting?{Enter}');

    // The question is in the chat at once, and the box is empty again.
    expect(await within(region()).findByText('Which visits are waiting?')).toBeTruthy();
    expect(box().value).toBe('');
    // The answer comes as a table.
    expect(await within(region()).findByRole('table')).toBeTruthy();
    expect(within(region()).getByRole('cell', { name: 'APT-4821' })).toBeTruthy();
    // The turn is over: Stop has gone, and Send waits only for the next question.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    // The request carried the question, to the assistant's chat route.
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/maison/assistant/chat');
    expect(sentBody(fetchMock).messages.at(-1)).toMatchObject({ role: 'user', content: 'Which visits are waiting?' });
    // The empty state has gone, and New chat works.
    expect(screen.queryByText('Ask Maison')).toBeNull();
    expect((screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends a quick question as it is written, and leaves what staff typed in the box', async () => {
    const { fetchMock } = world({ chat: [() => stream(answer('Two visits wait.'))] });
    await screen.findByRole('textbox', { name: 'Chat message' });
    await userEvent.type(box(), 'A half-written question');

    await userEvent.click(screen.getByRole('button', { name: 'Which visits are waiting for staff?' }));

    expect(await within(region()).findByText('Two visits wait.')).toBeTruthy();
    expect(sentBody(fetchMock).messages.at(-1)).toMatchObject({ role: 'user', content: 'Which visits are waiting for staff?' });
    expect(box().value).toBe('A half-written question');
  });

  it('puts the focus back in the text box after a send, from a quick question and from the Send button alike, so the next question can be typed', async () => {
    world({ chat: [() => stream(answer('One.')), () => stream(answer('Two.'))] });
    await screen.findByRole('textbox', { name: 'Chat message' });

    await userEvent.click(screen.getByRole('button', { name: 'Which visits are waiting for staff?' }));
    await within(region()).findByText('One.');
    expect(document.activeElement).toBe(box());

    await userEvent.type(box(), 'And the questions?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await within(region()).findByText('Two.');
    expect(document.activeElement).toBe(box());
  });

  // The drawer is closed and opened as staff please. The chat and the draft are in the provider, above the drawer, and the drawer itself stays in the page
  // while it is closed, hidden, so what staff see when it opens again is what they left: the same chat, the same text box, and what they typed.
  it('keeps the chat and what staff typed while the drawer is closed, and shows both when it opens again', async () => {
    const { show } = world({ chat: [() => stream(answer('Two visits wait.'))], mount: false });
    const view = show(<Drawer open />);
    await screen.findByRole('textbox', { name: 'Chat message' });
    await userEvent.type(box(), 'Which visits are waiting?{Enter}');
    await within(region()).findByText('Two visits wait.');
    await userEvent.type(box(), 'And the questions');
    const textBox = box();

    view.rerender(
      <AssistantProvider started>
        <Drawer open={false} />
      </AssistantProvider>
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    view.rerender(
      <AssistantProvider started>
        <Drawer open />
      </AssistantProvider>
    );

    expect(box()).toBe(textBox);
    expect(box().value).toBe('And the questions');
    expect(within(region()).getByText('Two visits wait.')).toBeTruthy();
  });

  it('shows a tool box for a tool call, in the order it came, closed, and opens it to the result', async () => {
    const calls = [
      event('RUN_STARTED'),
      event('TEXT_MESSAGE_START', { messageId: 'm1', role: 'assistant' }),
      event('TEXT_MESSAGE_CONTENT', { messageId: 'm1', delta: 'Let me look. ' }),
      event('TEXT_MESSAGE_END', { messageId: 'm1' }),
      event('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'list_requests', parentMessageId: 'm1' }),
      event('TOOL_CALL_ARGS', { toolCallId: 'c1', delta: '{}' }),
      event('TOOL_CALL_END', { toolCallId: 'c1', toolCallName: 'list_requests', input: {} }),
      event('TOOL_CALL_RESULT', { toolCallId: 'c1', messageId: 'r1', content: JSON.stringify({ requests: [{ reference: 'APT-4821', note: '<customer_note>For my father.</customer_note>' }], capped: false }) }),
      event('TEXT_MESSAGE_START', { messageId: 'm2', role: 'assistant' }),
      event('TEXT_MESSAGE_CONTENT', { messageId: 'm2', delta: 'One visit waits.' }),
      event('TEXT_MESSAGE_END', { messageId: 'm2' }),
      event('RUN_FINISHED', { finishReason: 'stop' }),
    ];
    world({ chat: [() => stream(calls)] });
    await screen.findByRole('textbox', { name: 'Chat message' });

    await userEvent.type(box(), 'Which visits are waiting?{Enter}');

    const header = await within(region()).findByRole('button', { name: /Tool: list_requests/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(header.textContent).toContain('1 result'));
    await userEvent.click(header);
    const body = region().querySelector('pre') as HTMLElement;
    expect(body.textContent).toContain('"reference": "APT-4821"');
    expect(body.textContent).toContain('For my father.');
    expect(body.textContent).not.toContain('customer_note');
  });

  it('shows the error in a red alert, takes the failed question back into the box, and clears the error on the next send', async () => {
    const failed = [event('RUN_STARTED'), event('RUN_ERROR', { message: 'Anthropic is busy. Try again in a minute.', code: '529' })];
    world({ chat: [() => stream(failed), () => stream(answer('Fine.'))] });
    await screen.findByRole('textbox', { name: 'Chat message' });

    await userEvent.type(box(), 'Which visits are waiting?{Enter}');

    const alert = (await screen.findByText('Anthropic is busy. Try again in a minute.')).closest('[role="alert"]');
    expect(alert).not.toBeNull();
    // The turn that failed before anything came back leaves the chat, and its question goes back in the box.
    await waitFor(() => expect(box().value).toBe('Which visits are waiting?'));
    expect(within(region()).queryByText('Which visits are waiting?')).toBeNull();
    expect(screen.getByText('Ask Maison')).toBeTruthy();

    await userEvent.type(box(), '{Enter}');
    expect(await within(region()).findByText('Fine.')).toBeTruthy();
    expect(screen.queryByText('Anthropic is busy. Try again in a minute.')).toBeNull();
  });

  it('shows the words "New chat" on the button when the chat is too long to go on, and starts over when it is pressed', async () => {
    const tooLong = [event('RUN_STARTED'), event('RUN_ERROR', { message: 'This chat is long. Start a new chat.', code: 'chat_too_long' })];
    world({ chat: [() => stream(answer('Hello.')), () => stream(tooLong)] });
    await screen.findByRole('textbox', { name: 'Chat message' });
    await userEvent.type(box(), 'First{Enter}');
    await within(region()).findByText('Hello.');
    await userEvent.type(box(), 'Second{Enter}');

    await screen.findByText('This chat is long. Start a new chat.');
    const newChat = screen.getByRole('button', { name: 'New chat' });
    expect(newChat.textContent).toBe('New chat');

    await userEvent.click(newChat);
    expect(screen.queryByText('This chat is long. Start a new chat.')).toBeNull();
    expect(screen.getByText('Ask Maison')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New chat' }).textContent).toBe('');
  });

  it('stops an answer that is on its way with Stop, keeps what came, and shows no error', async () => {
    let started: () => void = () => {};
    const began = new Promise<void>((resolve) => (started = resolve));
    world();
    answerWith((signal) => slow(signal, started));
    await screen.findByRole('textbox', { name: 'Chat message' });

    await userEvent.type(box(), 'Which visits are waiting?{Enter}');
    await began;
    expect(await within(region()).findByText('Looking into it')).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(within(region()).getByText('Looking into it')).toBeTruthy();
    // The design system's own live region is an empty alert, so what is looked for is an alert with words in it.
    expect(Array.from(document.querySelectorAll('[role="alert"]')).filter((alert) => alert.textContent)).toEqual([]);
  });
});

describe('saved chats', () => {
  const sidebar = () => screen.getByLabelText('Saved chats');
  const openSidebar = async () => userEvent.click(screen.getByRole('button', { name: 'History' }));
  const rowOf = (title: string) => within(sidebar()).getByRole('button', { name: title });
  const titlesInSidebar = () =>
    within(sidebar())
      .getAllByRole('button')
      .filter((button) => !button.getAttribute('aria-label') && button.textContent !== 'New chat')
      .map((button) => button.textContent);
  /** Types a question and presses Enter, then waits until the turn is over. */
  const ask = async (text: string, answerText?: string) => {
    await userEvent.type(box(), `${text}{Enter}`);
    if (answerText) await shows(answerText);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
  };

  it('has the sidebar closed at first and out of reach, and opens it with History, which then says "Hide history"', async () => {
    world();
    await screen.findByRole('textbox', { name: 'Chat message' });
    expect(sidebar().hasAttribute('inert')).toBe(true);
    expect(sidebar().getAttribute('aria-hidden')).toBe('true');

    await openSidebar();
    expect(sidebar().hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide history' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(sidebar()).getByText('No saved chats yet.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Hide history' }));
    expect(sidebar().hasAttribute('inert')).toBe(true);
  });

  it('shows the empty state, and loads no chat, when the admin has no saved chat', async () => {
    world();
    await screen.findByRole('textbox', { name: 'Chat message' });
    await waitFor(() => expect(client.get).toHaveBeenCalledWith('/maison/conversations'));
    expect(screen.getByText('Ask Maison')).toBeTruthy();
    expect(client.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/maison\/conversations\/./));
  });

  it('reopens the most recent chat when the assistant is ready, and lists the others, newest first, with the open one marked', async () => {
    world({ saved: [savedChat('c2', 'Any complaints this week?'), savedChat('c1', 'Which visits are waiting?')] });
    expect(await shows('The answer to Any complaints this week?')).toBeTruthy();
    expect(within(region()).getByText('Any complaints this week?')).toBeTruthy();
    expect(screen.queryByText('Ask Maison')).toBeNull();
    expect(client.get).toHaveBeenCalledWith('/maison/conversations/c2');
    expect(client.get).not.toHaveBeenCalledWith('/maison/conversations/c1');

    await openSidebar();
    expect(titlesInSidebar()).toEqual(['Any complaints this week?', 'Which visits are waiting?']);
    expect(rowOf('Any complaints this week?').getAttribute('aria-current')).toBe('true');
    expect(rowOf('Which visits are waiting?').hasAttribute('aria-current')).toBe(false);
  });

  it('does not reopen the most recent chat over a chat staff have begun while the list was loading', async () => {
    let answerList: (value: unknown) => void = () => {};
    const { show } = world({ saved: [savedChat('c1', 'An older chat')], chat: [() => stream(answer('Two visits wait.'))], mount: false });
    client.get.mockImplementation(async (url: string) => {
      if (url === '/maison/assistant/status') return { data: READY };
      if (url === '/maison/conversations') return new Promise((resolve) => (answerList = resolve));
      throw new Error(`Unexpected GET ${url}`);
    });
    show();
    await screen.findByRole('textbox', { name: 'Chat message' });
    await waitFor(() => expect(client.get).toHaveBeenCalledWith('/maison/conversations'));

    await ask('Which visits are waiting?', 'Two visits wait.');
    answerList({ data: { conversations: [{ documentId: 'c1', title: 'An older chat', updatedAt: '2026-10-06T00:00:00.000Z' }] } });
    await openSidebar();
    await waitFor(() => expect(titlesInSidebar()).toContain('An older chat'));

    expect(within(region()).getByText('Two visits wait.')).toBeTruthy();
    expect(within(region()).queryByText('The answer to An older chat')).toBeNull();
    expect(client.get).not.toHaveBeenCalledWith('/maison/conversations/c1');
  });

  it('does not reopen the most recent chat over a turn that failed while the list was loading: staff have begun, though nothing of it is left in the chat', async () => {
    let answerList: (value: unknown) => void = () => {};
    const failed = [event('RUN_STARTED'), event('RUN_ERROR', { message: 'Anthropic is busy. Try again in a minute.', code: '529' })];
    const { show } = world({ saved: [savedChat('c1', 'An older chat')], chat: [() => stream(failed)], mount: false });
    client.get.mockImplementation(async (url: string) => {
      if (url === '/maison/assistant/status') return { data: READY };
      if (url === '/maison/conversations') return new Promise((resolve) => (answerList = resolve));
      throw new Error(`Unexpected GET ${url}`);
    });
    show();
    await screen.findByRole('textbox', { name: 'Chat message' });
    await waitFor(() => expect(client.get).toHaveBeenCalledWith('/maison/conversations'));

    await userEvent.type(box(), 'Which visits are waiting?{Enter}');
    await screen.findByText('Anthropic is busy. Try again in a minute.');
    await waitFor(() => expect(box().value).toBe('Which visits are waiting?'));
    answerList({ data: { conversations: [{ documentId: 'c1', title: 'An older chat', updatedAt: '2026-10-06T00:00:00.000Z' }] } });
    await openSidebar();
    await waitFor(() => expect(titlesInSidebar()).toContain('An older chat'));

    expect(screen.getByText('Anthropic is busy. Try again in a minute.')).toBeTruthy();
    expect(screen.getByText('Ask Maison')).toBeTruthy();
    expect(client.get).not.toHaveBeenCalledWith('/maison/conversations/c1');
  });

  it('opens a saved chat that has no messages, as one the server could not read, as an empty chat, and saves the next turn into it', async () => {
    world({ saved: [savedChat('c1', 'A chat that could not be read', [])], chat: [() => stream(answer('Two visits wait.'))] });
    expect(await screen.findByText('Ask Maison')).toBeTruthy();
    await waitFor(() => expect(client.get).toHaveBeenCalledWith('/maison/conversations/c1'));
    await openSidebar();
    await waitFor(() => expect(rowOf('A chat that could not be read').getAttribute('aria-current')).toBe('true'));

    await ask('Which visits are waiting?', 'Two visits wait.');

    await waitFor(() => expect(client.put).toHaveBeenCalledTimes(1));
    expect(client.put.mock.calls[0][0]).toBe('/maison/conversations/c1');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('opens a chat that is chosen in the sidebar, in place of the one on the screen, and marks it', async () => {
    world({ saved: [savedChat('c2', 'Any complaints this week?'), savedChat('c1', 'Which visits are waiting?')] });
    await shows('The answer to Any complaints this week?');
    await openSidebar();

    await userEvent.click(rowOf('Which visits are waiting?'));

    expect(await shows('The answer to Which visits are waiting?')).toBeTruthy();
    expect(within(region()).queryByText('The answer to Any complaints this week?')).toBeNull();
    expect(rowOf('Which visits are waiting?').getAttribute('aria-current')).toBe('true');
  });

  it('takes away the error of the last turn when another chat is opened: the error was about the chat that is left', async () => {
    const failed = [event('RUN_STARTED'), event('RUN_ERROR', { message: 'Anthropic is busy. Try again in a minute.', code: '529' })];
    world({ saved: [savedChat('c2', 'Newer chat'), savedChat('c1', 'Older chat')], chat: [() => stream(failed)] });
    await shows('The answer to Newer chat');
    await userEvent.type(box(), 'Another question{Enter}');
    expect(await screen.findByText('Anthropic is busy. Try again in a minute.')).toBeTruthy();
    await openSidebar();

    await userEvent.click(rowOf('Older chat'));

    expect(await shows('The answer to Older chat')).toBeTruthy();
    expect(screen.queryByText('Anthropic is busy. Try again in a minute.')).toBeNull();
  });

  it('takes away the line about how the last turn ended when another chat is opened', async () => {
    const stopped = [...answer('Part of an answer.').slice(0, 4), event('CUSTOM', { name: 'max_turns', value: {} }), event('RUN_FINISHED', { finishReason: 'stop' })];
    world({ saved: [savedChat('c2', 'Newer chat'), savedChat('c1', 'Older chat')], chat: [() => stream(stopped)] });
    await shows('The answer to Newer chat');
    await ask('Another question', 'Part of an answer.');
    expect(await screen.findByText('The assistant stopped after 6 steps. Ask a narrower question.')).toBeTruthy();
    await openSidebar();

    await userEvent.click(rowOf('Older chat'));

    expect(await shows('The answer to Older chat')).toBeTruthy();
    expect(screen.queryByText('The assistant stopped after 6 steps. Ask a narrower question.')).toBeNull();
  });

  it('opens the chat that was chosen last when two are chosen one after the other: the answer that comes late is dropped', async () => {
    let answerFirst: () => void = () => {};
    world({ saved: [savedChat('c3', 'Newest chat'), savedChat('c2', 'Middle chat'), savedChat('c1', 'Oldest chat')] });
    await shows('The answer to Newest chat');
    const get = client.get.getMockImplementation() as (url: string) => Promise<unknown>;
    client.get.mockImplementation((url: string) => (url === '/maison/conversations/c1' ? new Promise((resolve) => (answerFirst = () => resolve(get(url)))) : get(url)));
    await openSidebar();

    await userEvent.click(rowOf('Oldest chat'));
    await userEvent.click(rowOf('Middle chat'));
    await shows('The answer to Middle chat');
    answerFirst();
    // There is no event for an answer that is dropped, so the test waits for the work the late answer starts.
    await settle();

    expect(within(region()).getByText('The answer to Middle chat')).toBeTruthy();
    expect(within(region()).queryByText('The answer to Oldest chat')).toBeNull();
    expect(rowOf('Middle chat').getAttribute('aria-current')).toBe('true');
  });

  it('waits for a save that is on its way before it opens another chat, so the chat that is left is saved as it was', async () => {
    let finishSave: () => void = () => {};
    world({ saved: [savedChat('c2', 'Newer chat'), savedChat('c1', 'Older chat')], chat: [() => stream(answer('More.'))] });
    await shows('The answer to Newer chat');
    const put = client.put.getMockImplementation() as (...args: any[]) => Promise<unknown>;
    client.put.mockImplementation((...args: any[]) => new Promise((resolve) => (finishSave = () => resolve(put(...args)))));
    await ask('Tell me more', 'More.');
    await waitFor(() => expect(client.put).toHaveBeenCalledTimes(1));
    await openSidebar();

    await userEvent.click(rowOf('Older chat'));
    // There is no event for a chat that is not opened, so the test waits for the work the click starts.
    await settle();
    expect(client.get).not.toHaveBeenCalledWith('/maison/conversations/c1');

    finishSave();
    expect(await shows('The answer to Older chat')).toBeTruthy();
    expect(client.put.mock.calls[0][0]).toBe('/maison/conversations/c2');
  });

  // Anthropic refuses a history whose signed thinking block was changed, so what is opened is what is saved again, key for key.
  it('keeps every key of every part of a chat it opens, so it saves the chat again as it was: a thinking part keeps its signature', async () => {
    const thinking = { type: 'thinking', content: 'Let me look.', signature: 'EqQBCkYIBRgC', providerMetadata: { anthropic: { index: 0 } } };
    const messages = [staffSays('u1', 'Which visits are waiting?'), { id: 'a1', role: 'assistant', createdAt: '2026-10-07T01:02:03.000Z', parts: [thinking, { type: 'text', content: 'Two visits wait.' }] }];
    world({ saved: [savedChat('c1', 'Which visits are waiting?', messages)], chat: [() => stream(answer('Three.'))] });
    await shows('Two visits wait.');

    await ask('And the questions?', 'Three.');

    await waitFor(() => expect(client.put).toHaveBeenCalledTimes(1));
    const saved = client.put.mock.calls[0][1].messages as Array<{ parts: unknown[] }>;
    expect(saved).toHaveLength(4);
    expect(saved[1]).toEqual(messages[1]);
    expect(saved[1].parts[0]).toEqual(thinking);
  });

  it('counts a reopened chat toward what is sent: the request carries every message, the saved ones and the new question', async () => {
    const { fetchMock } = world({ saved: [savedChat('c1', 'Which visits are waiting?')], chat: [() => stream(answer('Three.'))] });
    await shows('The answer to Which visits are waiting?');

    await ask('And the questions?', 'Three.');

    expect(sentBody(fetchMock).messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant', 'user']);
  });

  describe('saving', () => {
    it('creates the chat after the first turn, with the question as its title and the cleaned messages, and updates it after the next', async () => {
      const { rows } = world({ chat: [() => stream(answer('Two visits wait.')), () => stream(answer('Three questions.'))] });
      await screen.findByRole('textbox', { name: 'Chat message' });

      await ask('Which visits are waiting?', 'Two visits wait.');
      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
      const [url, body] = client.post.mock.calls[0];
      expect(url).toBe('/maison/conversations');
      expect(body.title).toBe('Which visits are waiting?');
      expect(body.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant']);
      expect(body.messages[1].parts[0]).toMatchObject({ type: 'text', content: 'Two visits wait.' });

      await ask('And the questions?', 'Three questions.');
      await waitFor(() => expect(client.put).toHaveBeenCalledTimes(1));
      expect(client.put.mock.calls[0][0]).toBe('/maison/conversations/saved-1');
      expect(client.put.mock.calls[0][1].messages).toHaveLength(4);
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
    });

    it('lists the new chat in the sidebar, marked as the open one, once', async () => {
      world({ chat: [() => stream(answer('Two visits wait.'))] });
      await screen.findByRole('textbox', { name: 'Chat message' });
      await ask('Which visits are waiting?', 'Two visits wait.');
      await openSidebar();
      await waitFor(() => expect(titlesInSidebar()).toEqual(['Which visits are waiting?']));
      expect(rowOf('Which visits are waiting?').getAttribute('aria-current')).toBe('true');
    });

    it('cuts the title to 80 characters', async () => {
      world({ chat: [() => stream(answer('Fine.'))] });
      await screen.findByRole('textbox', { name: 'Chat message' });
      await ask('x'.repeat(200), 'Fine.');
      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
      expect(client.post.mock.calls[0][1].title).toBe('x'.repeat(80));
    });

    it('saves a chat of a reopened chat in the same chat, and moves it to the top of the list', async () => {
      world({ saved: [savedChat('c2', 'Newer chat'), savedChat('c1', 'Older chat')], chat: [() => stream(answer('More.'))] });
      await shows('The answer to Newer chat');
      await openSidebar();
      await userEvent.click(rowOf('Older chat'));
      await shows('The answer to Older chat');

      await ask('Tell me more', 'More.');

      await waitFor(() => expect(client.put).toHaveBeenCalledTimes(1));
      expect(client.put.mock.calls[0][0]).toBe('/maison/conversations/c1');
      expect(client.post).not.toHaveBeenCalled();
      await waitFor(() => expect(titlesInSidebar()).toEqual(['Older chat', 'Newer chat']));
    });

    // The turn was stopped in the middle of a tool call. The saved chat must not hold the call: reopened, it would show "…" for ever, and
    // the next send would replay a call with no answer to Anthropic.
    it('saves only the cleaned messages: a tool call that Stop cut off is not in the saved chat', async () => {
      const aborted = (signal?: AbortSignal) =>
        new Response(
          new ReadableStream({
            start(controller) {
              const events = [
                event('RUN_STARTED'),
                event('TEXT_MESSAGE_START', { messageId: 'm1', role: 'assistant' }),
                event('TEXT_MESSAGE_CONTENT', { messageId: 'm1', delta: 'Looking. ' }),
                event('TEXT_MESSAGE_END', { messageId: 'm1' }),
                event('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'list_requests', parentMessageId: 'm1' }),
                event('TOOL_CALL_ARGS', { toolCallId: 'c1', delta: '{"sta' }),
              ];
              for (const item of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
              signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        );
      world();
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => aborted(init?.signal)));
      await screen.findByRole('textbox', { name: 'Chat message' });

      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      await within(region()).findByRole('button', { name: /Tool: list_requests/ });
      await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));

      await waitFor(() => expect(client.post).toHaveBeenCalled());
      const saved = client.post.mock.calls.at(-1)?.[1].messages as Array<{ parts: Array<{ type: string; content?: string }> }>;
      expect(saved.map((message) => message.parts.map((part) => part.type))).toEqual([['text'], ['text']]);
      expect(saved[1].parts[0].content).toBe('Looking. ');
      expect(within(region()).queryByRole('button', { name: /Tool: list_requests/ })).toBeNull();
    });

    it('saves nothing for a turn that failed before anything came back, and nothing for an empty chat', async () => {
      world({ chat: [() => stream([event('RUN_STARTED'), event('RUN_ERROR', { message: 'Anthropic is busy. Try again in a minute.', code: '529' })])] });
      await screen.findByRole('textbox', { name: 'Chat message' });
      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      await screen.findByText('Anthropic is busy. Try again in a minute.');
      await waitFor(() => expect(box().value).toBe('Which visits are waiting?'));
      expect(client.post).not.toHaveBeenCalled();
      expect(client.put).not.toHaveBeenCalled();
    });

    it('does not save a chat again when nothing in it has changed', async () => {
      world({ saved: [savedChat('c1', 'Which visits are waiting?')] });
      await shows('The answer to Which visits are waiting?');
      // There is no event for a save that does not happen.
      await settle();
      expect(client.post).not.toHaveBeenCalled();
      expect(client.put).not.toHaveBeenCalled();
    });

    it('says the chat could not be saved, and goes on: the answer stays, and the next turn saves it', async () => {
      world({ chat: [() => stream(answer('Two visits wait.')), () => stream(answer('Three questions.'))] });
      await screen.findByRole('textbox', { name: 'Chat message' });
      client.post.mockRejectedValueOnce(new Error('Gateway timeout'));

      await ask('Which visits are waiting?', 'Two visits wait.');

      expect(await screen.findByText("Couldn't save this chat.")).toBeTruthy();
      expect(screen.getByText("Couldn't save this chat.").closest('[role="alert"]')).not.toBeNull();
      expect(within(region()).getByText('Two visits wait.')).toBeTruthy();
      client.post.mockImplementation(async (_url: string, body: { title: string }) => ({ data: { conversation: { documentId: 'saved-9', title: body.title, updatedAt: '2026-10-07T05:00:00.000Z' } } }));

      await ask('And the questions?', 'Three questions.');
      await waitFor(() => expect(screen.queryByText("Couldn't save this chat.")).toBeNull());
      expect(client.post).toHaveBeenCalledTimes(2);
      expect(client.post.mock.calls[1][1].messages).toHaveLength(4);
    });

    it('saves a chat that was deleted elsewhere as a new chat, with no error', async () => {
      const { rows } = world({ saved: [savedChat('c1', 'Which visits are waiting?')], chat: [() => stream(answer('More.'))] });
      await shows('The answer to Which visits are waiting?');
      rows.splice(0, rows.length);

      await ask('Tell me more', 'More.');

      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
      expect(client.put).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Couldn't save this chat.")).toBeNull();
      expect(rows).toHaveLength(1);
    });
  });

  describe('New chat', () => {
    it('starts an empty chat, and keeps the old one in the sidebar: nothing is deleted', async () => {
      world({ chat: [() => stream(answer('Two visits wait.'))] });
      await screen.findByRole('textbox', { name: 'Chat message' });
      await ask('Which visits are waiting?', 'Two visits wait.');
      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));

      await userEvent.click(screen.getByRole('button', { name: 'New chat' }));

      expect(screen.getByText('Ask Maison')).toBeTruthy();
      expect(within(region()).queryByText('Two visits wait.')).toBeNull();
      await openSidebar();
      expect(titlesInSidebar()).toEqual(['Which visits are waiting?']);
      expect(within(sidebar()).getByText('Which visits are waiting?').closest('button')?.hasAttribute('aria-current')).toBe(false);
      expect(client.del).not.toHaveBeenCalled();
    });

    it('saves the chat as it is when New chat stops an answer on its way: what had come stays in the chat it belongs to', async () => {
      world();
      answerWith(slow);
      await screen.findByRole('textbox', { name: 'Chat message' });
      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      await within(region()).findByText('Looking into it');

      await userEvent.click(screen.getByRole('button', { name: 'New chat' }));

      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
      const saved = client.post.mock.calls[0][1] as { title: string; messages: Array<{ role: string; parts: Array<{ content?: string }> }> };
      expect(saved.title).toBe('Which visits are waiting?');
      expect(saved.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(saved.messages[1].parts[0].content).toBe('Looking into it');
      expect(screen.getByText('Ask Maison')).toBeTruthy();
    });

    it('gives the old chat back when its row is pressed, and saves the next chat as a chat of its own', async () => {
      world({ chat: [() => stream(answer('Two visits wait.')), () => stream(answer('Fine.'))] });
      await screen.findByRole('textbox', { name: 'Chat message' });
      await ask('Which visits are waiting?', 'Two visits wait.');
      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
      await userEvent.click(screen.getByRole('button', { name: 'New chat' }));

      await ask('Any complaints this week?', 'Fine.');

      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2));
      expect(client.put).not.toHaveBeenCalled();
      await openSidebar();
      await waitFor(() => expect(titlesInSidebar()).toEqual(['Any complaints this week?', 'Which visits are waiting?']));
      await userEvent.click(rowOf('Which visits are waiting?'));
      expect(await shows('Two visits wait.')).toBeTruthy();
      expect(within(region()).queryByText('Fine.')).toBeNull();
    });

    // The save goes to the chat it was made for, so a saved chat is updated and no second chat is made.
    it('updates the saved chat it leaves, and creates no second chat, when New chat stops an answer on its way', async () => {
      world({ saved: [savedChat('c1', 'Which visits are waiting?')] });
      answerWith(slow);
      await shows('The answer to Which visits are waiting?');
      await userEvent.type(box(), 'Another question{Enter}');
      await within(region()).findByText('Looking into it');

      await userEvent.click(screen.getByRole('button', { name: 'New chat' }));

      await waitFor(() => expect(client.put).toHaveBeenCalledTimes(1));
      expect(client.put.mock.calls[0][0]).toBe('/maison/conversations/c1');
      expect(client.put.mock.calls[0][1].messages).toHaveLength(4);
      expect(client.post).not.toHaveBeenCalled();
    });

    // What is saved holds no tool call that was cut off.
    it('saves no cut-off tool call when New chat is pressed while a tool runs', async () => {
      world();
      answerWith(midTool);
      await screen.findByRole('textbox', { name: 'Chat message' });
      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      await within(region()).findByRole('button', { name: /Tool: list_requests/ });

      await userEvent.click(screen.getByRole('button', { name: 'New chat' }));

      await waitFor(() => expect(client.post).toHaveBeenCalled());
      const saved = client.post.mock.calls.at(-1)?.[1].messages as Array<{ parts: Array<{ type: string }> }>;
      expect(saved.map((message) => message.parts.map((part) => part.type))).toEqual([['text'], ['text']]);
    });

    // A question with no answer yet is not a chat.
    it('saves nothing when New chat is pressed before the answer has begun', async () => {
      world();
      answerWith(silent);
      await screen.findByRole('textbox', { name: 'Chat message' });
      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      await screen.findByRole('status', { name: 'Assistant is replying' });

      await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
      // The turn was never saved, so no event follows New chat. The empty chat is on the screen once New chat has been handled.
      await screen.findByText('Ask Maison');
      await settle();

      expect(client.post).not.toHaveBeenCalled();
      expect(client.put).not.toHaveBeenCalled();
    });

    // New chat takes precedence over a chat that was chosen and has not arrived yet.
    it('keeps the empty chat that New chat made when the answer for a chat chosen just before arrives late', async () => {
      let answerOlder: () => void = () => {};
      world({ saved: [savedChat('c2', 'Newer chat'), savedChat('c1', 'Older chat')] });
      await shows('The answer to Newer chat');
      const get = client.get.getMockImplementation() as (url: string) => Promise<unknown>;
      client.get.mockImplementation((url: string) => (url === '/maison/conversations/c1' ? new Promise((resolve) => (answerOlder = () => resolve(get(url)))) : get(url)));
      await openSidebar();
      await userEvent.click(rowOf('Older chat'));
      // With the sidebar open there are two buttons named "New chat". This one is the sidebar's.
      await userEvent.click(within(sidebar()).getByRole('button', { name: 'New chat' }));
      expect(await screen.findByText('Ask Maison')).toBeTruthy();

      answerOlder();
      // There is no event for an answer that is dropped.
      await settle();

      expect(screen.getByText('Ask Maison')).toBeTruthy();
      expect(within(region()).queryByText('The answer to Older chat')).toBeNull();
    });

    it('leaves what staff have typed in the box', async () => {
      world({ chat: [() => stream(answer('Two visits wait.'))] });
      await screen.findByRole('textbox', { name: 'Chat message' });
      await ask('Which visits are waiting?', 'Two visits wait.');
      await userEvent.type(box(), 'A half-written question');
      await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
      expect(box().value).toBe('A half-written question');
    });

    it('keeps the draft across a change of chat too', async () => {
      world({ saved: [savedChat('c2', 'Newer chat'), savedChat('c1', 'Older chat')] });
      await shows('The answer to Newer chat');
      await userEvent.type(box(), 'Not sent yet');
      await openSidebar();
      await userEvent.click(rowOf('Older chat'));
      await shows('The answer to Older chat');
      expect(box().value).toBe('Not sent yet');
    });

    // A chat that was deleted elsewhere is saved again as a new chat, and the old row goes.
    it('shows the chat once in the sidebar after a vanished chat is saved again as a new one', async () => {
      const { rows } = world({ saved: [savedChat('c1', 'Which visits are waiting?')], chat: [() => stream(answer('More.'))] });
      await shows('The answer to Which visits are waiting?');
      rows.splice(0, rows.length);
      await ask('Tell me more', 'More.');
      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
      await openSidebar();
      await waitFor(() => expect(titlesInSidebar()).toHaveLength(1));
    });

    // A save that failed is tried again by the next save of the same chat, which New chat makes.
    it('saves a chat whose save failed when New chat is pressed afterwards', async () => {
      const { rows } = world({ chat: [() => stream(answer('Two visits wait.'))] });
      await screen.findByRole('textbox', { name: 'Chat message' });
      client.post.mockRejectedValueOnce(new Error('Gateway timeout'));
      await ask('Which visits are waiting?', 'Two visits wait.');
      await screen.findByText("Couldn't save this chat.");
      await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
      // The second save is the event to wait for: the failed chat is stored when New chat is pressed.
      await waitFor(() => expect(rows).toHaveLength(1));
      expect(rows).toHaveLength(1);
    });

    // A turn that begins while a delete is on its way stays on the screen.
    it('keeps a turn that began while the open chat was being deleted', async () => {
      let finishDelete: () => void = () => {};
      world({ saved: [savedChat('c1', 'Which visits are waiting?')] });
      answerWith(slow);
      await shows('The answer to Which visits are waiting?');
      const del = client.del.getMockImplementation() as (...args: any[]) => Promise<unknown>;
      client.del.mockImplementation((...args: any[]) => new Promise((resolve) => (finishDelete = () => resolve(del(...args)))));
      await openSidebar();
      await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Which visits are waiting?' }));
      await userEvent.type(box(), 'Another question{Enter}');
      await within(region()).findByText('Looking into it');
      finishDelete();
      // The delete finishes when its row is gone from the list. The turn that began meanwhile must still be on the screen then.
      await waitFor(() => expect(titlesInSidebar()).toEqual([]));
      expect(within(region()).queryByText('Another question')).not.toBeNull();
    });
  });

  describe('deleting', () => {
    it('deletes a chat at once, from its trash button, and takes its row out', async () => {
      world({ saved: [savedChat('c2', 'Newer chat'), savedChat('c1', 'Older chat')] });
      await shows('The answer to Newer chat');
      await openSidebar();

      await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Older chat' }));

      await waitFor(() => expect(titlesInSidebar()).toEqual(['Newer chat']));
      expect(client.del).toHaveBeenCalledExactlyOnceWith('/maison/conversations/c1');
      // The chat that was open stays open.
      expect(within(region()).getByText('The answer to Newer chat')).toBeTruthy();
    });

    it('empties the screen when the chat that is deleted is the open one', async () => {
      world({ saved: [savedChat('c1', 'Which visits are waiting?')] });
      await shows('The answer to Which visits are waiting?');
      await openSidebar();

      await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Which visits are waiting?' }));

      expect(await screen.findByText('Ask Maison')).toBeTruthy();
      expect(within(region()).queryByText('The answer to Which visits are waiting?')).toBeNull();
      expect(within(sidebar()).getByText('No saved chats yet.')).toBeTruthy();
    });

    it('saves the next chat as a new one after the open chat was deleted', async () => {
      world({ saved: [savedChat('c1', 'Which visits are waiting?')], chat: [() => stream(answer('Fine.'))] });
      await shows('The answer to Which visits are waiting?');
      await openSidebar();
      await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Which visits are waiting?' }));
      await screen.findByText('Ask Maison');

      await ask('Any complaints this week?', 'Fine.');

      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
      expect(client.put).not.toHaveBeenCalled();
    });

    // A save that ran after the delete would find no chat to save into, and say "Couldn't save this chat."
    it('waits for a save that is on its way before it deletes the chat', async () => {
      let finishSave: (value: unknown) => void = () => {};
      world({ saved: [savedChat('c1', 'Which visits are waiting?')], chat: [() => stream(answer('More.'))] });
      await shows('The answer to Which visits are waiting?');
      const put = client.put.getMockImplementation() as (...args: any[]) => Promise<unknown>;
      client.put.mockImplementation((...args: any[]) => new Promise((resolve) => (finishSave = () => resolve(put(...args)))));
      await ask('Tell me more', 'More.');
      await waitFor(() => expect(client.put).toHaveBeenCalledTimes(1));
      await openSidebar();

      await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Which visits are waiting?' }));
      // There is no event for a delete that does not start yet.
      await settle();
      expect(client.del).not.toHaveBeenCalled();

      finishSave(undefined);
      await waitFor(() => expect(client.del).toHaveBeenCalledExactlyOnceWith('/maison/conversations/c1'));
      expect(screen.queryByText("Couldn't save this chat.")).toBeNull();
    });

    // Deleting the open chat takes precedence over a chat that was chosen and has not arrived yet.
    it('keeps the empty screen after the open chat is deleted when the answer for a chat chosen just before arrives late', async () => {
      let answerOlder: () => void = () => {};
      world({ saved: [savedChat('c2', 'Newer chat'), savedChat('c1', 'Older chat')] });
      await shows('The answer to Newer chat');
      const get = client.get.getMockImplementation() as (url: string) => Promise<unknown>;
      client.get.mockImplementation((url: string) => (url === '/maison/conversations/c1' ? new Promise((resolve) => (answerOlder = () => resolve(get(url)))) : get(url)));
      await openSidebar();
      await userEvent.click(rowOf('Older chat'));
      await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Newer chat' }));
      expect(await screen.findByText('Ask Maison')).toBeTruthy();

      answerOlder();
      // There is no event for an answer that is dropped.
      await settle();

      expect(screen.getByText('Ask Maison')).toBeTruthy();
      expect(within(region()).queryByText('The answer to Older chat')).toBeNull();
    });

    it('says so, and keeps the row, when the chat could not be deleted', async () => {
      world({ saved: [savedChat('c1', 'Which visits are waiting?')] });
      await shows('The answer to Which visits are waiting?');
      client.del.mockRejectedValueOnce(Object.assign(new Error('Server Error'), { status: 500 }));
      await openSidebar();

      await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Which visits are waiting?' }));

      expect(await screen.findByText("Couldn't delete that chat.")).toBeTruthy();
      expect(titlesInSidebar()).toEqual(['Which visits are waiting?']);
      expect(within(region()).getByText('The answer to Which visits are waiting?')).toBeTruthy();
    });

    it('takes the row out when the chat was already gone: it is deleted all the same', async () => {
      const { rows } = world({ saved: [savedChat('c2', 'Newer chat'), savedChat('c1', 'Older chat')] });
      await shows('The answer to Newer chat');
      rows.splice(1, 1);
      await openSidebar();

      await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Older chat' }));

      await waitFor(() => expect(titlesInSidebar()).toEqual(['Newer chat']));
      expect(screen.queryByText("Couldn't delete that chat.")).toBeNull();
    });
  });

  describe('while an answer comes', () => {
    it('switches off the sidebar: its rows, New chat and the trash buttons', async () => {
      world({ saved: [savedChat('c1', 'Which visits are waiting?')], chat: [slow] });
      await shows('The answer to Which visits are waiting?');
      await openSidebar();
      await userEvent.type(box(), 'Another question{Enter}');
      await shows('Looking into it');

      for (const button of within(sidebar()).getAllByRole('button') as HTMLButtonElement[]) expect(button.disabled, button.getAttribute('aria-label') ?? button.textContent ?? '').toBe(true);
      await userEvent.click(rowOf('Which visits are waiting?'));
      expect(within(region()).getByText('Looking into it')).toBeTruthy();
      expect(client.get).not.toHaveBeenCalledWith('/maison/conversations/c1', expect.anything());
    });
  });

  it('does nothing when it is asked to open or delete a chat while an answer comes: that is part of what the page offers', async () => {
    const Probe = () => {
      const assistant = useAssistant();
      return (
        <>
          <button onClick={() => void assistant?.history.openChat('c1')}>probe open</button>
          <button onClick={() => void assistant?.history.deleteChat('c1')}>probe delete</button>
        </>
      );
    };
    const { rows, show } = world({ saved: [savedChat('c1', 'Which visits are waiting?')], chat: [slow], mount: false });
    show(
      <>
        <Drawer />
        <Probe />
      </>
    );
    await shows('The answer to Which visits are waiting?');
    await userEvent.type(box(), 'Another question{Enter}');
    await within(region()).findByText('Looking into it');

    await userEvent.click(screen.getByRole('button', { name: 'probe open' }));
    await userEvent.click(screen.getByRole('button', { name: 'probe delete' }));

    expect(within(region()).getByText('Looking into it')).toBeTruthy();
    expect(client.del).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    // The chat was opened once, when the drawer opened, and not again for the probe.
    expect(client.get.mock.calls.filter(([url]) => url === '/maison/conversations/c1')).toHaveLength(1);
  });

  describe('when a call to the saved chats fails', () => {
    it('says the list could not be loaded, and the chat still works', async () => {
      const { show } = world({ chat: [() => stream(answer('Two visits wait.'))], mount: false });
      client.get.mockImplementation(async (url: string) => {
        if (url === '/maison/assistant/status') return { data: READY };
        throw new Error('Gateway timeout');
      });
      show();
      expect(await screen.findByText("Couldn't load your saved chats.")).toBeTruthy();
      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      expect(await shows('Two visits wait.')).toBeTruthy();
    });

    it('says the chat could not be opened, and loads the list again: the chat may be gone', async () => {
      const { rows } = world({ saved: [savedChat('c2', 'Newer chat'), savedChat('c1', 'Older chat')] });
      await shows('The answer to Newer chat');
      await openSidebar();
      rows.splice(1, 1);
      const listCalls = client.get.mock.calls.filter(([url]) => url === '/maison/conversations').length;

      await userEvent.click(rowOf('Older chat'));

      expect(await screen.findByText("Couldn't open that chat.")).toBeTruthy();
      await waitFor(() => expect(client.get.mock.calls.filter(([url]) => url === '/maison/conversations').length).toBe(listCalls + 1));
      await waitFor(() => expect(titlesInSidebar()).toEqual(['Newer chat']));
      expect(within(region()).getByText('The answer to Newer chat')).toBeTruthy();
    });

    it("shows a turn's error before a problem with the saved chats, when both are there", async () => {
      const failed = [event('RUN_STARTED'), event('RUN_ERROR', { message: 'Anthropic is busy. Try again in a minute.', code: '529' })];
      world({ chat: [() => stream(answer('Two visits wait.')), () => stream(failed)] });
      await screen.findByRole('textbox', { name: 'Chat message' });
      client.post.mockRejectedValue(new Error('Gateway timeout'));
      await ask('Which visits are waiting?', 'Two visits wait.');
      expect(await screen.findByText("Couldn't save this chat.")).toBeTruthy();

      await userEvent.type(box(), 'And the questions?{Enter}');

      expect(await screen.findByText('Anthropic is busy. Try again in a minute.')).toBeTruthy();
      expect(screen.queryByText("Couldn't save this chat.")).toBeNull();
    });
  });
});

/*
 * What the drawer adds to the chat: its frame, its widths, its focus, Escape and Close, History beside the chat, and staying in the page while it is closed.
 * The widths are held as the declarations the component asked for, since jsdom has no layout: a declaration is read by its name, on its own.
 */

const drawer = () => screen.getByRole('complementary', { name: 'Maison assistant' });
const savedList = () => screen.getByLabelText('Saved chats');
/** The chat column: the box of the top bar, the messages and the composer, which has the width of the chat. */
const chatColumn = () => region().parentElement as HTMLElement;

describe('the drawer', () => {
  describe('its frame', () => {
    it('is a complementary region named "Maison assistant", fixed to the right edge and the full height of the window, 600px wide and at most 90vw', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      const declarations = declarationsOf(drawer());
      expect(declarations).toMatchObject({ position: 'fixed', top: '0', right: '0', bottom: '0', width: '600px', 'max-width': 'calc(90vw - 1px)' });
    });

    // The design system makes every box a border box (`box-sizing: border-box` for `*`, in the global style of its provider), and the admin draws it. In
    // a border box the 1px border on the left is inside the 600px, so the chat column, which starts from 600px, would be one pixel short of the chat.
    // The drawer says what it is, so its width is the width of what is inside it and the border is outside that.
    it('is a content box whatever the design system says of boxes, so the chat column is as wide as the chat and the 1px border is outside it', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      expect(declarationsOf(drawer())['box-sizing']).toBe('content-box');
    });

    it('is white, with a border on its left and the popup shadow, all from the theme', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      const declarations = declarationsOf(drawer());
      expect(declarations.background).toBe(lightTheme.colors.neutral0);
      expect(declarations['border-left']).toBe(`1px solid ${lightTheme.colors.neutral200}`);
      expect(declarations['box-shadow']).toBe(lightTheme.shadows.popupShadow);
    });

    it('takes its colours from the dark theme in the dark theme', async () => {
      world({ mount: false });
      renderInTheme(
        <AssistantProvider started>
          <Drawer />
        </AssistantProvider>,
        { dark: true }
      );
      await screen.findByRole('textbox', { name: 'Chat message' });
      const declarations = declarationsOf(drawer());
      expect(declarations.background).toBe(darkTheme.colors.neutral0);
      expect(declarations['border-left']).toBe(`1px solid ${darkTheme.colors.neutral200}`);
    });

    it('sits above the page and the left menu and below the dialogs, so Reply on LINE and Answer open above it', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      expect(declarationsOf(drawer())['z-index']).toBe('299');
    });

    it('slides in from the right, and changes its width over 0.2 seconds', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      const declarations = declarationsOf(drawer());
      expect(declarations.transition).toBe('width 0.2s ease');
      expect(declarations.animation).toMatch(/\b0\.2s\b/);
      expect(keyframesCss()).toMatch(/@keyframes [^{]+\{from\{transform:translateX\(100%\);\}to\{transform:translateX\(0\);\}\}/);
    });

    it('has no animation and no transition for staff who prefer less motion', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      const reduced = mediaDeclarationsOf(drawer(), '(prefers-reduced-motion: reduce)');
      expect(reduced.transition).toBe('none');
      expect(reduced.animation).toBe('none');
    });

    it('is in the page whichever state the assistant is in: while it is checked, when it is not set up, and when the check failed', async () => {
      let answerStatus: (value: unknown) => void = () => {};
      client.get.mockReset();
      client.get.mockImplementation(() => new Promise((resolve) => (answerStatus = resolve)));
      renderInTheme(
        <AssistantProvider started>
          <Drawer />
        </AssistantProvider>
      );
      expect(drawer()).toBeTruthy();
      expect(screen.getByText('Checking the assistant…')).toBeTruthy();
      answerStatus({ data: NOT_SET_UP });
      expect(await screen.findByRole('heading', { name: "The assistant isn't set up" })).toBeTruthy();
      expect(drawer()).toBeTruthy();
      expect(declarationsOf(drawer()).width).toBe('600px');
    });
  });

  // Only the message list scrolls up and down. The top bar and the composer stay where they are. What keeps them there is a chain of flex boxes from the
  // window down to the list: each one is as tall as the box above it leaves, and may be shorter than its content (`min-height: 0`). If one of them
  // could not be, the messages would push the composer out of the window instead of scrolling. jsdom has no layout, so each link is held on its own.
  describe('scrolling', () => {
    const layout = () => chatColumn().parentElement as HTMLElement;

    it('starts from a drawer that is exactly as tall as the window and lays its content out in a column', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      expect(declarationsOf(drawer())).toMatchObject({ position: 'fixed', top: '0', bottom: '0', display: 'flex', 'flex-direction': 'column' });
    });

    it('gives the chat the height that is left under the drawer, and lets it be shorter than what it holds', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      expect(declarationsOf(layout())).toMatchObject({ display: 'flex', flex: '1 1 0%', 'min-height': '0' });
    });

    it('makes the chat column a flex column that may be shorter than what it holds: the top bar, the list and the composer stack in it, and the list is what gives', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      expect(declarationsOf(chatColumn())).toMatchObject({ display: 'flex', 'flex-direction': 'column', 'min-height': '0' });
    });

    it('lets only the message list scroll up and down: the drawer, the layout and the chat column do not scroll, in either direction', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      expect(declarationsOf(region())['overflow-y']).toBe('auto');
      for (const [name, element] of [['the drawer', drawer()], ['the layout', layout()], ['the chat column', chatColumn()]] as const) {
        const declarations = declarationsOf(element);
        for (const property of ['overflow', 'overflow-x', 'overflow-y']) expect(declarations[property] ?? 'visible', `${name}: ${property}`).not.toMatch(/auto|scroll/);
      }
    });

    it('is the same with the list of saved chats open and with the drawer expanded: the chain does not change with either', async () => {
      world({ saved: [savedChat('c1', 'Which visits are waiting?')] });
      await shows('The answer to Which visits are waiting?');
      await userEvent.click(screen.getByRole('button', { name: 'History' }));
      await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
      expect(declarationsOf(layout())).toMatchObject({ flex: '1 1 0%', 'min-height': '0' });
      expect(declarationsOf(chatColumn())).toMatchObject({ 'flex-direction': 'column', 'min-height': '0' });
      expect(declarationsOf(region())).toMatchObject({ flex: '1', 'min-height': '0', 'overflow-y': 'auto', 'overflow-x': 'hidden' });
    });

    it('holds the saved chats in their own column, which scrolls by itself when the list is long and moves nothing else', async () => {
      world({ saved: [savedChat('c1', 'Which visits are waiting?')] });
      await shows('The answer to Which visits are waiting?');
      await userEvent.click(screen.getByRole('button', { name: 'History' }));
      expect(declarationsOf(savedList()).overflow).toBe('hidden');
      const scrollers = Array.from(savedList().querySelectorAll('div')).filter((element) => declarationsOf(element)['overflow-y'] === 'auto');
      expect(scrollers).toHaveLength(1);
      expect(scrollers[0].contains(within(savedList()).getByRole('button', { name: 'Which visits are waiting?' }))).toBe(true);
    });
  });

  describe('focus', () => {
    it('moves the focus to the text box when it opens', async () => {
      world();
      const textarea = await screen.findByRole('textbox', { name: 'Chat message' });
      expect(document.activeElement).toBe(textarea);
    });

    it('puts the focus on the drawer while the assistant is being checked, and moves it to the text box when the chat comes, so Escape works at once', async () => {
      let answerStatus: (value: unknown) => void = () => {};
      client.get.mockReset();
      client.get.mockImplementation(() => new Promise((resolve) => (answerStatus = resolve)));
      renderInTheme(
        <AssistantProvider started>
          <Drawer />
        </AssistantProvider>
      );
      expect(document.activeElement).toBe(drawer());

      answerStatus({ data: READY });

      const textarea = await screen.findByRole('textbox', { name: 'Chat message' });
      expect(document.activeElement).toBe(textarea);
    });

    // Opening the drawer from a button on the page, for example, leaves the focus on that button, and the drawer still takes it.
    it('moves the focus to the text box when it opens, wherever the focus was on the page, when the assistant is already known to be ready', async () => {
      const Ready = () => <span>{useAssistant()?.ready ? 'the assistant is ready' : 'the assistant is not ready'}</span>;
      const { show } = world({ mount: false });
      const view = show(
        <>
          <button type="button">A button on the page</button>
          <Ready />
        </>
      );
      await screen.findByText('the assistant is ready');
      screen.getByRole('button', { name: 'A button on the page' }).focus();

      view.rerender(
        <AssistantProvider started>
          <button type="button">A button on the page</button>
          <Ready />
          <Drawer />
        </AssistantProvider>
      );

      expect(document.activeElement).toBe(box());
    });

    it('moves the focus to the text box when "Check again" has brought the chat, though the button that had the focus is gone', async () => {
      world({ status: NOT_SET_UP, mount: false }).show();
      const again = await screen.findByRole('button', { name: 'Check again' });
      again.focus();
      client.get.mockImplementation(async () => ({ data: READY }));
      await userEvent.click(again);
      const textarea = await screen.findByRole('textbox', { name: 'Chat message' });
      expect(document.activeElement).toBe(textarea);
    });

    it('does not take the focus from where staff put it while the assistant was being checked', async () => {
      let answerStatus: (value: unknown) => void = () => {};
      client.get.mockReset();
      client.get.mockImplementation(() => new Promise((resolve) => (answerStatus = resolve)));
      renderInTheme(
        <AssistantProvider started>
          <button type="button">A button on the page</button>
          <Drawer />
        </AssistantProvider>
      );
      const page = screen.getByRole('button', { name: 'A button on the page' });
      page.focus();

      answerStatus({ data: READY });
      await screen.findByRole('textbox', { name: 'Chat message' });

      expect(document.activeElement).toBe(page);
    });

    it('does not trap the focus: Tab goes on to the page, which stays usable beside the drawer', async () => {
      world({ mount: false }).show(
        <>
          <Drawer />
          <button type="button">A button on the page</button>
        </>
      );
      await screen.findByRole('textbox', { name: 'Chat message' });
      // The focus starts in the text box, which is the last control of the drawer that can take it (Send is off with nothing typed, and the
      // saved chats are put away). The next stop is the page's button, which is after the drawer in the document, so nothing held the focus.
      await userEvent.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'A button on the page' }));
      // And back: Shift+Tab returns to the text box, so the drawer is as reachable from the page as the page is from the drawer.
      await userEvent.tab({ shift: true });
      expect(document.activeElement).toBe(box());
    });
  });

  describe('Escape', () => {
    const open = async (onClose = vi.fn()) => {
      world({ mount: false }).show(
        <>
          <Drawer onClose={onClose} />
          <button type="button">A button on the page</button>
        </>
      );
      await screen.findByRole('textbox', { name: 'Chat message' });
      return onClose;
    };

    it('closes the drawer when it is pressed with the focus in the drawer', async () => {
      const onClose = await open();
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes the drawer from any control in it, not only from the text box', async () => {
      const onClose = await open();
      screen.getByRole('button', { name: 'History' }).focus();
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does nothing when the focus is on the page, outside the drawer', async () => {
      const onClose = await open();
      screen.getByRole('button', { name: 'A button on the page' }).focus();
      await userEvent.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does nothing for any other key', async () => {
      const onClose = await open();
      await userEvent.keyboard('a{Enter}{Tab}');
      expect(onClose).not.toHaveBeenCalled();
    });

    // Staff typing Japanese press Escape to cancel a conversion, and that must not close the drawer.
    it('does nothing for the Escape that cancels a conversion of Japanese: the input method is still composing', async () => {
      const onClose = await open();
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Chat message' }), { key: 'Escape', isComposing: true });
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Chat message' }), { key: 'Escape', keyCode: 229 });
      expect(onClose).not.toHaveBeenCalled();
    });

    // A tooltip or a menu of the design system closes on Escape and says so by cancelling the event, and that one Escape is theirs.
    it('does nothing for an Escape that something else has used already, such as a tooltip of the design system closing', async () => {
      const onClose = await open();
      const use = (event: KeyboardEvent) => event.preventDefault();
      document.addEventListener('keydown', use, true);
      try {
        await userEvent.keyboard('{Escape}');
      } finally {
        document.removeEventListener('keydown', use, true);
      }
      expect(onClose).not.toHaveBeenCalled();
    });

    it('closes the list of tools first, and the drawer with the next Escape', async () => {
      const onClose = await open();
      await userEvent.click(screen.getByRole('button', { name: /^Tools \(/ }));
      expect(screen.getByRole('dialog', { name: 'Tools' })).toBeTruthy();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Tools' })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledOnce();
    });

    // The list stays open when the focus moves on, so the first Escape is for the list wherever the focus is.
    it('closes only the list of tools when the focus is in the text box, and the drawer with the next Escape', async () => {
      const onClose = await open();
      await userEvent.click(screen.getByRole('button', { name: /^Tools \(/ }));
      box().focus();
      expect(screen.getByRole('dialog', { name: 'Tools' })).toBeTruthy();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Tools' })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('works while the assistant is being checked, and when it is not set up: the focus is on the drawer then', async () => {
      const onClose = vi.fn();
      world({ status: NOT_SET_UP, mount: false }).show(<Drawer onClose={onClose} />);
      await screen.findByRole('heading', { name: "The assistant isn't set up" });
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('Close', () => {
    it('is in the top bar, after Expand, and closes the drawer', async () => {
      const onClose = vi.fn();
      world({ mount: false }).show(<Drawer onClose={onClose} />);
      await screen.findByRole('textbox', { name: 'Chat message' });
      const expand = screen.getByRole('button', { name: 'Expand the assistant' });
      const close = screen.getByRole('button', { name: 'Close the assistant' });
      expect(expand.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      await userEvent.click(close);

      expect(onClose).toHaveBeenCalledOnce();
    });

    it('is there too while the assistant is being checked, when it is not set up, and when the check failed, so staff can always close the drawer', async () => {
      const onClose = vi.fn();
      let answerStatus: (value: unknown) => void = () => {};
      client.get.mockReset();
      client.get.mockImplementation(() => new Promise((resolve) => (answerStatus = resolve)));
      renderInTheme(
        <AssistantProvider started>
          <Drawer onClose={onClose} />
        </AssistantProvider>
      );
      expect(screen.getByText('Checking the assistant…')).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
      expect(onClose).toHaveBeenCalledTimes(1);

      answerStatus({ data: NOT_SET_UP });
      await screen.findByRole('heading', { name: "The assistant isn't set up" });
      await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('is there when the check failed, with Check again', async () => {
      const onClose = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      world({ status: new Error('Forbidden'), mount: false }).show(<Drawer onClose={onClose} />);
      await screen.findByText("Couldn't check the assistant.");
      await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('Expand and Collapse', () => {
    it('makes the chat wider, 600px to 960px, and narrower again with Collapse, and does nothing else: the list of saved chats stays as it was', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      expect(declarationsOf(drawer()).width).toBe('600px');
      expect(declarationsOf(chatColumn()).flex).toBe('1 1 600px');

      await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
      expect(declarationsOf(drawer()).width).toBe('960px');
      expect(declarationsOf(drawer())['max-width']).toBe('calc(90vw - 1px)');
      expect(declarationsOf(chatColumn()).flex).toBe('1 1 960px');
      // Expand does not open the list of saved chats, and no list shows.
      expect(savedList().hasAttribute('inert')).toBe(true);
      expect(declarationsOf(savedList()).width).toBe('0px');
      expect(screen.getByRole('button', { name: 'History' }).getAttribute('aria-expanded')).toBe('false');

      await userEvent.click(screen.getByRole('button', { name: 'Collapse the assistant' }));
      expect(declarationsOf(drawer()).width).toBe('600px');
      expect(declarationsOf(chatColumn()).flex).toBe('1 1 600px');
    });

    it('leaves the list of saved chats open when it was open, and shut when it was shut: only History decides', async () => {
      world();
      await screen.findByRole('textbox', { name: 'Chat message' });
      await userEvent.click(screen.getByRole('button', { name: 'History' }));
      expect(savedList().hasAttribute('inert')).toBe(false);

      await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
      expect(savedList().hasAttribute('inert')).toBe(false);
      await userEvent.click(screen.getByRole('button', { name: 'Hide history' }));
      await userEvent.click(screen.getByRole('button', { name: 'Collapse the assistant' }));
      expect(savedList().hasAttribute('inert')).toBe(true);
    });

    it('keeps the chat, the draft and the text box as it changes its width: nothing is drawn again', async () => {
      world({ chat: [() => stream(answer('Two visits wait.'))] });
      await screen.findByRole('textbox', { name: 'Chat message' });
      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      await within(region()).findByText('Two visits wait.');
      await userEvent.type(box(), 'And the questions');
      const textBox = box();

      await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
      await userEvent.click(screen.getByRole('button', { name: 'Collapse the assistant' }));

      expect(box()).toBe(textBox);
      expect(box().value).toBe('And the questions');
      expect(within(region()).getByText('Two visits wait.')).toBeTruthy();
    });
  });

  // Paul's table fixes are for both widths: the drawer at 600px and expanded at 960px. The rules are the answer's own and do not read the width, so the same
  // rules must be on the cells and the same room must be given to the bubble at each, and a rule that was written for one width only would show here.
  describe('tables, at both widths', () => {
    const TABLE = [
      '| Reference | Customer | Requested | Summary |',
      '| --- | --- | --- | --- |',
      '| APT-4821 | line:Udec…02 | 2026-10-05 | The customer asks whether the strap of the watch can be made shorter before the visit on Saturday |',
    ].join('\n');
    const tableChat = () => savedChat('c1', 'Which visits are waiting?', [staffSays('u1', 'Which visits are waiting?'), assistantSays('a1', TABLE)]);
    const answerBody = () => region().querySelector('[data-message-part="text"]') as HTMLElement;
    const assistantRow = () => region().querySelector('[data-message-role="assistant"]') as HTMLElement;
    /** The box the table scrolls in: the table's parent, inside the answer. */
    const tableScroller = () => within(answerBody()).getByRole('table').parentElement as HTMLElement;
    const at = async (width: 'narrow' | 'wide') => {
      world({ saved: [tableChat()] });
      await within(await screen.findByRole('region', { name: 'Chat messages' })).findByRole('table');
      if (width === 'wide') await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
      expect(declarationsOf(drawer()).width).toBe(width === 'wide' ? '960px' : '600px');
    };

    describe.each([['narrow', '600px'], ['wide', '960px']] as const)('at %s (%s)', (width) => {
      it('keeps the text of a header cell on one line', async () => {
        await at(width);
        expect(declarationsOf(answerBody(), ' th')['white-space']).toBe('nowrap');
      });

      it('breaks the text of a body cell between words only, and never inside a word that fits its column', async () => {
        await at(width);
        const cells = declarationsOf(answerBody(), ' td');
        expect(cells['white-space']).toBe('normal');
        expect(cells['overflow-wrap']).toBe('break-word');
        expect(cells['word-break']).toBe('normal');
      });

      it('gives a body cell a width of 7rem at least and 22rem at most, so a date or a masked customer keeps its line and long text wraps in its column', async () => {
        await at(width);
        expect(declarationsOf(answerBody(), ' td')).toMatchObject({ 'min-width': '7rem', 'max-width': '22rem' });
      });

      it('keeps the columns as wide as their content wants, so a date or a masked customer keeps its line, and scrolls a table that is wider than the bubble sideways inside the bubble, and the list does not move sideways', async () => {
        await at(width);
        expect(declarationsOf(answerBody(), ' table').width).toBe('max-content');
        expect(declarationsOf(tableScroller())['overflow-x']).toBe('auto');
        expect(declarationsOf(region())['overflow-x']).toBe('hidden');
      });

      it('gives the assistant\'s bubble the whole width of the list beside the avatar, and lets it be narrower than its table so the table scrolls', async () => {
        await at(width);
        expect(declarationsOf(assistantRow())).toMatchObject({ 'max-width': '100%', 'min-width': '0' });
        const bubble = within(assistantRow()).getByText('Assistant').parentElement as HTMLElement;
        expect(declarationsOf(bubble)['min-width']).toBe('0');
      });
    });

    it('has no rule for the cells, the table, the bubble or the list that depends on the width of the window: none is in a media query on width', async () => {
      await at('narrow');
      const parts: Array<[string, Element, string]> = [
        ['the table', answerBody(), ' table'],
        ['a header cell', answerBody(), ' th'],
        ['a body cell', answerBody(), ' td'],
        ['the box the table scrolls in', tableScroller(), ''],
        ['the assistant\'s row', assistantRow(), ''],
        ['the list', region(), ''],
      ];
      for (const [name, element, suffix] of parts) for (const query of mediaQueriesOf(element, suffix)) expect(query, name).not.toMatch(/width/);
    });

    it('has the same rules for the cells, the table and the bubble at 960px as at 600px: nothing in them reads the width', async () => {
      await at('narrow');
      const rules = () => ({
        table: declarationsOf(answerBody(), ' table'),
        th: declarationsOf(answerBody(), ' th'),
        td: declarationsOf(answerBody(), ' td'),
        scroller: declarationsOf(tableScroller()),
        row: declarationsOf(assistantRow()),
        list: declarationsOf(region()),
      });
      const narrow = rules();
      await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
      expect(rules()).toEqual(narrow);
    });
  });

  // Paul, 7 October: "history should not interfere with the width, it should just open wider to preserve the chat".
  describe('History', () => {
    const chats = () => [savedChat('c2', 'Any complaints this week?'), savedChat('c1', 'Which visits are waiting?')];

    it('is shut at first, and opens a list of saved chats as a column of 260px beside the chat, to its left, which makes the drawer 860px wide and leaves the chat 600px', async () => {
      world({ saved: chats() });
      await shows('The answer to Any complaints this week?');
      expect(savedList().hasAttribute('inert')).toBe(true);
      expect(declarationsOf(drawer()).width).toBe('600px');

      await userEvent.click(screen.getByRole('button', { name: 'History' }));

      expect(savedList().hasAttribute('inert')).toBe(false);
      expect(declarationsOf(savedList())).toMatchObject({ width: '260px', 'min-width': '260px', 'box-sizing': 'border-box' });
      expect(declarationsOf(savedList()).position).toBeUndefined();
      expect(declarationsOf(drawer()).width).toBe('860px');
      expect(declarationsOf(chatColumn()).flex).toBe('1 1 600px');
      // The list comes before the chat in the page, so it is to its left, and it is not inside the chat column.
      expect(savedList().compareDocumentPosition(chatColumn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(chatColumn().contains(savedList())).toBe(false);
      expect(within(savedList()).getByRole('button', { name: 'Which visits are waiting?' })).toBeTruthy();
    });

    it('opens expanded as a column of 260px too, which makes the drawer 1220px wide and leaves the chat 960px', async () => {
      world({ saved: chats() });
      await shows('The answer to Any complaints this week?');
      await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));

      await userEvent.click(screen.getByRole('button', { name: 'History' }));

      expect(declarationsOf(drawer()).width).toBe('1220px');
      expect(declarationsOf(chatColumn()).flex).toBe('1 1 960px');
      expect(declarationsOf(savedList()).width).toBe('260px');
    });

    it('shrinks the drawer back when it is shut again, at either width, and the chat is as wide as it was', async () => {
      world({ saved: chats() });
      await shows('The answer to Any complaints this week?');

      await userEvent.click(screen.getByRole('button', { name: 'History' }));
      await userEvent.click(screen.getByRole('button', { name: 'Hide history' }));
      expect(declarationsOf(drawer()).width).toBe('600px');
      expect(declarationsOf(chatColumn()).flex).toBe('1 1 600px');
      expect(savedList().hasAttribute('inert')).toBe(true);

      await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
      await userEvent.click(screen.getByRole('button', { name: 'History' }));
      expect(declarationsOf(drawer()).width).toBe('1220px');
      await userEvent.click(screen.getByRole('button', { name: 'Hide history' }));
      expect(declarationsOf(drawer()).width).toBe('960px');
      expect(declarationsOf(chatColumn()).flex).toBe('1 1 960px');
    });

    // jsdom has no layout, so the limit is held as what the browser is asked for: the drawer is at most 90vw wide, border included, however wide it asks to be, the list is
    // 260px and cannot shrink, and the chat column may shrink, so it has less width and the list keeps its width.
    it('is held at 90vw when the width it asks for would pass that, and the chat column is what has less width', async () => {
      world({ saved: chats() });
      await shows('The answer to Any complaints this week?');
      await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
      await userEvent.click(screen.getByRole('button', { name: 'History' }));

      expect(declarationsOf(drawer())).toMatchObject({ width: '1220px', 'max-width': 'calc(90vw - 1px)' });
      const column = declarationsOf(chatColumn());
      expect(column.flex).toMatch(/^1 1 960px$/);
      expect(column['min-width']).toBe('0');
      // The list does not shrink: its minimum width is its width.
      expect(declarationsOf(savedList())['min-width']).toBe('260px');
    });

    // The drawer gets 260px wider while the list gets 260px wide. They must move together, or the chat column would be squeezed for a moment while the
    // list opens: the same time and the same easing for both, and none of it for staff who prefer less motion.
    it('opens in step with the drawer: both change their width over the same 0.2 seconds with the same easing, so the chat is never squeezed on the way', async () => {
      world({ saved: chats() });
      await shows('The answer to Any complaints this week?');
      await userEvent.click(screen.getByRole('button', { name: 'History' }));
      const timing = (transition: string | undefined, property: string) => {
        const part = (transition ?? '').split(',').map((item) => item.trim()).find((item) => item.startsWith(`${property} `));
        return part?.slice(property.length).trim();
      };
      expect(timing(declarationsOf(drawer()).transition, 'width')).toBe('0.2s ease');
      expect(timing(declarationsOf(savedList()).transition, 'width')).toBe('0.2s ease');
      expect(timing(declarationsOf(savedList()).transition, 'min-width')).toBe('0.2s ease');
    });

    it('has no change over time, for the drawer or for the list, for staff who prefer less motion: the list is there at once, with the drawer', async () => {
      world({ saved: chats() });
      await shows('The answer to Any complaints this week?');
      await userEvent.click(screen.getByRole('button', { name: 'History' }));
      expect(mediaDeclarationsOf(drawer(), '(prefers-reduced-motion: reduce)').transition).toBe('none');
      expect(mediaDeclarationsOf(savedList(), '(prefers-reduced-motion: reduce)').transition).toBe('none');
    });

    it('is the only thing that shows or hides the list: picking a chat, starting a new one and deleting one leave it as it is', async () => {
      world({ saved: chats(), chat: [() => stream(answer('Fine.'))] });
      await shows('The answer to Any complaints this week?');
      await userEvent.click(screen.getByRole('button', { name: 'History' }));

      await userEvent.click(within(savedList()).getByRole('button', { name: 'Which visits are waiting?' }));
      await shows('The answer to Which visits are waiting?');
      expect(savedList().hasAttribute('inert')).toBe(false);

      await userEvent.click(within(savedList()).getByRole('button', { name: 'New chat' }));
      expect(screen.getByText('Ask Maison')).toBeTruthy();
      expect(savedList().hasAttribute('inert')).toBe(false);

      await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Which visits are waiting?' }));
      await waitFor(() => expect(within(savedList()).queryByRole('button', { name: 'Which visits are waiting?' })).toBeNull());
      expect(savedList().hasAttribute('inert')).toBe(false);
      expect(declarationsOf(drawer()).width).toBe('860px');
    });

    it('is not drawn as an overlay, and the error of a chat that could not be opened shows beside it, in the chat', async () => {
      const { rows } = world({ saved: chats() });
      await shows('The answer to Any complaints this week?');
      await userEvent.click(screen.getByRole('button', { name: 'History' }));
      rows.splice(1, 1);

      await userEvent.click(within(savedList()).getByRole('button', { name: 'Which visits are waiting?' }));

      const error = await screen.findByText("Couldn't open that chat.");
      expect(error.closest('[role="alert"]')).not.toBeNull();
      expect(chatColumn().contains(error)).toBe(true);
    });

    it('stays as staff left it when the drawer is closed and opened again, and the drawer is as wide as the list makes it', async () => {
      const { show } = world({ saved: chats(), mount: false });
      const view = show(<Drawer open />);
      await shows('The answer to Any complaints this week?');
      await userEvent.click(screen.getByRole('button', { name: 'History' }));

      view.rerender(
        <AssistantProvider started>
          <Drawer open={false} />
        </AssistantProvider>
      );
      view.rerender(
        <AssistantProvider started>
          <Drawer open />
        </AssistantProvider>
      );

      expect(savedList().hasAttribute('inert')).toBe(false);
      expect(declarationsOf(drawer()).width).toBe('860px');
    });
  });

  // The drawer is not taken out of the page when it is closed: it is hidden. Taking it out and putting it back would draw the chat's screen again,
  // and what staff see after opening it must be what they left: the same chat, the same messages, the draft, and where they had scrolled to.
  describe('while it is closed', () => {
    it('is in the page and hidden: out of sight, out of reach of the pointer and the keyboard, and out of the accessibility tree', async () => {
      const { show } = world({ mount: false });
      const view = show(<Drawer open />);
      await screen.findByRole('textbox', { name: 'Chat message' });
      const root = drawer();

      view.rerender(
        <AssistantProvider started>
          <Drawer open={false} />
        </AssistantProvider>
      );

      expect(screen.queryByRole('complementary')).toBeNull();
      expect(document.body.contains(root)).toBe(true);
      expect(root.getAttribute('aria-hidden')).toBe('true');
      expect(root.hasAttribute('inert')).toBe(true);
      expect(declarationsOf(root).visibility).toBe('hidden');
      expect(declarationsOf(root)['pointer-events']).toBe('none');
    });

    it('is shown again by opening it: not hidden, not inert, and it is the same drawer, with the same text box', async () => {
      const { show } = world({ mount: false });
      const view = show(<Drawer open />);
      const textBox = await screen.findByRole('textbox', { name: 'Chat message' });
      const root = drawer();
      view.rerender(
        <AssistantProvider started>
          <Drawer open={false} />
        </AssistantProvider>
      );

      view.rerender(
        <AssistantProvider started>
          <Drawer open />
        </AssistantProvider>
      );

      expect(drawer()).toBe(root);
      expect(box()).toBe(textBox);
      expect(root.hasAttribute('aria-hidden') && root.getAttribute('aria-hidden') === 'true').toBe(false);
      expect(root.hasAttribute('inert')).toBe(false);
      expect(declarationsOf(root).visibility).toBeUndefined();
    });

    it('does not ask for the assistant, start a chat or save one when it is opened again: the messages stay and nothing is sent to the server', async () => {
      const { show } = world({ chat: [() => stream(answer('Two visits wait.'))], mount: false });
      const view = show(<Drawer open />);
      await screen.findByRole('textbox', { name: 'Chat message' });
      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      await within(region()).findByText('Two visits wait.');
      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
      // A send asks for the status first, to refresh the session (the provider's connection does), so the count is taken after the send.
      const statusCalls = () => client.get.mock.calls.filter(([url]) => url === '/maison/assistant/status').length;
      const listCalls = () => client.get.mock.calls.filter(([url]) => url === '/maison/conversations').length;
      const [statusBefore, listBefore] = [statusCalls(), listCalls()];

      for (let round = 0; round < 3; round += 1) {
        view.rerender(
          <AssistantProvider started>
            <Drawer open={false} />
          </AssistantProvider>
        );
        view.rerender(
          <AssistantProvider started>
            <Drawer open />
          </AssistantProvider>
        );
      }
      // There is no event for a status check or a save that does not happen.
      await settle();

      expect(within(region()).getByText('Which visits are waiting?')).toBeTruthy();
      expect(within(region()).getByText('Two visits wait.')).toBeTruthy();
      expect(screen.queryByText('Ask Maison')).toBeNull();
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.put).not.toHaveBeenCalled();
      expect(statusCalls()).toBe(statusBefore);
      expect(listCalls()).toBe(listBefore);
    });

    it('keeps an answer that arrives while it is closed, and shows it when it opens', async () => {
      const held = heldAnswer();
      const { show } = world({ chat: [held.respond], mount: false });
      const view = show(<Drawer open />);
      await screen.findByRole('textbox', { name: 'Chat message' });
      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      await within(region()).findByText('Looking into it');

      view.rerender(
        <AssistantProvider started>
          <Drawer open={false} />
        </AssistantProvider>
      );
      held.finish();
      // The turn ends while the drawer is closed, and the chat is saved at the end of a turn: that save is the event to wait for.
      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
      view.rerender(
        <AssistantProvider started>
          <Drawer open />
        </AssistantProvider>
      );

      expect(await within(region()).findByText('Looking into it and found two visits.')).toBeTruthy();
    });

    it('moves the focus to the text box when it is opened again, whichever page control had the focus', async () => {
      const { show } = world({ mount: false });
      const view = show(
        <>
          <button type="button">A button on the page</button>
          <Drawer open />
        </>
      );
      await screen.findByRole('textbox', { name: 'Chat message' });
      view.rerender(
        <AssistantProvider started>
          <button type="button">A button on the page</button>
          <Drawer open={false} />
        </AssistantProvider>
      );
      screen.getByRole('button', { name: 'A button on the page' }).focus();

      view.rerender(
        <AssistantProvider started>
          <button type="button">A button on the page</button>
          <Drawer open />
        </AssistantProvider>
      );

      expect(document.activeElement).toBe(box());
    });
  });
});
