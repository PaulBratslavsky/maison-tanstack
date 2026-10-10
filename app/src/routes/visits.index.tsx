import { Link, createFileRoute } from '@tanstack/react-router';

import { LineChat } from '../components/line-chat';
import { useMaison } from '../components/maison-provider';
import { Screen } from '../components/screen';
import { Spinner } from '../components/spinner';
import { StatusNote } from '../components/status-note';
import { StatusTag } from '../components/status-tag';
import { COPY } from '../lib/copy';
import { visitTime } from '../lib/format';
import { requestSentFor } from '../lib/status';
import type { Appointment } from '../lib/types';
import { useTool } from '../lib/use-tool';
import { visitsSearch } from '../lib/visit-search';

const TOOLS = ['my_appointments'];

export const Route = createFileRoute('/visits/')({
  // ?ref= is the visit just requested.
  validateSearch: visitsSearch,
  component: Visits,
});

/**
 * My visits: rows under hairlines, each the boutique and its status tag, the day and time, and the reference in mono. A
 * request just sent (`?ref=`) is said so above the list, and its row sits on the wash. "Chat with Maison on LINE"
 * appears once: next to "Request sent" after a booking, and otherwise under the list, after a line that says where the
 * confirmation arrives.
 */
function Visits() {
  const { locale } = useMaison();
  const t = COPY[locale];
  const highlight = Route.useSearch().ref ?? null;
  const visits = useTool<{ appointments: Appointment[] }>('visits', 'my_appointments', { locale });
  const list = visits.data?.appointments ?? [];
  const requestSent = requestSentFor(visits.data?.appointments, highlight);
  return (
    <Screen name="visits" tools={TOOLS}>
      <h1 className="px-5 pb-6 pt-5 text-headline">{t.myVisits}</h1>
      {requestSent && (
        <div className="mx-5 mb-6 flex flex-col gap-4">
          <p className="border-l border-ink pl-4 text-body">{t.visitRequested}</p>
          <LineChat />
        </div>
      )}
      <StatusNote loading={visits.loading} error={visits.error} retry={visits.retry} />
      {visits.data && list.length === 0 && <p className="px-5 text-body text-mist">{t.noVisits}</p>}
      {list.length > 0 && (
        <ul className="border-t border-hairline">
          {list.map((visit) => (
            <li key={visit.reference} className="border-b border-hairline">
              <Link
                to="/visits/$reference"
                params={{ reference: visit.reference }}
                data-testid="visit"
                className={`flex flex-col gap-1.5 px-5 py-4 ${visit.reference === highlight ? 'bg-wash' : ''}`}
              >
                {/* Short of room, the tag goes under the boutique's name. */}
                <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <span className="text-[16px] leading-snug">{visit.boutique.name}</span>
                  <StatusTag visit={visit} locale={locale} />
                </span>
                <span className="text-[14px] tabular-nums text-graphite">{visitTime(visit.requestedFor, locale)}</span>
                <span className="font-mono text-[11px] text-mist">{visit.reference}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {visits.data && !requestSent && <LineChat line className="px-5 pt-8" />}
    </Screen>
  );
}
