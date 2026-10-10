import { useChat } from '@tanstack/ai-react';
import type { ConnectionAdapter } from '@tanstack/ai-client';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { needsRetry } from '../lib/chat-retry';
import { conciergeConnection } from '../lib/chat-connection';
import { config } from '../lib/config';
import { chooseVisitDefinition } from '../lib/concierge/local-tools';
import { COPY } from '../lib/copy';
import { chatErrorOf, errorText } from '../lib/status';
import { tunnelHeaders } from '../lib/tunnel';
import { CHOOSE_VISIT, composerLocked, followScroll, livePickerOf, pickerWaitingOf } from '../lib/visit-picker';
import { AssistantParts, type PickerContext } from './chat-parts';
import { ErrorNote } from './error-note';
import { useMaison } from './maison-provider';
import { Spinner } from './spinner';

/** The space left above a visit picker's form when the conversation goes to its top: the list's own padding (p-5). */
const PICKER_TOP_GAP = 20;

/**
 * The client tools the chat answers itself: choose_visit, from the server's own definition (lib/concierge/local-tools.ts)
 * as a client tool with no function to run. Made once, so `useChat` is given the same list on every render.
 */
const CLIENT_TOOLS = [chooseVisitDefinition.client()];

/**
 * The concierge's conversation and its pinned bottom bar: what the concierge route puts inside a `fill` Screen (the
 * title bar is the Screen's). The customer's messages are black blocks on the right, the concierge's are plain text with
 * a mono line for each tool call, and the bar holds the suggestions above an underline field and a black Send.
 *
 * `useChat` (TanStack AI) streams the reply from `POST /api/concierge` (lib/chat-connection.ts). The visit picker is the
 * `choose_visit` client tool: its call waits for the customer, and the form's answer goes back with `addToolResult`, which
 * makes the chat continue once. That reply is a new message, and an empty one makes none.
 *
 * The composer and the suggestions are held (`locked`) while a reply streams, while a picker waits for its answer
 * (@tanstack/ai-client refuses a new message then), and while the picker's request is on its way. A reply that ended with
 * nothing to read offers Try again (needsRetry), which asks for the reply again with `reload`.
 *
 * `piece` is the piece the customer asked from, or null. `connection` is for a test; the page uses the route's.
 */
export function ConciergeChat({ piece, connection }: { piece: string | null; connection?: ConnectionAdapter }) {
  const { locale, maison } = useMaison();
  const t = COPY[locale];
  // The header's language switch can change the language at any time, and the session is renewed: the connection reads
  // all three when a message is sent (useChat keeps the connection it first got).
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const pieceRef = useRef(piece);
  pieceRef.current = piece;
  const maisonRef = useRef(maison);
  maisonRef.current = maison;
  const [chatConnection] = useState(
    () =>
      connection ??
      conciergeConnection({
        getToken: async () => {
          if (!maisonRef.current) throw new Error('The session has not started.');
          return maisonRef.current.session.getToken();
        },
        extraHeaders: () => tunnelHeaders(config.strapiUrl),
        read: () => ({ locale: localeRef.current, product: pieceRef.current }),
      })
  );

  const { messages, sendMessage, reload, addToolResult, status, error } = useChat({ connection: chatConnection, tools: CLIENT_TOOLS });
  const [draft, setDraft] = useState('');
  // A picker's request on its way: no message may move past the picker until it has its answer.
  const [pickerSending, setPickerSending] = useState(false);
  const busy = status === 'submitted' || status === 'streaming';
  const locked = composerLocked(busy, pickerSending, pickerWaitingOf(messages));
  const failure = error ? chatErrorOf(error) : null;
  // A reply that ended with nothing to read (tool calls, then no words): offer to ask again.
  const retry = needsRetry(messages, busy);

  // The conversation scrolls inside the screen. It follows the newest words as they stream in, until the customer
  // scrolls up to read; sending a message, or scrolling back to the end, makes it follow again. When a visit picker's
  // form appears, it goes to the form's top instead, once, and stays there while the form waits (followScroll).
  const conversation = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const placedPicker = useRef<string | null>(null);
  useEffect(() => {
    const list = conversation.current;
    if (!list) return;
    // Only the live picker shows its form (components/visit-picker.tsx).
    const form = list.querySelector<HTMLElement>('[data-testid="visit-picker"]');
    const { to, shown } = followScroll({ following: following.current, form: form ? livePickerOf(messages) : null, shown: placedPicker.current });
    placedPicker.current = shown;
    // Inside the conversation only, with the list's padding above the form: scrollIntoView could move LINE's whole page.
    if (to === 'picker' && form) list.scrollTop += form.getBoundingClientRect().top - list.getBoundingClientRect().top - PICKER_TOP_GAP;
    else if (to === 'end') list.scrollTop = list.scrollHeight;
  }, [messages, busy, error]);

  // The visit pickers: which one may send, and where the customer's answer goes: useChat's addToolResult, by the call's
  // id. Writing the answer makes the chat continue, once. The picker's request stays "on its way" until that is over.
  const picker: PickerContext = {
    live: livePickerOf(messages),
    busy,
    answer: (toolCallId, output) => {
      following.current = true;
      void addToolResult({ tool: CHOOSE_VISIT, toolCallId, output }).finally(() => setPickerSending(false));
    },
    onSending: setPickerSending,
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || locked) return;
    following.current = true;
    // A failed send is in `error`, which the page shows. The promise's own rejection has nothing more to say.
    sendMessage(trimmed).catch(() => {});
    setDraft('');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };

  return (
    <>
      <div
        ref={conversation}
        onScroll={(event) => {
          const list = event.currentTarget;
          following.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="flex flex-col gap-3.5 p-5">
          <p className="text-body text-graphite">{piece ? t.conciergeIntroPiece : t.conciergeIntro}</p>
          {messages.map((message) =>
            message.role === 'user' ? (
              // The customer's words, as typed.
              <div key={message.id} data-testid="message-user" className="max-w-[78%] self-end bg-ink px-3.5 py-3 text-[14px] leading-[1.45] text-paper">
                {message.parts.map((part, index) =>
                  part.type === 'text' ? (
                    <p key={index} className="whitespace-pre-wrap break-words">
                      {part.content}
                    </p>
                  ) : null
                )}
              </div>
            ) : message.role === 'assistant' ? (
              <div key={message.id} data-testid="message-assistant" className="flex flex-col gap-3.5 text-[14px] leading-[1.55]">
                <AssistantParts parts={message.parts} locale={locale} picker={picker} />
              </div>
            ) : null
          )}
          {retry && (
            <div className="flex flex-wrap items-center gap-x-3 text-[12px] text-mist">
              <p>{t.noReply}</p>
              <button
                type="button"
                data-testid="retry-reply"
                onClick={() => {
                  following.current = true;
                  reload().catch(() => {});
                }}
                className="btn-text shrink-0"
              >
                {t.retry}
              </button>
            </div>
          )}
          {busy && <Spinner label={t.loading} className="py-2" />}
          {failure && <ErrorNote error={failure}>{errorText(failure, locale)}</ErrorNote>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-t border-hairline bg-paper px-5 pb-[calc(0.75rem+var(--line-safe-bottom))] pt-3">
        {/* On a phone in landscape the row goes once the conversation has begun, to leave it room (styles.css). A flex gap, not space-y: the hidden row leaves no margin behind. */}
        <div className={`-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${messages.length > 0 ? 'short:hidden' : ''}`}>
          {(piece ? t.pieceSuggestions : t.suggestions).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={locked}
              onClick={() => send(suggestion)}
              className="min-h-[44px] max-w-[85%] shrink-0 border border-hairline px-3 py-2 text-left text-[13px] leading-snug disabled:text-mist"
            >
              <span className="line-clamp-2">{suggestion}</span>
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-end gap-2.5">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={1000}
            placeholder={t.placeholder}
            aria-label={t.placeholder}
            className="field min-w-0 flex-1"
          />
          <button
            type="submit"
            disabled={locked || !draft.trim()}
            className="flex h-11 shrink-0 items-center bg-ink px-[18px] text-[11px] font-medium uppercase tracking-[0.2em] text-paper disabled:bg-hairline disabled:text-mist"
          >
            {t.send}
          </button>
        </form>
      </div>
    </>
  );
}
