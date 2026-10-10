import { createFileRoute } from '@tanstack/react-router';

import { Detail, Details } from '../components/details';
import { LineChat } from '../components/line-chat';
import { useMaison } from '../components/maison-provider';
import { Screen } from '../components/screen';
import { StatusNote } from '../components/status-note';
import { StatusTag } from '../components/status-tag';
import { COPY } from '../lib/copy';
import { listOf, visitTime } from '../lib/format';
import type { Appointment } from '../lib/types';
import { useTool } from '../lib/use-tool';

/**
 * Where the LINE confirmation's button leads: the visit's reference in mono, the boutique as the headline, the day and
 * time, its status tag, a details list of the pieces and the customer's note, and "Chat with Maison on LINE".
 */
export const Route = createFileRoute('/visits/$reference')({
  component: VisitPage,
});

function VisitPage() {
  const { reference } = Route.useParams();
  const { locale } = useMaison();
  const t = COPY[locale];
  const visits = useTool<{ appointments: Appointment[] }>('visits', 'my_appointments', { locale });
  const visit = visits.data?.appointments.find((candidate) => candidate.reference === reference);
  return (
    <Screen name="visits" tools={['my_appointments']}>
      <StatusNote loading={visits.loading} error={visits.error} retry={visits.retry} />
      {visits.data && !visit && <p className="px-5 py-8 text-body text-mist">{t.visitNotFound}</p>}
      {visit && (
        <article className="px-5 pt-5">
          <p className="font-mono text-[11px] text-graphite">{visit.reference}</p>
          <h1 className="mt-3 text-headline">{visit.boutique.name}</h1>
          <p className="mt-3 text-[16px] tabular-nums">{visitTime(visit.requestedFor, locale)}</p>
          <div className="mt-4">
            <StatusTag visit={visit} locale={locale} />
          </div>
          <Details className="mt-8">
            <Detail label={t.visitPieces}>{listOf(visit.products.map((product) => product.name), locale)}</Detail>
            {visit.note && (
              <Detail label={t.visitNote}>
                <span className="whitespace-pre-line">{visit.note}</span>
              </Detail>
            )}
          </Details>
          <LineChat className="mt-8" />
        </article>
      )}
    </Screen>
  );
}
