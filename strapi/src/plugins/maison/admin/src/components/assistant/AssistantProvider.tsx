import * as React from 'react';

import { useFetchClient } from '@strapi/strapi/admin';
import { fetchServerSentEvents, type UIMessage } from '@tanstack/ai-client';
import { useChat } from '@tanstack/ai-react';

import {
  ASSISTANT_PATHS,
  adminTokenFrom,
  customEventNote,
  draftAfterFailure,
  draftAfterSend,
  errorNotice,
  isStatus,
  noticeAfterStatus,
  withoutFailedTurn,
  withoutOpenToolCalls,
  type AssistantStatus,
  type ErrorNotice,
  type MessageSource,
  type SentQuestion,
} from '../../assistant';
import {
  CONVERSATION_PATHS,
  HISTORY_ERRORS,
  conversationTitle,
  createSaveQueue,
  isChatAnswer,
  isChatList,
  isNotFound,
  isSavedAnswer,
  needsSaving,
  savedKeyOf,
  withSavedChat,
  withoutSavedChat,
  type ChatSnapshot,
  type SavedChatRow,
} from '../../conversations';
import { useMounted } from '../../useMounted';

/**
 * The cookie Strapi keeps the admin token in when it isn't in localStorage. Strapi's admin build replaces `process.env` with
 * its own settings, among them `admin.auth.cookie.name`, which is empty unless the app renames the cookie. Anywhere else
 * there is no `process`, and the name is the default.
 */
declare const process: { env: Record<string, string | undefined> };
const cookieName = (): string => {
  try {
    return process.env.STRAPI_ADMIN_AUTH_COOKIE_NAME || 'jwtToken';
  } catch {
    return 'jwtToken';
  }
};

/** The saved chats: the list, the one that is open, the sidebar, and what to do with them. */
export interface AssistantHistory {
  chats: SavedChatRow[];
  /** The saved chat that is open. Null for a chat that is not saved yet: it is saved after its first turn. */
  openId: string | null;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** What went wrong with the last call to the saved chats, in words for staff. The next call that works clears it. */
  error: string | null;
  /** Opens a saved chat in place of the one on the screen. Does nothing while an answer is on its way. */
  openChat: (documentId: string) => Promise<void>;
  /** Deletes a saved chat at once. When it is the open chat, the chat on the screen is emptied. Does nothing while an answer is on its way. */
  deleteChat: (documentId: string) => Promise<void>;
}

export interface AssistantApi {
  /** null until GET /maison/assistant/status answers. */
  status: AssistantStatus | null;
  /** Whether the last check of the assistant failed and there is no status to show. */
  statusFailed: boolean;
  /** Whether the assistant is set up: the status says ready. */
  ready: boolean;
  messages: UIMessage[];
  /** Whether an answer is on its way. */
  busy: boolean;
  /** What went wrong with the last turn. The next send and New chat clear it. */
  notice: ErrorNotice | null;
  /** A line about how the last turn ended (stopped after 6 steps, or declined). Cleared the same way. */
  note: string | null;
  /** What staff have typed and not sent. It is kept here, so it is still there when staff come back from another tab. New chat leaves it alone. */
  draft: string;
  setDraft: (text: string) => void;
  /** Sends a message: from the text box (the default), which empties the box, or from a starter, which leaves it as it was. */
  send: (text: string, source?: MessageSource) => Promise<void>;
  /** Stops the answer where it is, and takes out a tool call that was being written. Stop is no error. */
  stop: () => void;
  /** Starts a new chat. The chat that was open stays saved, and the draft stays. */
  newChat: () => void;
  /** Asks /status again, for after the key was set. */
  recheck: () => Promise<void>;
  history: AssistantHistory;
}

const AssistantContext = React.createContext<AssistantApi | null>(null);

/** The assistant's chat, or null outside the provider: an admin without the permission to use the assistant has none. */
export const useAssistant = (): AssistantApi | null => React.useContext(AssistantContext);

const storedToken = (): string | null => {
  try {
    return localStorage.getItem('jwtToken');
  } catch {
    return null;
  }
};

const cookies = (): string => {
  try {
    return document.cookie;
  } catch {
    return '';
  }
};

/**
 * The chat, kept above the drawer. The drawer is closed and opened as staff please, and the chat, its saved chats and the text staff have
 * typed must be as they left them, so they are kept here and the drawer only reads them. This provider stays for as long as the assistant's
 * host is on the screen, which is every admin page (see assistantHost.tsx).
 *
 * It asks the server nothing until `started` is true, which is when staff open the drawer for the first time. It is on every admin page, and
 * the status check and the saved chats are only worth a request to staff who use the assistant.
 *
 * It also keeps the admin's saved chats. Each turn that ends saves the open chat, one save at a time (`createSaveQueue`), with only the
 * messages that were cleaned of cut-off tool calls and failed turns. When the assistant is ready, the list loads and the most recent chat
 * is reopened. A chat is switched with `setMessages`, never by changing the thread: that would build the chat client again.
 */
export const AssistantProvider = ({ children, started }: { children: React.ReactNode; started: boolean }) => {
  const fetchClient = useFetchClient();
  const mounted = useMounted();
  // useChat keeps its connection from the first render, and the save queue is made once, so both read the fetch client through a ref.
  const clientRef = React.useRef(fetchClient);
  clientRef.current = fetchClient;

  const [status, setStatus] = React.useState<AssistantStatus | null>(null);
  const [statusFailed, setStatusFailed] = React.useState(false);
  const [notice, setNotice] = React.useState<ErrorNotice | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  // The last question staff sent, so a failed turn can put it back in the box.
  const asked = React.useRef<SentQuestion | null>(null);
  // Set by onError, and settled when the chat is idle: by then the failed run's messages are in the chat.
  const [failedTurn, setFailedTurn] = React.useState<{ question: SentQuestion | null } | null>(null);

  const [chats, setChats] = React.useState<SavedChatRow[]>([]);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  // What the open chat held when it was last saved or opened, so it is saved again only when it has changed.
  const savedKey = React.useRef('');
  // Staff have started something (a message, New chat, another chat): the first load must not reopen the most recent chat over it.
  const acted = React.useRef(false);
  // The number of the latest request to open a chat. An answer that is not for the latest is dropped.
  const opening = React.useRef(0);

  const recheck = React.useCallback(async (): Promise<void> => {
    try {
      const { data } = await clientRef.current.get<unknown>(ASSISTANT_PATHS.status);
      if (!mounted.current) return;
      if (isStatus(data)) {
        setStatus(data);
        setStatusFailed(false);
        // A "not set up" notice from an earlier send is stale once the assistant is ready.
        setNotice((current) => noticeAfterStatus(current, data));
      } else {
        console.error('Maison assistant: the status check answered with something that is not a status.');
        setStatusFailed(true);
      }
    } catch (error) {
      // Staff read a fixed text (askTabState). What went wrong is written to the console.
      console.error('Maison assistant: the status check failed.', error);
      if (mounted.current) setStatusFailed(true);
    }
  }, [mounted]);

  // The first check of the assistant waits for the drawer to be opened. Once the status is known, the saved chats load (below).
  React.useEffect(() => {
    if (started) void recheck();
  }, [started, recheck]);

  const connection = React.useMemo(
    () =>
      fetchServerSentEvents(`${(globalThis as { strapi?: { backendURL?: string } }).strapi?.backendURL ?? ''}${ASSISTANT_PATHS.chat}`, async () => {
        // A stream needs a plain fetch, which Strapi doesn't refresh an expired admin token for. A call through its own client does,
        // so one goes first: the token read after it is the fresh one. If it fails, the chat request says what is wrong.
        try {
          await clientRef.current.get(ASSISTANT_PATHS.status);
        } catch {
          // Nothing to do here.
        }
        const token = adminTokenFrom({ stored: storedToken(), cookie: cookies(), cookieName: cookieName() });
        return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
      }),
    []
  );

  const chat = useChat({
    connection,
    // A message sent while an answer is on its way is dropped, never queued out of sight. Send and the Ask about this buttons wait instead.
    queue: 'drop',
    onError: (error: Error) => {
      // Stop ends the stream, and says nothing.
      if (error?.name === 'AbortError') return;
      setNotice(errorNotice(error));
      setFailedTurn({ question: asked.current });
      if ((error as { code?: unknown } | undefined)?.code === 'not_ready') void recheck();
    },
    onCustomEvent: (name: string) => setNote(customEventNote(name)),
  });

  const { sendMessage, stop: stopChat, clear, setMessages } = chat;
  const ready = status?.ready === true;
  const busy = chat.isLoading;

  // The handlers below read the chat as it is now, not as it was when they were made.
  const messagesRef = React.useRef(chat.messages);
  messagesRef.current = chat.messages;
  const busyRef = React.useRef(busy);
  busyRef.current = busy;

  /** The answer of a save, which must name the chat it saved. */
  const savedRow = (data: unknown): SavedChatRow => {
    if (!isSavedAnswer(data)) throw new Error('The answer was not a saved chat.');
    return data.conversation;
  };

  // The saves of the open chat, one at a time. Made once: it reads everything that changes through refs and stable setters.
  const [queue] = React.useState(() =>
    createSaveQueue({
      create: async (snapshot: ChatSnapshot) => savedRow((await clientRef.current.post<unknown>(CONVERSATION_PATHS.list, snapshot)).data),
      update: async (documentId: string, snapshot: ChatSnapshot) => savedRow((await clientRef.current.put<unknown>(CONVERSATION_PATHS.one(documentId), snapshot)).data),
      onSaved: (row, { current, replaced }) => {
        if (!mounted.current) return;
        // A chat that was saved again as a new one replaces the row of the chat that was gone.
        setChats((list) => withSavedChat(replaced === undefined ? list : withoutSavedChat(list, replaced), row));
        // A chat that staff have already left is not the open one: its row is in the list, and nothing else changes.
        if (current) setOpenId(row.documentId);
        setHistoryError(null);
      },
      onError: (_error, { current }) => {
        // What was being saved is not saved: the next save of this chat (a turn, or New chat) tries again.
        if (current) savedKey.current = '';
        if (mounted.current) setHistoryError(HISTORY_ERRORS.save);
      },
    })
  );

  /** Saves the chat on the screen, when it has something that was not saved yet. An empty chat is never saved. */
  const saveNow = React.useCallback(
    (messages: UIMessage[]) => {
      if (!needsSaving(messages, savedKey.current)) return;
      savedKey.current = savedKeyOf(messages);
      void queue.save({ title: conversationTitle(messages), messages });
    },
    [queue]
  );

  /** Takes out a tool call that was cut off (see withoutOpenToolCalls), so the chat never shows it as running and never replays it. */
  const dropOpenToolCalls = React.useCallback(() => {
    const current = messagesRef.current;
    const cleaned = withoutOpenToolCalls(current);
    if (cleaned !== current) setMessages(cleaned);
  }, [setMessages]);

  // Whenever nothing is answering, a tool call that was cut off is taken out, and a turn that failed with nothing to read is taken
  // back. This is the one place that holds after Stop, a dropped connection and a timeout alike: TanStack AI goes on processing the
  // chunks it already has after Stop, so a call taken out right after Stop can come back a moment later, and onError runs before
  // the messages of the failed run have reached this component. The same place saves the chat, with the cleaned messages: a turn that
  // ended, however it ended, leaves the chat saved. A chat that has not changed since it was saved is not saved again.
  const idle = !busy;
  React.useEffect(() => {
    if (!idle) return;
    let next = withoutOpenToolCalls(chat.messages);
    if (failedTurn) {
      setFailedTurn(null);
      const { question } = failedTurn;
      // A turn that failed before anything came back leaves the chat, and its question goes back to an empty box, so staff don't
      // retype it and a second try doesn't put the question in the chat twice. A starter's text is not put back.
      next = withoutFailedTurn(next);
      setDraft((current) => draftAfterFailure({ draft: current, question }));
    }
    if (next !== chat.messages) setMessages(next);
    saveNow(next);
  }, [idle, chat.messages, failedTurn, setMessages, saveNow]);

  /** Shows a chat: a saved one, or a new one (null with no messages). The queue, the saved key and the screen all change together. */
  const showChat = React.useCallback(
    (documentId: string | null, messages: UIMessage[]) => {
      queue.switchTo(documentId);
      savedKey.current = savedKeyOf(messages);
      setMessages(messages);
      setOpenId(documentId);
      setNotice(null);
      setNote(null);
      setFailedTurn(null);
    },
    [queue, setMessages]
  );

  const loadList = React.useCallback(async (): Promise<SavedChatRow[] | null> => {
    try {
      const { data } = await clientRef.current.get<unknown>(CONVERSATION_PATHS.list);
      if (!isChatList(data)) throw new Error('The answer was not a list of chats.');
      if (!mounted.current) return null;
      setChats(data.conversations);
      return data.conversations;
    } catch {
      if (mounted.current) setHistoryError(HISTORY_ERRORS.list);
      return null;
    }
  }, [mounted]);

  const openChat = React.useCallback(
    async (documentId: string): Promise<void> => {
      // Opening a chat in the middle of an answer would swap the messages under it.
      if (busyRef.current) return;
      acted.current = true;
      opening.current += 1;
      const request = opening.current;
      try {
        // Saves that are still on their way finish first, so the chat that is left behind is saved as it was.
        await queue.idle();
        const { data } = await clientRef.current.get<unknown>(CONVERSATION_PATHS.one(documentId));
        if (!isChatAnswer(data)) throw new Error('The answer was not a chat.');
        // Another chat was chosen, or a message was sent, while this one was on its way: the latest choice wins.
        if (!mounted.current || request !== opening.current || busyRef.current) return;
        showChat(documentId, data.conversation.messages as UIMessage[]);
        setHistoryError(null);
      } catch {
        if (!mounted.current) return;
        setHistoryError(HISTORY_ERRORS.open);
        // A chat that could not be opened may be gone: the list shows what is there.
        void loadList();
      }
    },
    [queue, showChat, loadList, mounted]
  );

  const deleteChat = React.useCallback(
    async (documentId: string): Promise<void> => {
      if (busyRef.current) return;
      acted.current = true;
      try {
        // Saves still on their way finish first: one that ran after the delete would find no chat to save into.
        await queue.idle();
        await clientRef.current.del(CONVERSATION_PATHS.one(documentId));
      } catch (error) {
        // A chat that is not there any more is deleted all the same.
        if (!isNotFound(error)) {
          if (mounted.current) setHistoryError(HISTORY_ERRORS.remove);
          return;
        }
      }
      if (!mounted.current) return;
      const wasOpen = queue.openId() === documentId;
      queue.forget(documentId);
      setChats((list) => withoutSavedChat(list, documentId));
      setHistoryError(null);
      if (wasOpen) {
        opening.current += 1;
        // A turn that began while the delete was on its way stays on the screen. Its save creates a new chat.
        if (busyRef.current) setOpenId(null);
        else showChat(null, []);
      }
    },
    [queue, showChat, mounted]
  );

  // When the assistant is ready for the first time, the list loads and the most recent chat is reopened, unless staff have begun something.
  const loadedFirst = React.useRef(false);
  React.useEffect(() => {
    if (!ready || loadedFirst.current) return;
    loadedFirst.current = true;
    void (async () => {
      const list = await loadList();
      if (list && list.length > 0 && !acted.current && messagesRef.current.length === 0) await openChat(list[0].documentId);
    })();
  }, [ready, loadList, openChat]);

  const send = React.useCallback(
    async (text: string, source: MessageSource = 'box'): Promise<void> => {
      // useChat would drop a send made while an answer is on its way. Nothing is changed for it: the box keeps its text.
      if (busyRef.current) return;
      acted.current = true;
      dropOpenToolCalls();
      asked.current = { text, source };
      setFailedTurn(null);
      setNotice(null);
      setNote(null);
      setDraft((current) => draftAfterSend(current, source));
      await sendMessage(text);
    },
    [sendMessage, dropOpenToolCalls]
  );

  const stop = React.useCallback(() => {
    stopChat();
    dropOpenToolCalls();
  }, [stopChat, dropOpenToolCalls]);

  const newChat = React.useCallback(() => {
    acted.current = true;
    opening.current += 1;
    stopChat();
    // What is on the screen is saved first, so an answer that was stopped stays in its chat. A question with no answer yet is not part of it.
    saveNow(withoutFailedTurn(withoutOpenToolCalls(messagesRef.current)));
    queue.switchTo(null);
    savedKey.current = '';
    clear();
    setOpenId(null);
    setNotice(null);
    setNote(null);
    setFailedTurn(null);
    setHistoryError(null);
  }, [stopChat, clear, saveNow, queue]);

  const history = React.useMemo<AssistantHistory>(
    () => ({ chats, openId, sidebarOpen, setSidebarOpen, error: historyError, openChat, deleteChat }),
    [chats, openId, sidebarOpen, historyError, openChat, deleteChat]
  );

  const api = React.useMemo<AssistantApi>(
    () => ({
      status,
      statusFailed,
      ready,
      messages: chat.messages,
      busy,
      notice,
      note,
      draft,
      setDraft,
      send,
      stop,
      newChat,
      recheck,
      history,
    }),
    [status, statusFailed, ready, chat.messages, busy, notice, note, draft, send, stop, newChat, recheck, history]
  );

  return <AssistantContext.Provider value={api}>{children}</AssistantContext.Provider>;
};
