import type { Core, Modules } from '@strapi/strapi';
import { z } from '@strapi/utils';

import type { ErrorCode } from '../domain/tool-result';
import { describeIssues } from '../mcp/schemas';

type HandlerContext = Modules.MCP.McpHandlerContext;

/** The parts of a Maison MCP tool definition that the chat uses. */
export interface McpTool {
  name: string;
  description: string;
  auth: { policies: ReadonlyArray<{ action: string }> };
  resolveInputSchema?: (context: HandlerContext) => z.ZodObject<z.ZodRawShape>;
  createHandler: (
    strapi: Core.Strapi,
    context: HandlerContext
  ) => (params: { args: any; extra: Modules.MCP.McpCapabilityHandlerContext }) => Promise<unknown>;
}

/** A Maison MCP tool as the staff assistant offers it: a name, a description, a Zod schema and a function. */
export interface ChatTool {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  /** The admin permission the chat checks before it offers the tool to the signed-in admin. */
  action: string;
  execute: (args: unknown) => Promise<unknown>;
}

export interface ChatToolError {
  error: { code: ErrorCode; message: string; hint: string };
}

type HandlerResult = { isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent?: unknown };

/**
 * The chat calls execute(args, strapi) with no admin user or ability, and no Maison handler reads the MCP handler
 * context: every createHandler takes only strapi, and the schema resolvers ignore it. A unit test keeps it that way.
 */
const NO_CONTEXT = { userAbility: undefined, user: { id: 0 } } as unknown as HandlerContext;

const invalidInput = (tool: McpTool, error: z.ZodError): ChatToolError => ({
  error: { code: 'invalid_input', message: describeIssues(error), hint: `Call ${tool.name} again with arguments that match its schema.` },
});

/** One MCP tool as a chat tool: the same schema, permission and handler, with the MCP result unwrapped. */
export const toChatTool = (strapi: Core.Strapi, tool: McpTool): ChatTool => {
  const schema = tool.resolveInputSchema?.(NO_CONTEXT) ?? z.object({});
  return {
    name: tool.name,
    description: tool.description,
    schema,
    action: tool.auth.policies[0].action,
    async execute(args) {
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) return invalidInput(tool, parsed.error);
      const result = (await tool.createHandler(strapi, NO_CONTEXT)({ args: parsed.data, extra: {} })) as HandlerResult;
      if (result.isError) return JSON.parse(result.content[0].text) as ChatToolError;
      return result.structuredContent;
    },
  };
};
