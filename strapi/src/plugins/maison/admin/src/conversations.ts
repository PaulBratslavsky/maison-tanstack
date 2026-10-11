/**
 * What the assistant decides about its saved chats, apart from React: the routes, the shape of the answers, a chat's title, how the list
 * changes when a chat is saved or deleted, when a chat needs saving, and the queue that saves them one at a time. The provider reads these,
 * and the unit tests hold them.
 */
// Intl.Segmenter is ES2022. The admin's base tsconfig may declare less, but every browser Strapi's admin supports has it.
/// <reference lib="es2022.intl" />
import type { MessageLike, PartLike } from './assistant';

/** The saved chats' routes, served under /maison. A unit test holds them to the server's. */
export const CONVERSATION_PATHS = {
  list: '/maison/conversations',
  one: (documentId: string): string => `/maison/conversations/${encodeURIComponent(documentId)}`,
} as const;

/** What the sidebar lists of a chat. */
export interface SavedChatRow {
  documentId: string;
  title: string;
  updatedAt: string;
}

/** A chat as it is opened: its row, and its messages exactly as they were saved. */
export interface SavedChat extends SavedChatRow {
  messages: unknown[];
}

/** What staff read when a call to the saved chats fails. Each says what could not be done, and none repeats the server's text. */
export const HISTORY_ERRORS = {
  list: "Couldn't load your saved chats.",
  open: "Couldn't open that chat.",
  save: "Couldn't save this chat.",
  remove: "Couldn't delete that chat.",
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const isSavedRow = (value: unknown): value is SavedChatRow =>
  isRecord(value) && typeof value.documentId === 'string' && value.documentId !== '' && typeof value.title === 'string' && typeof value.updatedAt === 'string';

/** `GET /conversations`: `{ conversations: [row, ...] }`. */
export const isChatList = (value: unknown): value is { conversations: SavedChatRow[] } => isRecord(value) && Array.isArray(value.conversations) && value.conversations.every(isSavedRow);

/** `GET /conversations/:documentId`: `{ conversation: { ...row, messages } }`. */
export const isChatAnswer = (value: unknown): value is { conversation: SavedChat } =>
  isRecord(value) && isSavedRow(value.conversation) && Array.isArray((value.conversation as unknown as SavedChat).messages);

/** `POST /conversations` and `PUT /conversations/:documentId`: `{ conversation: row }`. */
export const isSavedAnswer = (value: unknown): value is { conversation: SavedChatRow } => isRecord(value) && isSavedRow(value.conversation);

const MAX_TITLE = 80;

/**
 * The first `max` characters of `text` as people see them. One character can be several code points: an emoji with a skin tone, a family
 * emoji joined by zero-width joiners, a flag, or a Japanese character with a separate voiced mark. Each is kept whole or left out.
 */
const firstCharacters = (text: string, max: number): string => {
  let kept = '';
  let count = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (count === max) break;
    kept += segment;
    count += 1;
  }
  return kept;
};

/**
 * A chat's title: its first staff message, on one line, cut to 80 characters (characters as people see them, so an emoji, a flag or a
 * Japanese character with its mark is never split), or "New chat" when there is none. The server cuts a title the same way, and a unit test holds the two to each other.
 */
export const conversationTitle = (messages: readonly MessageLike[]): string => {
  const first = messages.find((message) => message.role === 'user');
  const text = first
    ? (first.parts as readonly PartLike[])
        .filter((part) => part.type === 'text' && typeof part.content === 'string')
        .map((part) => part.content as string)
        .join(' ')
    : '';
  const line = text.replace(/\s+/g, ' ').trim();
  return line === '' ? 'New chat' : firstCharacters(line, MAX_TITLE);
};

/** The list with `row` at the top: a chat that was just saved is the newest, and appears once. */
export const withSavedChat = (list: readonly SavedChatRow[], row: SavedChatRow): SavedChatRow[] => [row, ...list.filter((chat) => chat.documentId !== row.documentId)];

/** The list without a chat that was deleted. */
export const withoutSavedChat = (list: readonly SavedChatRow[], documentId: string): SavedChatRow[] => list.filter((chat) => chat.documentId !== documentId);

/** What a chat holds, as one string, to tell whether it has changed since it was last saved or opened. */
export const savedKeyOf = (messages: readonly unknown[]): string => JSON.stringify(messages);

/** Whether a chat needs saving: it has messages, and they are not what was last saved or opened. An empty chat is never saved. */
export const needsSaving = (messages: readonly unknown[], savedKey: string): boolean => messages.length > 0 && savedKeyOf(messages) !== savedKey;

/** What is saved of a chat: its title and its messages. */
export interface ChatSnapshot {
  title: string;
  messages: unknown[];
}

export interface SaveQueueDeps {
  create: (snapshot: ChatSnapshot) => Promise<SavedChatRow>;
  update: (documentId: string, snapshot: ChatSnapshot) => Promise<SavedChatRow>;
  /** A save went through. `current` is whether the chat it saved is still the open one: staff may have started another since. */
  onSaved: (row: SavedChatRow, info: { created: boolean; current: boolean; replaced?: string }) => void;
  /** A save failed. The queue goes on with the next. `current` is whether the chat it was saving is still the open one. */
  onError: (error: unknown, info: { current: boolean }) => void;
}

export interface SaveQueue {
  /** The saved chat that is open, or null for a chat that has not been saved yet. */
  openId: () => string | null;
  /** The open chat is now another one: a saved chat (its ID), or a new chat (null). A save still waiting goes on to the chat it was made for. */
  switchTo: (documentId: string | null) => void;
  /** Saves the open chat, after every save made before this one. The first save of a new chat creates it, and the later ones update it. */
  save: (snapshot: ChatSnapshot) => Promise<void>;
  /** Resolves when every save made so far is over. */
  idle: () => Promise<void>;
  /** A chat was deleted: nothing is saved into it again. When it is the open chat, the next save creates a new one. */
  forget: (documentId: string) => void;
}

/** Whether an error from Strapi's fetch client is a 404: the chat is not there any more (deleted elsewhere, or cleared by Reset demo activity). */
export const isNotFound = (error: unknown): boolean => isRecord(error) && error.status === 404;

/**
 * The saves of the open chat, one at a time, in order. Two saves that ran side by side would each find that the chat has no ID yet and
 * each create it, and one chat would be in the list twice (strapi-plugin-tanstack-ai had exactly that bug). So every save waits for the one
 * before it, and a save reads the chat's ID when it runs, after the save before it has created the chat.
 *
 * A save belongs to the chat that was open when it was made. Staff may start another chat before it runs, and it still goes to the first.
 * What a create answers is adopted as the open chat's ID only while that chat is still the open one.
 */
export const createSaveQueue = (deps: SaveQueueDeps): SaveQueue => {
  // Each chat that has been open has a number. `ids` holds the ID of each that is saved.
  let current = 0;
  const ids = new Map<number, string>();
  let tail: Promise<void> = Promise.resolve();

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    const run = tail.then(job);
    // The job catches what it throws, so this only keeps the chain going whatever happens.
    tail = run.catch(() => {});
    return run;
  };

  return {
    openId: () => ids.get(current) ?? null,

    switchTo(documentId) {
      current += 1;
      if (documentId !== null) ids.set(current, documentId);
    },

    save(snapshot) {
      const chat = current;
      return enqueue(async () => {
        const create = async (replaced?: string) => {
          const row = await deps.create(snapshot);
          ids.set(chat, row.documentId);
          deps.onSaved(row, { created: true, current: chat === current, ...(replaced === undefined ? {} : { replaced }) });
        };
        try {
          const documentId = ids.get(chat);
          if (documentId === undefined) return await create();
          try {
            const row = await deps.update(documentId, snapshot);
            deps.onSaved(row, { created: false, current: chat === current });
          } catch (error) {
            if (!isNotFound(error)) throw error;
            // The chat was deleted elsewhere. What staff have is saved again, as a new chat.
            ids.delete(chat);
            await create(documentId);
          }
        } catch (error) {
          deps.onError(error, { current: chat === current });
        }
      });
    },

    idle: () => tail,

    forget(documentId) {
      for (const [chat, id] of ids) if (id === documentId) ids.delete(chat);
    },
  };
};
