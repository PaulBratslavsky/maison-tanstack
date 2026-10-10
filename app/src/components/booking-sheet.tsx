import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { defaultVisit, shouldCloseOnKey } from '../lib/booking';
import { COPY } from '../lib/copy';
import { yen } from '../lib/format';
import type { Product } from '../lib/types';
import { BookingForm } from './booking-form';
import { useMaison } from './maison-provider';

/**
 * "Book a visit", as a bottom sheet over the product: the booking form (components/booking-form.tsx) for this piece, in a
 * dialog that takes the focus when it opens, and closes on Escape, on its close button and on a tap on the backdrop.
 * After a request the app moves to My visits, with the new visit.
 */
export function BookingSheet({ product, onClose }: { product: Product; onClose: () => void }) {
  const { locale } = useMaison();
  const t = COPY[locale];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The sheet's own start: Ginza, the next Saturday at least two days away, at 14:00.
  const [initial] = useState(() => defaultVisit());
  const heading = useRef<HTMLHeadingElement>(null);
  const pressedOnBackdrop = useRef(false);

  // Focus moves into the dialog when it opens, and Escape closes it: not while Japanese input composes, which it cancels.
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (shouldCloseOnKey(event)) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    // A click on the backdrop closes the sheet: pressed and released there, not a drag that ends outside the sheet.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.bookVisit}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOnBackdrop.current) onClose();
      }}
      className="fixed inset-0 z-30 flex items-end bg-ink/45 stage:absolute"
    >
      <BookingForm
        screen="product"
        products={[product.slug]}
        initial={initial}
        // `sending` stays on in the form: its button stays disabled while the app moves to the visits screen.
        onBooked={(appointment) => {
          // My visits asks again, so its list is never from before this booking.
          queryClient.removeQueries({ queryKey: ['tool', 'visits'] });
          void navigate({ to: '/visits', search: { ref: appointment.reference } });
        }}
        className="flex max-h-[90%] w-full flex-col gap-[18px] overflow-y-auto bg-paper px-[calc(1.25rem+var(--line-safe-x))] pb-[calc(1.25rem+var(--line-safe-bottom))] pt-2.5"
        header={
          <>
            {/* The grab handle: the one rounded thing in the design. */}
            <div aria-hidden="true" className="mx-auto h-1 w-9 shrink-0 rounded-[2px] bg-hairline" />
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 ref={heading} tabIndex={-1} className="text-[20px] font-normal leading-tight outline-none">
                  {t.bookVisit}
                </h2>
                <p className="text-[13px] text-graphite">
                  {product.name} · <span className="tabular-nums">{yen(product.priceJpy, locale)}</span>
                </p>
              </div>
              <button type="button" onClick={onClose} aria-label={t.close} className="-mr-3 flex h-11 w-11 shrink-0 items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
                  <path d="M2 2l12 12M14 2L2 14" />
                </svg>
              </button>
            </div>
          </>
        }
      />
    </div>
  );
}
