import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { Session } from './session';
import { tunnelHeaders } from './tunnel';

export interface ToolCallRecord {
  id: number;
  screen: string;
  name: string;
  args: Record<string, unknown>;
  result: CallToolResult | null;
  error: string | null;
  ms: number;
  at: string;
}

export interface ToolError {
  code: string;
  message: string;
  hint: string;
}

/** The `{ error: { code, message, hint } }` a Maison tool returns with isError, or null for a success. */
export const toolErrorOf = (
  result: CallToolResult | null
): ToolError | null => {
  if (!result?.isError) return null;
  const item = result.content?.find((content) => content.type === 'text');
  const text = item && item.type === 'text' ? item.text : '';
  try {
    const parsed = JSON.parse(text);
    if (parsed?.error?.code) return parsed.error as ToolError;
  } catch {
    // not JSON: fall through
  }
  // Arguments the MCP SDK's schema check rejects, such as a date that isn't on the calendar, come back as plain text.
  if (text.startsWith('Input validation error'))
    return { code: 'invalid_input', message: text, hint: '' };
  return { code: 'error', message: text || 'The tool failed.', hint: '' };
};

type Connection = Pick<Client, 'callTool' | 'close'>;
type Connect = (token: string) => Promise<Connection>;

/** A connection and the number of calls in flight on it. Once replaced, it is closed as soon as none are left. */
interface Lease {
  client: Connection;
  active: number;
  retired: boolean;
}

const connectTo =
  (strapiUrl: string): Connect =>
  async (token) => {
    const client = new Client({ name: 'maison-app', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${strapiUrl}/mcp`), {
        requestInit: {
          headers: { Authorization: `Bearer ${token}`, ...tunnelHeaders(strapiUrl) },
        },
      })
    );
    return client;
  };

const isUnauthorized = (error: unknown) =>
  error instanceof StreamableHTTPError && error.code === 401;

/**
 * The screens' MCP connection to Strapi. Every call is recorded for the agent view.
 * A 401 (the session expired or was revoked) triggers one new token exchange and one retry.
 * Calls that get their 401 together share that one exchange and reconnect. If it is refused they all fail with that
 * refusal, a call whose 401 lands later included: none starts a second exchange.
 */
export const createMcp = ({
  strapiUrl,
  session,
  onRecord,
  connect = connectTo(strapiUrl),
}: {
  strapiUrl: string;
  session: Session;
  onRecord: (record: ToolCallRecord) => void;
  connect?: Connect;
}) => {
  /**
   * The newest connection, or the newest attempt to open one. An attempt that failed stays here, flagged in `failed`,
   * until a call that starts afterwards replaces it: calls that got their 401 on the connection it replaced share
   * that failure.
   */
  let connection: Promise<Lease> | null = null;
  const failed = new WeakSet<Promise<Lease>>();
  let nextId = 1;

  const close = async (lease: Lease) => {
    try {
      await lease.client.close();
    } catch {
      // already closed
    }
  };

  const retire = (lease: Lease) => {
    if (lease.retired) return;
    lease.retired = true;
    if (lease.active === 0) void close(lease);
  };

  const open = (renew: boolean): Promise<Lease> => {
    const opened: Promise<Lease> = (
      renew ? session.refresh() : session.getToken()
    )
      .then(async (token) => ({
        client: await connect(token),
        active: 0,
        retired: false,
      }))
      .catch((error) => {
        failed.add(opened);
        throw error;
      });
    return opened;
  };

  /** The connection for a call that starts now: the newest, or a new one when the newest failed to open. */
  const getConnection = (): Promise<Lease> => {
    if (!connection || failed.has(connection)) connection = open(false);
    return connection;
  };

  /**
   * The connection to retry on after a 401 on `stale`. The first call to notice exchanges a new token and
   * reconnects; calls that got their 401 on the same connection join that reconnect instead of making their own,
   * and so do calls whose 401 lands after it was replaced again. If the reconnect failed, they share that failure
   * rather than exchanging again: it stays in `connection` until a call that starts afterwards starts over.
   * The stale connection is closed once no call is still in flight on it: closing it sooner makes the MCP SDK
   * reject those calls with "Connection closed" instead of their own 401, so they would never be retried.
   */
  const renewConnection = (stale: Promise<Lease>): Promise<Lease> => {
    if (connection && connection !== stale) return connection;
    const renewed = open(true);
    connection = renewed;
    stale.then(retire, () => {}); // a connection that never opened has nothing to close
    return renewed;
  };

  const invoke = async (
    lease: Lease,
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> => {
    lease.active++;
    try {
      return (await lease.client.callTool({
        name,
        arguments: args,
      })) as CallToolResult;
    } finally {
      lease.active--;
      if (lease.retired && lease.active === 0) void close(lease);
    }
  };

  const callTool = async (
    screen: string,
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<CallToolResult> => {
    const started = performance.now();
    const record = (result: CallToolResult | null, error: string | null) => {
      try {
        onRecord({
          id: nextId++,
          screen,
          name,
          args,
          result,
          error,
          ms: Math.round(performance.now() - started),
          at: new Date().toISOString(),
        });
      } catch {
        // A listener that throws must not change how the call ended, such as a booking that went through.
      }
    };
    let result: CallToolResult;
    try {
      const used = getConnection();
      try {
        result = await invoke(await used, name, args);
      } catch (error) {
        if (!isUnauthorized(error)) throw error;
        result = await invoke(await renewConnection(used), name, args);
      }
    } catch (error) {
      record(null, (error as Error).message);
      throw error;
    }
    record(result, null); // outside the try, so a failure while recording can't record the call a second time
    return result;
  };

  return { callTool };
};
