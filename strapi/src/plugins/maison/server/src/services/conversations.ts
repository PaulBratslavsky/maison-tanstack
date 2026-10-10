// Intl.Segmenter is ES2022. Strapi's base tsconfig only declares ES2020, but every Node that Strapi 5 runs on has it.
/// <reference lib="es2022.intl" />
import type { Core } from '@strapi/strapi';

import { readStoredMessages, toStoredMessages, type StoredMessages } from '../assistant/stored-messages';
import { SAVED_CHATS, UID } from '../constants';
import { failure, type ServiceResult } from '../domain/service-result';

/** What the sidebar lists of a chat: no messages, so a long history stays a short answer. */
export interface SavedChatRow {
  documentId: string;
  title: string;
  updatedAt: string;
}

/** A chat as the page opens it. */
export interface SavedChat extends SavedChatRow {
  createdAt: string;
  messages: StoredMessages['messages'];
}

/** What the page saves: the title is cut to its limit, and the messages are checked. */
export interface SaveInput {
  title?: unknown;
  messages?: unknown;
}

const NO_CHAT = 'There is no saved chat with that ID.';
const NO_CHAT_HINT = 'Reload the page: it may have been deleted.';
const NOT_SAVED = 'This chat could not be saved.';
const NOT_SAVED_HINT = 'Start a new chat and try again.';

/** A title's words on one line, or an empty string when it is not text or has no words. */
const wordsOf = (title: unknown): string => (typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '');

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
 * The title staff see in the sidebar: the words on one line, cut to its limit by characters as people see them, so an emoji, a flag or a
 * Japanese character with its mark is never split. A title with no words is "New chat": only a chat that is saved the first time is given
 * that, and `update` refuses such a title.
 */
export const cutTitle = (title: unknown): string => {
  const text = wordsOf(title);
  return text === '' ? 'New chat' : firstCharacters(text, SAVED_CHATS.titleChars);
};

/**
 * The Ask tab's saved chats. Every method takes the admin it is for, and answers only for that admin's own chats: a chat that belongs to
 * someone else is answered as one that is not there (`not_found`), the same words as for an ID nobody has, so the answer never confirms
 * that it exists.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const documents = () => strapi.documents(UID.conversation);

  /**
   * The chat, when this admin owns it, in one query on the ID and the admin together. A chat that belongs to someone else and an ID nobody
   * has then take the same path and cost the same work. With `fields`, only those are read: update and remove need the ID, and not the
   * messages, which can be up to 1 MB.
   */
  const owned = (adminId: number, documentId: string, fields?: string[]) =>
    documents().findFirst({ filters: { documentId: { $eq: documentId }, adminUserId: { $eq: adminId } }, ...(fields ? { fields } : {}) });

  const summary = (row: any): SavedChatRow => ({ documentId: row.documentId, title: row.title, updatedAt: row.updatedAt });

  return {
    /** The admin's chats, newest first, at most 100. */
    async list(adminId: number): Promise<SavedChatRow[]> {
      const rows = (await documents().findMany({
        filters: { adminUserId: { $eq: adminId } },
        fields: ['title', 'updatedAt'],
        sort: { updatedAt: 'desc' },
        limit: SAVED_CHATS.listRows,
      })) as any[];
      return rows.map(summary);
    },

    /** One chat with its messages. A stored value that cannot be read opens as an empty chat, and the log says which one. */
    async view(adminId: number, documentId: string): Promise<ServiceResult<SavedChat>> {
      const row: any = await owned(adminId, documentId);
      if (!row) return failure('not_found', NO_CHAT, NO_CHAT_HINT);
      const { messages, error } = readStoredMessages(row.messages);
      if (error) strapi.log.warn(`[maison] Saved chat ${documentId} has messages that can't be read (${error}), so it opens empty. The stored value is left as it is.`);
      return { ok: true, value: { ...summary(row), createdAt: row.createdAt, messages } };
    },

    /** Saves a new chat for the admin. The admin is the one signed in, whatever the body says. */
    async create(adminId: number, input: SaveInput): Promise<ServiceResult<SavedChatRow>> {
      const stored = toStoredMessages(input.messages);
      if (!stored.ok) return failure('invalid_input', NOT_SAVED, NOT_SAVED_HINT);
      const row = await documents().create({ data: { title: cutTitle(input.title), messages: stored.value as never, adminUserId: adminId } });
      return { ok: true, value: summary(row) };
    },

    /**
     * Saves a chat the admin owns again: the title, the messages, or both. A body with neither, a title that is not text or has no words,
     * or messages that are not a chat is refused (`invalid_input`), and nothing is written. Whether the chat is theirs is decided first, so
     * a chat that is not theirs is a 404 whatever the body holds.
     */
    async update(adminId: number, documentId: string, input: SaveInput): Promise<ServiceResult<SavedChatRow>> {
      if (!(await owned(adminId, documentId, ['documentId']))) return failure('not_found', NO_CHAT, NO_CHAT_HINT);
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) {
        if (wordsOf(input.title) === '') return failure('invalid_input', NOT_SAVED, NOT_SAVED_HINT);
        data.title = cutTitle(input.title);
      }
      if (input.messages !== undefined) {
        const stored = toStoredMessages(input.messages);
        if (!stored.ok) return failure('invalid_input', NOT_SAVED, NOT_SAVED_HINT);
        data.messages = stored.value;
      }
      if (Object.keys(data).length === 0) return failure('invalid_input', NOT_SAVED, NOT_SAVED_HINT);
      const row = await documents().update({ documentId, data: data as never });
      // The chat can be deleted after the check and before this write (another tab, or Reset demo activity). Strapi's update answers null then.
      if (!row) return failure('not_found', NO_CHAT, NO_CHAT_HINT);
      return { ok: true, value: summary(row) };
    },

    /** Deletes a chat the admin owns, at once. */
    async remove(adminId: number, documentId: string): Promise<ServiceResult<{ documentId: string }>> {
      if (!(await owned(adminId, documentId, ['documentId']))) return failure('not_found', NO_CHAT, NO_CHAT_HINT);
      await documents().delete({ documentId });
      return { ok: true, value: { documentId } };
    },
  };
};
