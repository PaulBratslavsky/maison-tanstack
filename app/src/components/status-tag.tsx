import { COPY } from '../lib/copy';
import { statusTag } from '../lib/status';
import type { Appointment, Locale } from '../lib/types';

/**
 * A visit's status, for My visits and a visit's page: "Awaiting the boutique" outlined, "Confirmed" filled ink, and
 * "LINE sent" after a small check once the confirmation went out (statusTag in lib/status.ts). Monochrome, square,
 * 10 px uppercase as on the concierge's booking card. Each piece stays on one line; short of room, "LINE sent" goes under
 * the tag.
 */
export function StatusTag({ visit, locale }: { visit: Pick<Appointment, 'status' | 'confirmationSent'>; locale: Locale }) {
  const { label, filled, lineSent } = statusTag(visit, locale);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={`inline-flex h-6 items-center whitespace-nowrap border border-ink px-2 text-[10px] font-medium uppercase tracking-[0.16em] ${filled ? 'bg-ink text-paper' : 'text-ink'}`}
      >
        {label}
      </span>{' '}
      {lineSent && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-[0.16em] text-graphite">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
            <path d="M1.5 5.25 4 7.75 8.5 2.5" />
          </svg>
          {COPY[locale].lineSent}
        </span>
      )}
    </span>
  );
}
