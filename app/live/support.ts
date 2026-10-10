import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { StreamProcessor, type StreamChunk, type UIMessage } from '@tanstack/ai';

import { requireLocalMode, strapiOrigin } from '../e2e/env';
import { handOffAt } from '../src/lib/tool-view';

// Local mode only, and Strapi on this machine: in LINE mode VITE_STRAPI_URL is the tunnel.
requireLocalMode();
/** Where the tests reach Strapi: STRAPI_URL from app/.env, the same setting the app's server reads. */
export const STRAPI_URL = strapiOrigin();

/** Whether anything answers a GET to `url` within two seconds (any status counts). */
export const reachable = async (url: string): Promise<boolean> => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
};

/** Where Ollama listens: OLLAMA_BASE_URL, else its default. The same as `conciergeModel` (lib/concierge/model.ts) reads. */
export const ollamaHost = (env: Record<string, string | undefined> = process.env) => env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

/** Ollama answers /api/version at its root. */
export const ollamaUp = () => reachable(new URL('/api/version', ollamaHost()).toString());

export const strapiUp = () => reachable(`${STRAPI_URL}/_health`);

/** The `data:` events of a server-sent event stream, parsed. Untyped on purpose: a check reads an event by the field it looks for. */
export const sseEvents = (text: string): Array<Record<string, any>> =>
  text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((data) => data && data !== '[DONE]')
    .flatMap((data) => {
      try {
        return [JSON.parse(data)];
      } catch {
        return [];
      }
    });

/** A tool call in a turn, in the order the model made it. */
export interface Call {
  id: string;
  name: string;
  /** What the model sent the tool, parsed. */
  input: Record<string, any>;
  /** What the tool returned, parsed: a Maison tool's whole MCP result (`content`, `structuredContent`), resolve_date's own object. None for a call nobody answered (choose_visit waits for the customer). */
  output: Record<string, any> | undefined;
}

/** What one request's stream holds, as the page would show it. */
export interface Turn {
  events: Array<Record<string, any>>;
  /** The messages the turn made, built by the processor `ChatClient` uses. The conversation sent with the request is not among them. */
  messages: UIMessage[];
  /** Every tool call, in order. */
  calls: Call[];
  /** Everything the concierge said, in order. */
  words: string;
  /** For a failure's message: the calls the turn made, and what the concierge said. */
  trace: string;
}

/**
 * Reads a turn's AG-UI events the way the page does: through a `StreamProcessor`, which turns text, tool calls and tool
 * results into UI messages (a result becomes the call's `output`). The snapshot of the conversation at the start is left
 * out, as handle.ts leaves it out of its own record: it holds the customer's messages, which are no part of the turn.
 */
export const readTurn = (events: Array<Record<string, any>>): Turn => {
  const processor = new StreamProcessor();
  for (const event of events) if (event.type !== 'MESSAGES_SNAPSHOT') processor.processChunk(event as StreamChunk);
  const messages = processor.getMessages().filter((message) => message.role === 'assistant');
  const parts = messages.flatMap((message) => message.parts);
  const calls = parts.flatMap((part): Call[] => {
    if (part.type !== 'tool-call') return [];
    const call = part as { id: string; name: string; input?: unknown; output?: unknown };
    return [{ id: call.id, name: call.name, input: (call.input ?? {}) as Record<string, any>, output: call.output as Record<string, any> | undefined }];
  });
  const words = parts.map((part) => (part.type === 'text' ? part.content : '')).join('');
  const trace = `Tools: ${calls.map((call) => `${call.name}(${JSON.stringify(call.input)})`).join(', ')}. Reply: ${JSON.stringify(words)}`;
  return { events, messages, calls, words, trace };
};

/** The hand-off note the page shows for the turn, or null. The page places one note in each message, so it is the first any message has. */
export const handOffOf = (turn: Turn) => {
  for (const message of turn.messages) {
    const note = handOffAt(message.parts);
    if (note) return note;
  }
  return null;
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The calendar dates an English reply mentions, as YYYY-MM-DD in `year`: "October 3", "3 October", "3rd of October" and
 * 2026-10-03. A reply that says "Saturday, October 2" for a visit on the 3rd is caught by comparing these.
 */
export const datesIn = (text: string, year: number): string[] => {
  const dates: string[] = [];
  const add = (monthName: string, day: string) => {
    const month = MONTHS.findIndex((name) => name.startsWith(monthName.toLowerCase().slice(0, 3))) + 1;
    dates.push(`${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`);
  };
  for (const found of text.matchAll(new RegExp(`\\b${MONTH}\\b\\.?\\s+(\\d{1,2})(?!\\d)`, 'gi'))) add(found[1], found[2]);
  for (const found of text.matchAll(new RegExp(`(?<![\\d-])(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, 'gi'))) add(found[2], found[1]);
  dates.push(...(text.match(/\d{4}-\d{2}-\d{2}/g) ?? []));
  return dates;
};

/** The words that make a confirmation one still to come: "once it is confirmed", "it is confirmed once they reply". */
const STILL_TO_COME = String.raw`\b(?:once|when|whenever|after|as soon as|until|till|before|if|whether)\b`;
const STILL_TO_COME_BEFORE = new RegExp(STILL_TO_COME, 'i');
const ADVERBS = String.raw`(?:\s+(?:now|already|all|also|just|officially|fully))*`;
/** The word itself, unless a condition follows it: "is confirmed once the boutique accepts it". */
const CONFIRMED_WORD = String.raw`\s+confirmed\b(?!\s+(?:only\s+)?${STILL_TO_COME})`;
/**
 * A visit called confirmed, in English: "is confirmed", "it's confirmed", "has already been confirmed", "you're all
 * confirmed"; or someone saying they confirmed it: "I've confirmed", "the boutique has confirmed". Not the customer's
 * "you've confirmed" (their yes), nor "isn't confirmed" or "hasn't been confirmed".
 */
const CONFIRMED = new RegExp(
  String.raw`(?:\b(?:is|are|was|were)|['’](?:s|re)|(?:\b(?:has|have|had)|['’](?:s|ve|d))${ADVERBS}\s+been)${ADVERBS}${CONFIRMED_WORD}` +
    String.raw`|(?<!\byou)(?:['’]ve|\s+(?:have|has|had))${ADVERBS}${CONFIRMED_WORD}`,
  'gi'
);
/**
 * Where an English clause ends: a sentence or a line, a semicolon or a colon, or a comma with a new subject after it
 * ("After checking, your visit is confirmed"). A comma inside a clause, as in a date ("Saturday, October 3, is
 * confirmed"), doesn't end it.
 */
const CLAUSE_END = /[.!?;:\n]+|,\s*(?=(?:I|we|you|they|it|your|our|the|this|that|everything)\b)/i;
/** The same in Japanese: 確定しました, 確定いたしました, 確定です. Not 確定しましたら ("once it is"), nor 未確定 ("not yet"). */
const CONFIRMED_JA = /(?<![未不])確定(?:しました|いたしました|致しました|しております|しています|となりました|になりました|されました|済み|です)(?![らか])/;

/**
 * Whether a reply, in English or Japanese, says a visit is confirmed. A request is only requested: the boutique confirms
 * it, on LINE. A confirmation still to come is fine ("once it is confirmed", "when …", "after …", "as soon as …",
 * "until …", "it is confirmed once they reply", 確定しましたら, 確定次第), and so are "will confirm", "not yet confirmed"
 * and 未確定. A bare "Confirmed: Saturday at 2 pm" isn't caught.
 */
export const saysConfirmed = (text: string): boolean =>
  CONFIRMED_JA.test(text) ||
  text
    .split(CLAUSE_END)
    .some((clause) => [...clause.matchAll(CONFIRMED)].some((claim) => !STILL_TO_COME_BEFORE.test(clause.slice(0, claim.index))));

/** "I've requested", "we have placed", "I've sent your request": a speaker who says they made the request. Not "I haven't requested", and not "I've sent the details to the form". */
const REQUESTED_BY_SPEAKER =
  /\b(?:I|we)(?:['’]ve| have)?\s+(?:(?:just|already|now|successfully)\s+)*(?:(?:requested|booked|reserved|scheduled|submitted|arranged|placed)\b|(?:sent|made|filed|put in|set up)\s+(?:the|your|a|an)\s+(?:(?:visit|boutique|appointment)\s+)?(?:request|booking|reservation|appointment|visit)\b)/i;
/** "Your visit is requested", "your visit to Ginza on Saturday has been booked", "the request is all sent". */
const REQUESTED_STATE =
  /\b(?:visit|appointment|request|booking|reservation)\b[^.!?;:\n]{0,50}?\b(?:is|was|has\s+(?:(?:now|already)\s+)?been)\s+(?:(?:now|all|already|officially)\s+)*(?:requested|booked|reserved|scheduled|submitted|sent|placed)\b/i;
/** "You're booked for Saturday", "you have been booked in". */
const YOURE_BOOKED = /\byou(?:['’]re| are| have been|['’]ve been)\s+(?:(?:all|now|already)\s+)*booked\b/i;
/** A request still to come: "when you tap Send request", "once you send it". */
const REQUEST_STILL_TO_COME = /\b(?:once|when|whenever|after|as soon as|until|till|before|if|whether)\b/i;
/**
 * The same in Japanese: リクエストをお送りしました, ご予約いたしました, ご予約を承りました, ご予約が完了しました. Not
 * 送信しましたら ("once it is sent"), and not ご要望を承りました ("I have your wishes"), which claims no request.
 */
const REQUESTED_JA =
  /(?:リクエスト|予約|手配|送信|お送り|お取り|申し込み|受け付け|登録|確保)(?:を)?(?:いたしました|致しました|しました)(?![らか後])|(?:予約|リクエスト)(?:を|は|が)?(?:承りました|受け付けました|済み|完了(?:いたし|し)(?:ました|ております))|リクエストを送りました/;

/**
 * Whether a reply, in English or Japanese, says a visit is already requested or booked. Before the customer taps Send
 * request in the visit picker, nothing is: the model only shows the form. A clause about a request still to come is
 * fine ("the request is sent when you tap Send request", "once you send it"), and so are "tap Send request" and "I've
 * filled in Saturday at 2 pm". "Once you tap Send request, your request is sent" is caught: the comma starts a clause.
 */
export const saysRequested = (text: string): boolean =>
  REQUESTED_JA.test(text) ||
  text
    .split(CLAUSE_END)
    .some((clause) => !REQUEST_STILL_TO_COME.test(clause) && (REQUESTED_BY_SPEAKER.test(clause) || REQUESTED_STATE.test(clause) || YOURE_BOOKED.test(clause)));

/** The weekday names an English reply mentions ("Saturday", "Saturdays"), as written in WEEKDAYS. */
export const weekdaysIn = (text: string): string[] => WEEKDAYS.filter((name) => new RegExp(`\\b${name}s?\\b`, 'i').test(text));

/**
 * Strapi verifies ID tokens against the app's LINE verify mock. `npm run dev` runs it; if nothing answers on its port,
 * start one for this test run. Returns the function that stops it.
 */
export const ensureVerifyMock = async (): Promise<() => void> => {
  const url = `http://127.0.0.1:${process.env.MOCK_LINE_VERIFY_PORT || 4546}/verify`;
  if (await reachable(url)) return () => {};
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../scripts/mock-line-verify.mjs', import.meta.url))], { stdio: 'ignore', env: process.env });
  for (let attempt = 0; attempt < 50 && !(await reachable(url)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return () => child.kill();
};
