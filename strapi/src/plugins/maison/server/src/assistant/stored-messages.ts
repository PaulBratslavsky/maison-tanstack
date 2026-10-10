import { z } from '@strapi/utils';

/**
 * What a saved chat's `messages` field holds, and the check that keeps it so. The field is JSON, so Strapi stores whatever it is given and
 * checks nothing: without this the stored shape would be whatever the page sent, and a bad body would corrupt a chat that nothing can read
 * back. Adapted from strapi-plugin-tanstack-ai 1.6.0 (`stored-messages.ts`), with three rules kept:
 * - A versioned envelope, `{ v: 1, messages }`, so a later change of the shape can be told from this one.
 * - A part this version does not know is kept, not refused: dropping it would damage the chat for a version that does.
 * - Reading is total. A stored value that cannot be read gives no messages and an error to log, and never throws: a damaged chat costs
 *   staff that chat, not the page.
 *
 * It differs from the reference in one place that matters: every part is a loose object, so it keeps every key it has. The page sends the
 * whole history back to the model each turn, thinking parts with their signatures included, and Anthropic refuses a history whose signed
 * thinking block was changed. The reference can store less because its server sends the model text only.
 */

export const STORAGE_VERSION = 1;

const textPart = z.looseObject({ type: z.literal('text'), content: z.string() });
const thinkingPart = z.looseObject({ type: z.literal('thinking'), content: z.string() });
const toolCallPart = z.looseObject({ type: z.literal('tool-call'), id: z.string(), name: z.string() });
const toolResultPart = z.looseObject({ type: z.literal('tool-result'), toolCallId: z.string() });
/** Any part the page sends now or later. Kept as it is. */
const otherPart = z.looseObject({ type: z.string() });

const uiMessageSchema = z.looseObject({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.union([textPart, thinkingPart, toolCallPart, toolResultPart, otherPart])),
});

const storedMessagesSchema = z.object({ v: z.literal(STORAGE_VERSION), messages: z.array(uiMessageSchema) });

export type StoredMessages = z.infer<typeof storedMessagesSchema>;

/**
 * Server TypeScript is not strict, so a union is not narrowed by `if (!result.ok)`: this is one interface with optional fields, which
 * the compiler follows.
 */
interface ToStoredResult {
  ok: boolean;
  value?: StoredMessages;
  error?: string;
}

/** The messages the page sent, checked and wrapped for storage. */
export const toStoredMessages = (messages: unknown): ToStoredResult => {
  const checked = storedMessagesSchema.safeParse({ v: STORAGE_VERSION, messages });
  if (checked.success) return { ok: true, value: checked.data };
  const issue = checked.error.issues[0];
  return { ok: false, error: issue ? `${issue.path.join('.') || 'messages'}: ${issue.message}` : 'invalid messages' };
};

/** What is stored, as messages for the page. Total: a value that cannot be read gives no messages, and `error` says why. */
export const readStoredMessages = (stored: unknown): { messages: StoredMessages['messages']; error?: string } => {
  if (stored === null || stored === undefined) return { messages: [] };
  const checked = storedMessagesSchema.safeParse(stored);
  if (checked.success) return { messages: checked.data.messages };
  return { messages: [], error: `unrecognised shape: ${checked.error.issues[0]?.message ?? 'unknown'}` };
};
