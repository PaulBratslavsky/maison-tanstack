import { Readable } from 'node:stream';

import type { Core } from '@strapi/strapi';

import { withoutKey } from '../assistant/errors';
import { getConfig } from '../config';
import { ASSISTANT_LIMITS } from '../constants';
import { countStaffMessages, thrownText } from '../services/assistant';

/**
 * What chatParamsFromRequestBody says when the body is no run input. Its error is an AGUIError, which has no name of its
 * own to tell it by, and @ag-ui/core is not a dependency of this plugin, so the check is on the SDK's own sentence. The
 * bad-body tests run the real parser, so an SDK that rewords it fails them. Any other error is not the browser's fault.
 */
const BAD_BODY = /is not a valid AG-UI RunAgentInput/;
const isBadBody = (error: unknown): boolean => error instanceof Error && BAD_BODY.test(error.message);

/**
 * The Ask tab: whether the assistant is ready, and one chat turn, streamed. Both routes are for admins who hold
 * assistant.use. What each tool may read is checked again inside the turn, against the admin's own role.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const assistant = () => strapi.plugin('maison').service('assistant');

  /**
   * Sends the service's answer as server-sent events. Koa can't send a web stream: without the Node stream the browser
   * gets `{}`. The headers keep a proxy from buffering the stream or compressing it, which would show as a slow model.
   */
  const send = (ctx, response: Response) => {
    if (!response.body) return ctx.internalServerError('The assistant gave no answer.');
    ctx.status = 200;
    ctx.set('Content-Type', 'text/event-stream; charset=utf-8');
    ctx.set('Cache-Control', 'no-cache, no-transform');
    ctx.set('Connection', 'keep-alive');
    ctx.set('X-Accel-Buffering', 'no');
    ctx.body = Readable.fromWeb(response.body as never);
  };

  return {
    /**
     * GET /assistant/status: `{ ready: true, model, tools }`, or `{ ready: false, reason }`. `tools` is `{ name, label }` for each tool
     * this admin's chat gets. Never the key.
     */
    async status(ctx) {
      ctx.body = assistant().statusFor(ctx.state.userAbility ?? { can: () => false });
    },

    /**
     * POST /assistant/chat: one turn. The browser sends the whole history each time (an AG-UI run input). Not ready and a
     * chat that is too long are 200 event streams with one RUN_ERROR, because ai-client 0.39 never reads the body of an
     * HTTP error (a 401 body is read only to look for a BYOK marker). Only a body that is no run input is a real error, a 400.
     */
    async chat(ctx) {
      if (assistant().status().ready === false) return send(ctx, await assistant().errorResponse('not_ready'));

      let params;
      try {
        params = await assistant().parseBody(ctx.request.body);
      } catch (error) {
        if (isBadBody(error)) return ctx.badRequest((error as Error).message);
        // Not the browser's fault, such as an SDK that could not be loaded: the text can hold file paths. Staff get the plain
        // error as an event stream, and the original goes to Strapi's log once.
        strapi.log.error(withoutKey(`[maison] The assistant could not read a chat request: ${thrownText(error)}`, getConfig(strapi).aiApiKey));
        return send(ctx, await assistant().errorResponse('internal'));
      }

      if (countStaffMessages(params.messages) > ASSISTANT_LIMITS.staffMessages) return send(ctx, await assistant().errorResponse('chat_too_long'));

      // Aborted only when the response closes before it ends: a closed tab, or Stop. The service stops the model call then.
      const responseController = new AbortController();
      const stopIfClosed = () => {
        if (!ctx.res.writableEnded) responseController.abort();
      };
      ctx.res.once('close', stopIfClosed);
      // The close event fires once. A browser that left while the body was being read has already fired it.
      if (ctx.res.destroyed) stopIfClosed();

      return send(
        ctx,
        await assistant().turn(params, {
          ability: ctx.state.userAbility ?? { can: () => false },
          adminId: ctx.state.user?.id ?? null,
          responseController,
        })
      );
    },
  };
};
