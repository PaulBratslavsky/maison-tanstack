import { handOffAt } from './tool-view';
import { isPickerAwaitingAnswer, requestedVisitOf } from './visit-picker';

/** What the chat needs from a message part: its text (`content`), or the tool call it records (TanStack AI's `tool-call` part). */
interface ChatPart {
  type: string;
  content?: unknown;
  /** The tool's name, on a tool-call part. */
  name?: string;
  state?: string;
  output?: unknown;
}

/** What the chat needs from a message to tell whether the concierge answered. */
interface ChatMessage {
  role: string;
  parts: ReadonlyArray<ChatPart>;
}

/** The parts the screen shows: text with something in it, and tool calls. Not the tool-result part kept beside a call, nor thinking. */
const shown = (part: ChatPart) => (part.type === 'text' ? typeof part.content === 'string' && part.content.trim() !== '' : part.type === 'tool-call');

/**
 * Whether a part is a request_appointment call that may have booked a visit. Only Maison's refusal says it didn't: an
 * MCP error result (isError) that came back. A result without one is a booking. A call with no result, or one that failed
 * on the way (state `error`), can't be told from a booking that went through, so it counts as one.
 */
const mayHaveBooked = (part: ChatPart): boolean => {
  if (part.type !== 'tool-call' || part.name !== 'request_appointment') return false;
  const refused = part.state === 'complete' && (part.output as { isError?: unknown } | null | undefined)?.isError === true;
  return !refused;
};

/**
 * Whether the last reply ended with nothing to read: no text, or tool calls and no words after them. The local model
 * sometimes makes its tool calls and then returns nothing, which would leave the customer looking at chips. It isn't
 * so while a reply is still coming in, nor when the customer spoke last. A reply that ends in words, even "Let me look
 * that up", can't be told from an answer this way: the customer's next message carries on from it.
 *
 * Nor is it so when the reply holds a booking that went through, or may have. Asking again drops the reply, booking
 * included, and sends the customer's yes again, so the model would book the visit a second time: Maison has no duplicate
 * check, only a cap of 3 open requests. The call's chip (and the visit's card) shows what happened, and the customer can
 * still write.
 *
 * Nor when the reply holds a visit picker that waits for the customer, or the visit one requested (lib/visit-picker.ts):
 * asking again would drop the picker, or ask for the reply after a booking again, and book twice. A choose_visit call
 * the reply was cut off in (still input-streaming, with no reply coming in) never shows a form, so it gets Try again.
 *
 * Nor when the chat shows the reply's hand-off note (handOffAt in lib/tool-view.ts), under a hand-off that went through
 * (the model's call, or the one the app made for a search that found nothing) or, when nothing was recorded, under a
 * search that found nothing: the note and the LINE chat button are the answer, so a reply that ends there, with no words
 * after it, isn't empty. The plain note under a hand-off that failed is no answer: the failure may be a passing one, so
 * "Try again" stays until words follow. With no note (a search that found entries, a last search that failed or hasn't
 * finished, or a hand-off that hasn't finished) nothing has answered.
 */
export const needsRetry = (messages: readonly ChatMessage[], busy: boolean): boolean => {
  if (busy) return false;
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return false;
  if (last.parts.some(mayHaveBooked)) return false;
  if (last.parts.some((part) => isPickerAwaitingAnswer(part) || requestedVisitOf(part) !== null)) return false;
  const note = handOffAt(last.parts);
  if (note && note.kind !== 'failed_hand_off') return false;
  const end = last.parts.filter(shown).at(-1);
  return end?.type !== 'text';
};
