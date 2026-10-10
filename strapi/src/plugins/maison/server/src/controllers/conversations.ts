import type { Core } from '@strapi/strapi';

import type { ServiceFailure } from '../domain/service-result';
import type { SaveInput } from '../services/conversations';

/** What a body that is not an object is, for the service to refuse. */
const asBody = (body: unknown): SaveInput => (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {});

/** The signed-in admin's id, or null: the route's policy lets only signed-in admins through, so null is not expected. */
const adminOf = (ctx): number | null => (typeof ctx.state?.user?.id === 'number' ? ctx.state.user.id : null);

/**
 * A handler for the signed-in admin. It is given the admin's id, which is the only way a handler gets it: from the session, never from the
 * request. A request with no admin is a 401, so no handler can forget to check.
 */
const forAdmin = (handler: (ctx, admin: number) => unknown) => async (ctx) => {
  const admin = adminOf(ctx);
  if (admin === null) return ctx.unauthorized();
  return handler(ctx, admin);
};

/** The service's failure in Strapi's error body: 404 for a chat that is not there, 400 for a body that cannot be saved. */
const fail = (ctx, { code, message, hint }: ServiceFailure) => (code === 'not_found' ? ctx.notFound(message, { code, hint }) : ctx.badRequest(message, { code, hint }));

/**
 * The Ask tab's saved chats: list, open, save, save again and delete. The routes are for admins who hold assistant.use, and every one is for
 * the signed-in admin's own chats: the admin comes from the session, never from the request, and a chat that belongs to someone else is a 404.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const conversations = () => strapi.plugin('maison').service('conversations');

  return {
    /** GET /conversations: `{ conversations: [{ documentId, title, updatedAt }] }`, newest first. */
    list: forAdmin(async (ctx, admin) => {
      ctx.body = { conversations: await conversations().list(admin) };
    }),

    /** GET /conversations/:documentId: `{ conversation }` with its messages. */
    findOne: forAdmin(async (ctx, admin) => {
      const result = await conversations().view(admin, ctx.params.documentId);
      if (result.ok === false) return fail(ctx, result);
      ctx.body = { conversation: result.value };
    }),

    /** POST /conversations, with `{ title, messages }`: saves a new chat. */
    create: forAdmin(async (ctx, admin) => {
      const result = await conversations().create(admin, asBody(ctx.request.body));
      if (result.ok === false) return fail(ctx, result);
      ctx.status = 201;
      ctx.body = { conversation: result.value };
    }),

    /** PUT /conversations/:documentId, with `{ title, messages }`, either or both: saves the chat again. */
    update: forAdmin(async (ctx, admin) => {
      const result = await conversations().update(admin, ctx.params.documentId, asBody(ctx.request.body));
      if (result.ok === false) return fail(ctx, result);
      ctx.body = { conversation: result.value };
    }),

    /** DELETE /conversations/:documentId: deletes the chat at once. */
    remove: forAdmin(async (ctx, admin) => {
      const result = await conversations().remove(admin, ctx.params.documentId);
      if (result.ok === false) return fail(ctx, result);
      ctx.body = result.value;
    }),
  };
};
