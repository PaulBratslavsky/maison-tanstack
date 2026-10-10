import { Link } from '@tanstack/react-router';

import { COPY } from '../lib/copy';
import { Header } from './header';
import { useMaison } from './maison-provider';

/**
 * An address the app has no screen for (the root route's notFoundComponent): the header, a plain note in the customer's
 * language, and a link back to the start. It signs nobody in and calls no tool, so it has no tools line or agent view.
 */
export function NotFoundScreen() {
  const { locale } = useMaison();
  const t = COPY[locale];
  return (
    <div className="pb-32">
      <Header />
      <section className="flex flex-col items-start gap-3.5 px-5 pb-8 pt-8">
        <h1 className="text-headline">{t.notFound.title}</h1>
        <p className="text-body text-graphite">{t.notFound.body}</p>
        <Link to="/" className="btn-text">
          {t.backHome}
        </Link>
      </section>
    </div>
  );
}
