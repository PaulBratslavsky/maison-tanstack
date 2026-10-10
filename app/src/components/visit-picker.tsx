import { useState } from 'react';

import { COPY } from '../lib/copy';
import type { Product } from '../lib/types';
import { useTool } from '../lib/use-tool';
import { piecesOf, pickerPrefill, type VisitPickerOutput } from '../lib/visit-picker';
import { BookingForm } from './booking-form';
import { useMaison } from './maison-provider';

/** A piece's name in the picker's heading, as view_product gives it in the chat's language, never the model's words. Nothing until it's known. */
function PieceName({ slug }: { slug: string }) {
  const { locale } = useMaison();
  const piece = useTool<{ product: Product }>('concierge', 'view_product', { slug, locale });
  const name = piece.data?.product?.name;
  return name ? <li className="inline before:content-['_·_'] first:before:content-none">{name}</li> : null;
}

/**
 * The visit picker: the product page's booking form (components/booking-form.tsx) in an inline card under the concierge's
 * words, filled in from its choose_visit call (pickerPrefill in lib/visit-picker.ts). Send request books the visit as
 * the sheet does, with the customer's own session, and hands the concierge the appointment; Not now hands it "closed". A
 * refusal stays in the form, as on the sheet. Only the live picker sends, and not while a reply is coming in (`canSend`).
 */
export function VisitPicker({
  input,
  canSend,
  onAnswer,
  onSending,
}: {
  /** The choose_visit call's input: the pieces, and the boutique, day and time the customer named. */
  input: unknown;
  canSend: boolean;
  onAnswer: (output: VisitPickerOutput) => void;
  onSending: (sending: boolean) => void;
}) {
  const { locale } = useMaison();
  const t = COPY[locale];
  // The call is read once: from then on, what the form shows is the customer's to change.
  const [initial] = useState(() => pickerPrefill(input, new Date()));
  const products = piecesOf(input);

  return (
    <section data-testid="visit-picker" aria-label={t.bookVisit} className="border border-ink">
      <BookingForm
        screen="concierge"
        products={products}
        initial={initial}
        disabled={!canSend}
        onBooked={(appointment) => onAnswer({ status: 'requested', appointment })}
        onSendingChange={onSending}
        dismiss={{ label: t.notNow, onDismiss: () => onAnswer({ status: 'closed' }) }}
        className="flex flex-col gap-[18px] px-5 py-4"
        header={
          <div className="flex flex-col gap-1">
            <h2 className="text-[20px] font-normal leading-tight">{t.bookVisit}</h2>
            <ul className="text-[13px] text-graphite">
              {products.map((slug) => (
                <PieceName key={slug} slug={slug} />
              ))}
            </ul>
          </div>
        }
      />
    </section>
  );
}
