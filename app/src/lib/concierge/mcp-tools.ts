// Server only: it holds the customer's own Authorization header, which the browser's copy of this file must never have.
// The marker import makes TanStack Start's import protection fail the build when the client bundle reaches this file.
import '@tanstack/react-start/server-only';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinition, type JSONSchema } from '@tanstack/ai';

import { SURFACE_HEADER } from './instructions';

/**
 * The concierge's MCP connection to Strapi, on `@modelcontextprotocol/sdk`, and Strapi's tools as TanStack AI server
 * tools. It is not `@tanstack/ai-mcp`: that package turns an `isError` result into a thrown Error with flat text, and
 * the chat's tool lines, rule 6 (follow the hint) and the automatic hand-off all read the `{ error: { code, message,
 * hint } }` a Maison tool gives.
 */

/**
 * The only tools the model is offered, by name. Anything else the server lists is left out: the booking tool
 * (the customer books in the visit picker, which calls request_appointment with their own session), log_inquiry (the
 * app's own call after a turn: the log says what happened, not what the model says), Strapi's dev-only `log` tool and
 * any tool a later version adds. The route can still call any of them on the connection.
 */
export const CUSTOMER_TOOLS = ['browse_collections', 'search_products', 'view_product', 'find_boutiques', 'search_knowledge', 'my_appointments', 'hand_off_to_staff'] as const;

/** The headers every call to Strapi carries: the customer's own, and the surface. Nothing else. */
const headersFor = (authorization: string) => ({ Authorization: authorization, [SURFACE_HEADER]: 'concierge' });

/** The transport a real run uses: MCP over HTTP to Strapi. Tests give `createTransport` an in-memory one in its place. */
export const httpTransport = (url: URL, headers: Record<string, string>): Transport => new StreamableHTTPClientTransport(url, { requestInit: { headers } });

/** The parts of the MCP client the app uses. */
export type McpConnection = Pick<Client, 'callTool' | 'listTools' | 'close'>;

/** The result of a Maison tool call, whole: `content`, `structuredContent` and `isError` as Strapi gave them. */
export type McpResult = Awaited<ReturnType<Client['callTool']>>;

/**
 * One of Strapi's tools as a TanStack AI server tool. Its `inputSchema` is the tool's JSON Schema as Strapi lists it.
 * `chat()` does not check input against a plain JSON Schema (it checks only Standard Schemas such as zod's), so the input
 * goes to Strapi as the model sent it, and Strapi's own check answers a bad one with an isError result. The result is
 * returned whole and never thrown for `isError`, so the model and the chat read `{ error: { code, message, hint } }`.
 */
const asServerTool = (client: McpConnection, listed: McpTool) =>
  toolDefinition({
    name: listed.name,
    description: listed.description ?? '',
    inputSchema: listed.inputSchema as JSONSchema,
  }).server(
    (input, context): Promise<McpResult> =>
      client.callTool({ name: listed.name, arguments: (input ?? {}) as Record<string, unknown> }, undefined, context?.abortSignal ? { signal: context.abortSignal } : undefined)
  );

/** One of Strapi's tools, as `chat()` takes it. */
export type McpServerTool = ReturnType<typeof asServerTool>;

export interface OpenMcpOptions {
  /** Where the app's server reaches Strapi (`STRAPI_URL`). */
  strapiUrl: string;
  /** The customer's `Authorization` header, as the request brought it. Passed on unchanged. */
  authorization: string;
  /** Makes the transport. Tests give an in-memory one. Defaults to HTTP. */
  createTransport?: (url: URL, headers: Record<string, string>) => Transport;
}

export interface MaisonMcp {
  /**
   * The connection, for the route's own calls: log_inquiry after a turn, find_boutiques for choose_visit's check, and
   * close. Every tool of the customer's session can be called on it, the ones the model is not offered included.
   */
  client: McpConnection;
  /** The tools the model is offered, in Strapi's order. */
  tools: McpServerTool[];
  /** The name of every tool Strapi listed for this session, the ones the model is not offered included: log_inquiry is there only when the token may call it. */
  listed: string[];
  /** Closes the connection. The route does it when the request is over, always. */
  close: () => Promise<void>;
}

/**
 * Opens an MCP client to Strapi with the customer's own header and `x-maison-surface: concierge`, lists its tools and
 * turns each customer tool into a server tool. Rejects when Strapi cannot be reached (the route answers 502).
 */
export const openMcp = async ({ strapiUrl, authorization, createTransport = httpTransport }: OpenMcpOptions): Promise<MaisonMcp> => {
  const client = new Client({ name: 'maison-concierge', version: '1.0.0' });
  await client.connect(createTransport(new URL('mcp', strapiUrl.replace(/\/*$/, '/')), headersFor(authorization)));
  try {
    const { tools } = await client.listTools();
    const allowed: readonly string[] = CUSTOMER_TOOLS;
    return {
      client,
      tools: tools.filter((tool) => allowed.includes(tool.name)).map((tool) => asServerTool(client, tool)),
      listed: tools.map((tool) => tool.name),
      close: () => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
};
