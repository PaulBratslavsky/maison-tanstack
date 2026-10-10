import { Link, useLocation } from '@tanstack/react-router';

import { COPY } from '../lib/copy';
import type { Locale } from '../lib/types';
import { useMaison } from './maison-provider';

const LANGUAGES: Locale[] = ['en', 'ja'];

/** The header's link up from a screen, shown as "‹ Voyage": a product names its collection this way. */
export type BackLink = { label: string } & ({ to: '/' | '/visits' } | { to: '/collections/$slug'; params: { slug: string } });

/**
 * Every screen's header: sticky under the safe area's top, white, 56 px, with a hairline under it. Three columns:
 * - left: "My visits" on Home; elsewhere "‹" and the screen's parent, which a screen can name (`back`), or else a visit
 *   leads up to My visits and anything else to Home;
 * - centre: the wordmark, which leads Home;
 * - right: the EN/JA switch, two real buttons; the chosen one is 500 weight and underlined, the other mist.
 * The centre column is as wide as the wordmark (118 px) and the sides share the rest, so the wordmark stays centred
 * whatever the sides hold: equal thirds, as in the mockup, would push it off centre at any width under 393 px. At 360 px
 * each side gets 101 px, room for the two 44 px language buttons, and a long parent's name ends in an ellipsis. There's
 * no room for a third 44 px control, so the agent view's switch sits under the header (Screen).
 */
export function Header({ back }: { back?: BackLink }) {
  const { locale, setLocale } = useMaison();
  const t = COPY[locale];
  const pathname = useLocation({ select: (location) => location.pathname });
  const up: BackLink = back ?? (pathname.startsWith('/visits/') ? { to: '/visits', label: t.myVisits } : { to: '/', label: t.homeNav });
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-10 grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-hairline bg-paper px-5">
      {pathname === '/' && !back ? (
        <Link to="/visits" className="flex h-11 min-w-0 max-w-full items-center justify-self-start text-nav uppercase">
          <span className="truncate">{t.myVisits}</span>
        </Link>
      ) : (
        <Link {...up} className="flex h-11 min-w-0 max-w-full items-center gap-1 justify-self-start text-nav uppercase">
          <span aria-hidden="true">‹</span>
          <span className="truncate">{up.label}</span>
        </Link>
      )}
      <Link to="/" className="wordmark flex h-11 items-center">
        Maison
      </Link>
      {/* The 44 px buttons reach 6 px into the header's padding, so JA's letters end where the mockup's do. */}
      <div role="group" aria-label={t.language} className="-mr-1.5 flex gap-1 justify-self-end">
        {LANGUAGES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={locale === option}
            onClick={() => setLocale(option)}
            className={`h-11 min-w-[44px] text-nav ${locale === option ? 'font-medium text-ink underline underline-offset-4' : 'text-mist'}`}
          >
            {option.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}
