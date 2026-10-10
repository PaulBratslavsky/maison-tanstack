import { vi } from 'vitest';
import { UID } from '../../server/src/constants';
import conversationsController from '../../server/src/controllers/conversations';
import conversationsService from '../../server/src/services/conversations';
import { matches } from './fake-filters';
import { fakeStrapi } from './fake-strapi';

/*
 * What the tests of the saved chats share: the Document Service as a small table for the conversation content type, a Koa context with
 * Strapi's error helpers, and the service and controller wired over them.
 */

export type Doc = Record<string, any>;

/** A message as the page saves it: TanStack AI's UIMessage. */
export const staffMessage = (id: string, content: string): Doc => ({ id, role: 'user', parts: [{ type: 'text', content }] });
export const assistantMessage = (id: string, content: string): Doc => ({ id, role: 'assistant', parts: [{ type: 'text', content }] });
export const CHAT: Doc[] = [staffMessage('u1', 'Which visits are waiting?'), assistantMessage('a1', 'Two visits wait.')];

/**
 * The conversation rows, as the database holds them, and the Document Service over them. A create or an update stamps `updatedAt` with a
 * clock that moves one second each time, so "newest first" is a real order. It keeps every call, by method.
 */
export const fakeTable = (initial: Doc[] = []) => {
  const rows = new Map<string, Doc>(initial.map((row) => [row.documentId, row]));
  let clock = Date.parse('2026-10-07T00:00:00.000Z');
  let nextId = 1;
  const stamp = () => new Date((clock += 1000)).toISOString();
  const calls: Array<{ method: string; params: Doc }> = [];

  /** The row as a read answers it: with `fields`, those and the ones Strapi always gives. */
  const pick = (row: Doc, fields?: string[]): Doc => {
    const keep = fields ? ['id', 'documentId', ...fields] : null;
    return keep ? Object.fromEntries(Object.entries(row).filter(([key]) => keep.includes(key))) : { ...row };
  };

  const documents = (uid: string) => {
    if (uid !== UID.conversation) throw new Error(`These tests only hold the conversation content type, not ${uid}.`);
    const record = <T>(method: string, params: Doc, answer: T): T => {
      calls.push({ method, params });
      return answer;
    };
    return {
      findMany: async (params: Doc) => {
        const found = [...rows.values()].filter((row) => matches(row, params.filters));
        // Newest first when sorted on updatedAt desc, which is the only sort the service asks for.
        if (JSON.stringify(params.sort) === JSON.stringify({ updatedAt: 'desc' })) found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        else if (params.sort !== undefined) throw new Error(`These tests don't know the sort ${JSON.stringify(params.sort)}.`);
        const limited = found.slice(0, params.limit ?? found.length);
        return record('findMany', params, limited.map((row) => pick(row, params.fields)));
      },
      findFirst: async (params: Doc) => {
        const found = [...rows.values()].find((row) => matches(row, params.filters));
        return record('findFirst', params, found ? pick(found, params.fields) : null);
      },
      create: async ({ data }: Doc) => {
        const at = stamp();
        const row = { id: nextId, documentId: `chat-${nextId}`, ...data, createdAt: at, updatedAt: at };
        nextId += 1;
        rows.set(row.documentId, row);
        return record('create', { data }, { ...row });
      },
      update: async ({ documentId, data }: Doc) => {
        // Strapi's update answers null for a document that is not there, and creates nothing.
        const found = rows.get(documentId);
        if (!found) return record('update', { documentId, data }, null);
        const row = { ...found, ...data, updatedAt: stamp() };
        rows.set(documentId, row);
        return record('update', { documentId, data }, { ...row });
      },
      delete: async ({ documentId }: Doc) => {
        rows.delete(documentId);
        return record('delete', { documentId }, { documentId, entries: [] });
      },
    };
  };

  return { rows, documents, calls, called: (method: string) => calls.filter((call) => call.method === method) };
};

/** A row as the database holds a saved chat of an admin. */
export const savedRow = (documentId: string, adminUserId: number, fields: Doc = {}): Doc => ({
  id: Number(documentId.replace(/\D/g, '') || 0),
  documentId,
  title: 'Which visits are waiting?',
  messages: { v: 1, messages: CHAT },
  adminUserId,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  ...fields,
});

/** Strapi's error helpers on a Koa context, and the status each one sets. */
const ERROR_HELPERS = { badRequest: 400, unauthorized: 401, notFound: 404 };

/** Enough of a Koa context for the saved chats' controller: the signed-in admin, the route's params and body, and Strapi's error helpers. */
export const fakeCtx = ({ admin = 7, params = {}, body }: { admin?: number | null; params?: Doc; body?: unknown } = {}) => {
  const ctx: Doc = { state: admin === null ? {} : { user: { id: admin } }, params, request: { body }, status: 200, body: undefined };
  for (const [helper, status] of Object.entries(ERROR_HELPERS)) {
    ctx[helper] = vi.fn((message?: string, details?: unknown) => {
      ctx.status = status;
      ctx.body = { error: { message, details } };
    });
  }
  return ctx;
};

/** The saved chats' service and controller over a table of rows. */
export const chatsWorld = (initial: Doc[] = []) => {
  const table = fakeTable(initial);
  const services: Doc = {};
  const strapi = fakeStrapi({ services, documents: table.documents as never });
  services.conversations = conversationsService({ strapi });
  const controller = conversationsController({ strapi });
  return { ...table, strapi, controller, service: services.conversations as ReturnType<typeof conversationsService> };
};
