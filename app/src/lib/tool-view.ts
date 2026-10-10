import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { COPY } from './copy';
import { toolErrorOf } from './mcp';
import type { Appointment, Locale, ProductCard } from './types';
import { CHOOSE_VISIT, visitPickerOutputOf } from './visit-picker';

/**
 * What the chat needs from a call: TanStack AI's `tool-call` part, with its fields under the names the rules use. A call
 * has a `state`: `awaiting-input`, `input-streaming` and `input-complete` while it has no result (a client tool, as
 * choose_visit is, waits in `input-complete` for the customer), then `complete` with its `output`, or `error`.
 */
export interface ToolPart {
  toolName: string;
  /** The call's id: the visit picker hands its answer to the chat by it (addToolResult). */
  toolCallId?: string;
  state: string;
  /** What the model sent the tool, once the whole call is in. */
  input?: unknown;
  /** The result, parsed: for a Maison tool, the MCP result (`content`, `structuredContent`, `isError`). */
  output?: unknown;
  /** Why the call ended in an error (its state is `error`): the `{ error }` its output holds. */
  errorText?: string;
}

/**
 * A message part as a tool call, or null when it isn't one. Every tool, Maison's and the concierge's own, is a `tool-call`
 * part carrying its name. TanStack AI also keeps a `tool-result` part beside each call: that is not a second call.
 */
export const toolPartOf = (part: { type: string }): ToolPart | null => {
  if (part.type !== 'tool-call') return null;
  const call = part as { id?: unknown; name?: unknown; state?: unknown; input?: unknown; output?: unknown };
  const state = typeof call.state === 'string' ? call.state : 'awaiting-input';
  const failure = state === 'error' && call.output !== null && typeof call.output === 'object' ? (call.output as { error?: unknown }).error : undefined;
  return {
    toolName: typeof call.name === 'string' ? call.name : '',
    ...(typeof call.id === 'string' ? { toolCallId: call.id } : {}),
    state,
    ...(call.input === undefined ? {} : { input: call.input }),
    ...(call.output === undefined ? {} : { output: call.output }),
    ...(typeof failure === 'string' ? { errorText: failure } : {}),
  };
};

/** The concierge's own tools. They aren't Maison tools, so their lines say "Local", not "MCP". */
const LOCAL_TOOLS = ['resolve_date', CHOOSE_VISIT];

/** What `resolve_date` returned, for its line: the weekday and date the model was given. */
const resolvedDay = (output: unknown): string | null => {
  const day = output as { date?: unknown; weekday?: unknown } | null;
  return typeof day?.date === 'string' && typeof day.weekday === 'string' ? `${day.weekday} ${day.date}` : null;
};

/** What a local tool's line says after its ✓: the day resolve_date worked out, or the customer's answer to the visit picker. */
const localAnswer = (part: ToolPart): string | null =>
  part.toolName === CHOOSE_VISIT ? (visitPickerOutputOf(part.output)?.status ?? null) : resolvedDay(part.output);

/** The visit an answered picker requested: request_appointment's own appointment, which the picker handed the chat. */
const pickedVisit = (part: ToolPart): Appointment | null => {
  const answer = part.state === 'complete' ? visitPickerOutputOf(part.output) : null;
  return answer?.status === 'requested' ? answer.appointment : null;
};

/** The line of the request_appointment call the picker made in the browser, which isn't in the conversation: under the picker's own. */
const PICKER_REQUEST_LINE = 'MCP · request_appointment ✓';

/**
 * What a call gave back: whether it failed (it broke on the way, or Maison refused it with an isError result), and,
 * when it came back whole, the result's structuredContent.
 */
const outcomeOf = (part: ToolPart) => {
  const output = part.state === 'complete' ? (part.output as CallToolResult | null) : null;
  const error = output ? toolErrorOf(output) : null;
  const failed = part.state === 'error' || error !== null;
  const data = output && !error ? (output.structuredContent as Record<string, unknown> | undefined) : undefined;
  return { error, failed, data };
};

/** Whether a call is over, with its result or failed. One that isn't may still change what the chat shows. */
const finished = (part: ToolPart) => part.state === 'complete' || part.state === 'error';

/** A question Strapi recorded for Maison's client advisors: the reference it gave, and the question that was sent. */
export interface RecordedHandOff {
  reference: string;
  question: string;
}

/**
 * What Strapi recorded, for a call that handed a question to the advisors and went through; null for any other call, one
 * that is running, broke on the way or was refused, and a result with no reference. Two calls do:
 * - hand_off_to_staff, the model's own: the reference is read from the result's structuredContent (question.reference)
 *   and nowhere else, and the question from what the model sent, which Strapi checked before it recorded it.
 * - search_knowledge, when it found nothing and the app's server handed the question to staff itself (withAutoHandOff in
 *   lib/concierge/): the reference and the question are read from the result's structuredContent.handOff, which only
 *   that code adds. The question is the customer's own message, as the app sent it to Strapi.
 * The reference is what says the question is with the advisors. The question comes without the spaces and line breaks
 * around it: it is typed into the LINE chat.
 */
const recordedBy = (part: ToolPart): RecordedHandOff | null => {
  if (part.state !== 'complete') return null;
  const recordedAs = (reference: unknown, question: unknown): RecordedHandOff | null =>
    typeof reference !== 'string' || reference === '' ? null : { reference, question: typeof question === 'string' ? question.trim() : '' };
  if (part.toolName === 'search_knowledge') {
    const handOff = outcomeOf(part).data?.handOff as { reference?: unknown; question?: unknown } | null | undefined;
    return recordedAs(handOff?.reference, handOff?.question);
  }
  if (part.toolName !== 'hand_off_to_staff') return null;
  const reference = (outcomeOf(part).data?.question as { reference?: unknown } | null | undefined)?.reference;
  return recordedAs(reference, (part.input as { question?: unknown } | null | undefined)?.question);
};

/**
 * What a tool call shows in the chat, built from its structuredContent, never from the model's text: its line ("MCP ·
 * search_products ✓ 5 results", "Local · resolve_date ✓ Saturday 2026-10-10", "Local · choose_visit" while the picker
 * waits for the customer, "Local · choose_visit ✓ requested", "… ✕ boutique_closed"), the products a search found, the
 * appointment a request made (request_appointment's, or the one the visit picker's answer carries, with `requestLine`
 * for the call the picker made), and the question a hand-off recorded: the model's own call to hand_off_to_staff, or the
 * app's, which a search that found nothing carries (handOffAt decides where a message's note goes).
 */
export const toolView = (part: ToolPart, locale: Locale) => {
  const t = COPY[locale];
  const local = LOCAL_TOOLS.includes(part.toolName);
  const { error, failed, data } = outcomeOf(part);
  const list = Object.values(data ?? {}).find(Array.isArray) as unknown[] | undefined;
  const answer = local && !failed ? localAnswer(part) : null;
  // A picker whose call came in whole waits for the customer, not for a result: no mark, as "…" reads like loading.
  const status =
    part.toolName === CHOOSE_VISIT && part.state === 'input-complete'
      ? ''
      : !finished(part)
        ? '…'
        : failed
          ? `✕ ${error?.code ?? 'error'}`
          : `✓${answer ? ` ${answer}` : list ? ` ${t.results(list.length)}` : ''}`;
  const appointment =
    part.toolName === 'request_appointment' ? ((data?.appointment as Appointment | undefined) ?? null) : part.toolName === CHOOSE_VISIT ? pickedVisit(part) : null;
  return {
    line: `${local ? 'Local' : 'MCP'} · ${part.toolName}${status ? ` ${status}` : ''}`,
    failed,
    products: part.toolName === 'search_products' && Array.isArray(data?.products) ? (data.products as ProductCard[]) : null,
    appointment,
    requestLine: part.toolName === CHOOSE_VISIT && appointment ? PICKER_REQUEST_LINE : null,
    handOff: recordedBy(part),
  };
};

/** Where a message's hand-off note goes, and which note it is (handOffAt). */
export type HandOffPlace =
  | { index: number; kind: 'recorded'; recorded: RecordedHandOff }
  | { index: number; kind: 'empty_search' | 'failed_hand_off'; recorded: null };

/**
 * Where a message's hand-off note goes, and which note it is: `index`, in its parts, of the part it goes under, and
 * `kind`; or null for no note. There is one note a message, and the first of these that applies decides:
 * - `recorded`: under the first call that handed the question to the advisors and went through, whatever the searches
 *   found: a hand_off_to_staff the model made, or a search_knowledge that found nothing and the app's server handed off
 *   itself (its result's `handOff`, which is why the note shows at once, with no call after the search for it to wait
 *   for). `recorded` is what Strapi recorded, so the note names the question's reference, and its button sends the
 *   question in the LINE chat.
 * - No note while a hand_off_to_staff is still running. It may yet go through, and the plain note would show under the
 *   search or the failure and then be replaced by the recorded one.
 * - `empty_search`: under the last search_knowledge, if it came back whole with no entries and nothing was recorded for
 *   it. The app's server hands such a question off itself, so this is when that failed (Strapi refused it, or the token
 *   can't hand questions off) or couldn't be made.
 * - `failed_hand_off`: under the last hand_off_to_staff, which failed: it broke on the way, Maison refused it, or its
 *   result has no reference to show.
 * The last two are the plain note, with `recorded` null: it says only where the team answers, never that the question is
 * with the advisors, and it leaves the customer the LINE chat, so they can always reach a person.
 *
 * The conditions below are the empty search's alone; a hand-off that went through or failed needs none. It shows only
 * when no search in the message found entries (the question may be answered) and none is still running (a note that
 * showed while a second search was under way would vanish when that one found the answer). The last search decides: an
 * earlier one that failed or was refused doesn't count, because rule 6 has the model fix its arguments and search again,
 * and the local model makes bad first calls. A last search that failed or was refused has no note of its own, and a
 * failed hand-off may.
 */
export const handOffAt = (parts: ReadonlyArray<{ type: string }>): HandOffPlace | null => {
  const calls = parts.flatMap((part, index) => {
    const tool = toolPartOf(part);
    return tool ? [{ index, tool }] : [];
  });
  for (const { index, tool } of calls) {
    const recorded = recordedBy(tool);
    if (recorded) return { index, kind: 'recorded', recorded };
  }
  const handOffs = calls.filter(({ tool }) => tool.toolName === 'hand_off_to_staff');
  if (handOffs.some(({ tool }) => !finished(tool))) return null;
  const searches = calls.filter(({ tool }) => tool.toolName === 'search_knowledge');
  const last = searches.at(-1);
  /** The entries a search found: undefined unless it came back whole with a list of them. */
  const entriesOf = ({ tool }: (typeof calls)[number]) => {
    const entries = outcomeOf(tool).data?.entries;
    return Array.isArray(entries) ? entries : undefined;
  };
  const foundEntries = searches.some((search) => (entriesOf(search)?.length ?? 0) > 0);
  const running = searches.some(({ tool }) => !finished(tool));
  if (last && !foundEntries && !running && entriesOf(last)?.length === 0) return { index: last.index, kind: 'empty_search', recorded: null };
  // None went through and none is running, so every hand-off here failed.
  const failed = handOffs.at(-1);
  return failed ? { index: failed.index, kind: 'failed_hand_off', recorded: null } : null;
};
