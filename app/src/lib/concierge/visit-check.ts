import type { ChatMiddleware } from '@tanstack/ai';

import type { Locale } from '../types';
import type { McpConnection } from './mcp-tools';
import { PIECES_CHECK_TIMEOUT_MS, notFoundOf } from './turn';
import { CHOOSE_VISIT } from '../visit-picker';

/**
 * choose_visit's check of its pieces, as a chat middleware. The call names pieces by slug, and the picker asks
 * find_boutiques for them: Strapi refuses that whole call (not_found) for a piece it doesn't know, which would leave a
 * form with no boutiques that Try again can't mend. So the server makes the same call first, `find_boutiques({
 * productSlugs, locale })` on the customer's own session, and when Strapi answers not_found it refuses the model's call
 * with Strapi's message and hint: the model reads them, looks the piece up and calls again (rule 6). Only not_found
 * refuses. Anything else lets the call through: no find_boutiques for this token, a refusal the model can't put right, a
 * call that breaks, one the customer cut short, or one that takes longer than `timeoutMs`. The form then makes its own
 * find_boutiques call and shows its own error, with Try again, only if that fails too.
 *
 * Why `onToolPhaseComplete` and not `onBeforeToolCall`, which the plan named: @tanstack/ai 0.68 never runs
 * `onBeforeToolCall` for a client tool (a tool with no function to run). `executeToolCalls` (activities/chat/tools/
 * tool-calls.js) sets such a call aside as `needsClientExecution` and goes on to the next call, before it reaches the
 * hook. `onToolPhaseComplete` does run for it, with the pending calls, before the engine asks the browser to answer
 * them (`processToolCalls` in activities/chat/index.js reads `needsClientExecution` after the hook). The engine reads the
 * `results` and `needsClientExecution` lists of the hook's `info` argument after the hook, and they are the lists it
 * holds, so a refusal is the call taken out of `needsClientExecution` and its error put into `results`: the engine then
 * gives the model the error and goes on, as for any tool that failed, and the browser is never asked to answer it. The
 * hook's type says it returns nothing, so this relies on how 0.68 works. visit-check.test.ts holds it on the real
 * `chat()` and the real `ChatClient`, and fails first when an upgrade changes it.
 */
export const chooseVisitCheck = ({
  client,
  locale,
  timeoutMs = PIECES_CHECK_TIMEOUT_MS,
}: {
  /** The route's MCP connection: the customer's own session. */
  client: Pick<McpConnection, 'callTool'>;
  /** The chat's language: the pieces' names in the error. */
  locale: Locale;
  timeoutMs?: number;
}): ChatMiddleware => {
  /** Strapi's reason when it doesn't know a piece (find_boutiques' not_found), or null when it knows them all or the check couldn't tell. */
  const unknownPieces = async (productSlugs: string[], runSignal: AbortSignal | undefined): Promise<string | null> => {
    try {
      const signal = AbortSignal.any([...(runSignal ? [runSignal] : []), AbortSignal.timeout(timeoutMs)]);
      return notFoundOf(await client.callTool({ name: 'find_boutiques', arguments: { productSlugs, locale } }, undefined, { signal }));
    } catch {
      return null;
    }
  };

  return {
    name: 'choose-visit-check',
    onToolPhaseComplete: async (ctx, info) => {
      const pending = info.needsClientExecution.filter((call) => call.toolName === CHOOSE_VISIT);
      if (pending.length === 0) return;
      const reasons = await Promise.all(
        pending.map((call) => {
          const slugs = (call.input as { productSlugs?: unknown } | null)?.productSlugs;
          return Array.isArray(slugs) && slugs.every((slug) => typeof slug === 'string') ? unknownPieces(slugs, ctx.signal) : null;
        })
      );
      pending.forEach((call, index) => {
        const reason = reasons[index];
        if (reason === null) return;
        info.needsClientExecution.splice(info.needsClientExecution.indexOf(call), 1);
        // An error result, as the engine makes one for a tool that fails: `{ error }` with the state output-error.
        info.results.push({ toolCallId: call.toolCallId, toolName: call.toolName, result: { error: reason }, input: call.input, state: 'output-error', duration: 0 } as (typeof info.results)[number]);
      });
    },
  };
};
