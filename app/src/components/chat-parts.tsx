import { Link } from '@tanstack/react-router';
import { Fragment, type ReactNode } from 'react';

import { parseChatText, type Line } from '../lib/chat-text';
import { config } from '../lib/config';
import { COPY } from '../lib/copy';
import { visitTime, yen } from '../lib/format';
import { lineMessageUrl } from '../lib/line-chat';
import { messageLayout } from '../lib/message-layout';
import { handOffAt, toolPartOf, toolView, type RecordedHandOff } from '../lib/tool-view';
import type { Appointment, Locale, ProductCard } from '../lib/types';
import { CHOOSE_VISIT, pickerViewOf, type VisitPickerOutput } from '../lib/visit-picker';
import { LineChat } from './line-chat';
import { ProductImage } from './product-grid';
import { VisitPicker } from './visit-picker';

function Lines({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          {line.map((span, spanIndex) => (span.bold ? <strong key={spanIndex}>{span.text}</strong> : <Fragment key={spanIndex}>{span.text}</Fragment>))}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The assistant's words: paragraphs, line breaks, **bold** and simple lists (lib/chat-text.ts). The text becomes React
 * elements and text nodes, never HTML, so nothing in it can add markup to the page. The customer's own messages don't
 * pass through here: what they type is shown as typed.
 */
export function ChatText({ text }: { text: string }) {
  const blocks = parseChatText(text);
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={index}>
              <Lines lines={block.lines} />
            </p>
          );
        }
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            <Lines lines={item} />
          </li>
        ));
        return block.kind === 'ordered' ? (
          <ol key={index} start={block.start} className="list-decimal space-y-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={index} className="list-disc space-y-1 pl-5">
            {items}
          </ul>
        );
      })}
    </div>
  );
}

/** A tool call: one mono line, mist, or the error red when the call failed. */
export function ToolLine({ text, failed }: { text: string; failed: boolean }) {
  return (
    <p data-testid="tool-chip" className={`break-words font-mono text-[11px] leading-snug ${failed ? 'text-error' : 'text-mist'}`}>
      {text}
    </p>
  );
}

/** The pieces a search found, the first three: a three-column grid of square photos, each with its name and price. */
export function ProductSuggestions({ products, locale }: { products: ProductCard[]; locale: Locale }) {
  return (
    <ul className="grid grid-cols-3 gap-2">
      {products.slice(0, 3).map((product) => (
        <li key={product.slug}>
          <Link to="/products/$slug" params={{ slug: product.slug }} className="flex flex-col gap-1.5">
            {/* Decorative: the link's name is the product name below it. */}
            <ProductImage url={product.imageUrl} alt="" className="aspect-square w-full" />
            <span className="text-[12px] leading-[1.3]">{product.name}</span>
            <span className="text-[12px] leading-none tabular-nums text-graphite">{yen(product.priceJpy, locale)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The visit a request made, which leads to its page: its reference in mono, its status, the boutique and the time. */
export function BookingCard({ appointment, locale }: { appointment: Appointment; locale: Locale }) {
  return (
    <Link to="/visits/$reference" params={{ reference: appointment.reference }} className="flex flex-col gap-1.5 border border-ink p-3.5">
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] text-graphite">{appointment.reference}</span>
        <span className="text-right text-[10px] uppercase tracking-[0.16em]">{COPY[locale].requested}</span>
      </span>
      <span className="text-[16px]">{appointment.boutique.name}</span>
      <span className="text-[14px] tabular-nums text-graphite">{visitTime(appointment.requestedFor, locale)}</span>
    </Link>
  );
}

/**
 * The hand-off note, which handOffAt places once a message. After a hand-off Strapi recorded (`recorded`): thanks, and
 * that an advisor will message the customer here, with the question's reference, then "Send it in the LINE chat", a
 * secondary button that opens the chat with Maison with the question already typed in, for the customer to send
 * (lineMessageUrl). Without VITE_LINE_OA_ID there's no button. With nothing recorded (the hand-off after a search that
 * found nothing, or the model's own, failed): where the team answers, and "Chat with Maison on LINE", so a customer can
 * always reach a person. Only a recorded hand-off says the question is with the advisors.
 */
export function HandOffNote({ recorded, locale }: { recorded: RecordedHandOff | null; locale: Locale }) {
  const copy = COPY[locale].handOff;
  if (!recorded) {
    return (
      <div data-testid="hand-off" className="flex flex-col gap-2.5">
        <p className="text-body text-graphite">{copy.fallback}</p>
        <LineChat />
      </div>
    );
  }
  const url = lineMessageUrl(config.lineOaId, copy.typed(recorded.reference, recorded.question));
  return (
    <div data-testid="hand-off" className="flex flex-col gap-2.5">
      <p className="text-body text-graphite">{copy.note(recorded.reference)}</p>
      {url && (
        <a href={url} data-testid="hand-off-line" className="btn-secondary w-full">
          {copy.send}
        </a>
      )}
    </div>
  );
}

/** What the concierge page tells the parts about its visit pickers (lib/visit-picker.ts). */
export interface PickerContext {
  /** The picker that may send (livePickerOf): its call's id, or null. */
  live: string | null;
  /** A reply is coming in: the live picker waits for it to end. */
  busy: boolean;
  /** Hands the customer's answer to the chat for the call `toolCallId` (useChat's addToolResult), which goes on by itself. */
  answer: (toolCallId: string, output: VisitPickerOutput) => void;
  /** Tells the page a picker's request is on its way (true), or ended in a problem (false): the composer waits meanwhile. */
  onSending: (sending: boolean) => void;
}

/**
 * An assistant message, in the mockup's order (messageLayout in lib/message-layout.ts): its words and tool lines as they
 * came, a run of tool lines kept together, with a booking card right under the lines that made it, "Chat with Maison on
 * LINE" under the card, the hand-off note, once, under the line handOffAt names (a hand-off that went through: the
 * model's hand_off_to_staff, or a search that found nothing and carries the one the app made; otherwise, with the plain
 * note, the last search that found nothing, or a hand-off that failed), and the pieces a search found under the
 * message's words, above any visit picker after them. A visit picker sits under its line (pickerViewOf): its form while
 * it's the live one, then the visit's card, or a short line once closed or moved past.
 *
 * The parts are TanStack AI's: a text part's words are its `content`, and every tool call is a `tool-call` part. The
 * concierge's reply after a picker answer is a message of its own, so a message may be only words, or only a note.
 */
export function AssistantParts({ parts, locale, picker }: { parts: ReadonlyArray<{ type: string; content?: unknown }>; locale: Locale; picker: PickerContext }) {
  const t = COPY[locale];
  const layout = messageLayout<ReactNode>((lines, key) => (
    <div key={`lines-${key}`} className="flex flex-col gap-1">
      {lines}
    </div>
  ));
  const note = handOffAt(parts);
  parts.forEach((part, index) => {
    if (part.type === 'text') {
      if (typeof part.content !== 'string' || !part.content.trim()) return;
      layout.words(<ChatText key={index} text={part.content} />);
      return;
    }
    const tool = toolPartOf(part);
    if (!tool) return;
    const view = toolView(tool, locale);
    if (tool.toolName === CHOOSE_VISIT) layout.picker();
    layout.line(<ToolLine key={index} text={view.line} failed={view.failed} />);
    if (view.requestLine) layout.line(<ToolLine key={`request-${index}`} text={view.requestLine} failed={false} />);
    if (tool.toolName === CHOOSE_VISIT) {
      const toolCallId = tool.toolCallId ?? '';
      const shown = pickerViewOf(tool, { live: toolCallId !== '' && toolCallId === picker.live, busy: picker.busy });
      if (shown.kind === 'form') {
        layout.card(
          <VisitPicker
            key={`picker-${index}`}
            input={tool.input}
            canSend={shown.canSend}
            onAnswer={(output) => picker.answer(toolCallId, output)}
            onSending={picker.onSending}
          />
        );
      } else if (shown.kind === 'closed' || shown.kind === 'unsent') {
        layout.card(
          <p key={`picker-${index}`} data-testid="picker-note" className="text-body text-graphite">
            {shown.kind === 'closed' ? t.pickerClosed : t.pickerUnsent}
          </p>
        );
      }
    }
    if (view.appointment) {
      layout.card(
        <div key={`card-${index}`} className="flex flex-col gap-2.5">
          <BookingCard appointment={view.appointment} locale={locale} />
          <LineChat />
        </div>
      );
    }
    if (note && index === note.index) {
      layout.card(<HandOffNote key={`hand-off-${index}`} recorded={note.recorded} locale={locale} />);
    }
    if (view.products) layout.grid(<ProductSuggestions key={`found-${index}`} products={view.products} locale={locale} />);
  });
  return <>{layout.blocks()}</>;
}
