import { useEffect, useState } from 'react';

import { COPY } from '../lib/copy';
import { type LineOs, onPhone, openInLineBody } from '../lib/open-in-line';
import { qrImageSource } from '../lib/qr-image';
import { useMaison } from './maison-provider';

/**
 * LINE mode, outside the LINE app (Safari, Chrome, a desktop browser): the app doesn't sign in here, it asks to be
 * opened inside LINE. A QR code of this page's LINE link, for LINE's QR reader, and on a phone a button with the same
 * link, which the words lead to there. It isn't an error, so there's nothing to retry. <Screen> shows it in place of the
 * screen's content.
 */
export function OpenInLine({ url, os }: { url: string; os: LineOs }) {
  const { locale } = useMaison();
  const t = COPY[locale].openInLine;
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let current = true;
    qrImageSource(url).then(
      (source) => {
        if (current) setQr(source);
      },
      (error: unknown) => {
        // Without the code, the button and the hint still say what to do, and the link shows as text to copy.
        console.error("The QR code of this page's LINE link couldn't be drawn.", error);
        if (current) setQrFailed(true);
      }
    );
    return () => {
      current = false;
    };
  }, [url]);

  return (
    <section className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-10 pt-10 text-center">
      <h1 className="max-w-xs text-headline">{t.title}</h1>
      <p className="mt-4 max-w-xs text-body text-graphite">{openInLineBody(t, os)}</p>
      {/* Black on white, 240 px square (at least 220), on a white tile inside a hairline, so the code scans on any background. */}
      <div className="mt-8 border border-hairline bg-paper p-3">
        {qr ? (
          <img src={qr} alt={t.alt} width={240} height={240} className="block h-60 w-60" />
        ) : (
          <div className="h-60 w-60" aria-hidden="true" />
        )}
      </div>
      {qrFailed && <p className="mt-3 max-w-xs select-all break-all font-mono text-[11px] text-graphite">{url}</p>}
      {onPhone(os) && (
        <a href={url} className="btn-primary mt-8 w-full max-w-xs">
          {t.button}
        </a>
      )}
      <p className="mt-6 max-w-xs text-xs leading-relaxed text-mist">{t.hint}</p>
    </section>
  );
}
