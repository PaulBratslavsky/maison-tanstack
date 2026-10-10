import { z } from '@strapi/utils';

import { httpError } from '../domain/http-result';
import type { ErrorCode } from '../domain/tool-result';
import { describeIssues } from '../mcp/schemas';

/** The parts of a Koa context the REST routes answer through. */
export interface ReplyContext {
  status: number;
  body: unknown;
  set(field: string, value: string): void;
}

/** A failure, with its status and the code, message and hint the MCP tool would return. Every 401 asks for a Bearer token. */
export const replyFailure = (ctx: ReplyContext, { code, message, hint }: { code: ErrorCode; message: string; hint?: string }) => {
  const { status, body } = httpError(code, message, hint);
  ctx.status = status;
  if (status === 401) ctx.set('WWW-Authenticate', 'Bearer');
  ctx.body = body;
};

/** A success: the same data the matching MCP tool returns as structured content. */
export const replyValue = (ctx: ReplyContext, value: unknown, status = 200) => {
  ctx.status = status;
  ctx.body = value;
};

/**
 * `raw` parsed with a shared schema, or undefined after answering 400 invalid_input with the schema's own messages.
 * Over MCP the SDK rejects the same input before a tool runs, so there's no tool hint to repeat.
 */
export const parseOrReply = <T extends z.ZodType>(ctx: ReplyContext, schema: T, raw: unknown): z.output<T> | undefined => {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  replyFailure(ctx, { code: 'invalid_input', message: describeIssues(parsed.error) });
  return undefined;
};
