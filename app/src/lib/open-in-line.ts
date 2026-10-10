import type { Locale } from './types';

/** What liff.getOS() reports: a phone (ios, android), a desktop browser (web), or nothing yet. */
export type LineOs = 'ios' | 'android' | 'web' | undefined;

/** Whether the "Open in LINE" page offers its button: on a phone only, where the link can hand the page to LINE. */
export const onPhone = (os: LineOs): boolean => os === 'ios' || os === 'android';

/**
 * The page's words under its title. A phone gets the button's (bodyPhone): a phone can't scan the code on its own
 * screen. A desktop browser, or one LIFF hasn't named yet, gets the QR code's (body).
 */
export const openInLineBody = (copy: { body: string; bodyPhone: string }, os: LineOs): string => (onPhone(os) ? copy.bodyPhone : copy.body);

/**
 * How start-up ends in LINE mode outside the LINE app, for instance in Safari, when LINE hands it a liff.line.me link.
 * The app doesn't start LINE Login there: in Safari it looped through LINE and ngrok's warning page and never signed in.
 * The screens show the "Open in LINE" page instead (components/open-in-line.tsx). It isn't a failure, so there's no Retry.
 */
export class OpenInLineError extends Error {
  constructor(
    /** The LIFF URL that opens this page inside LINE: lineAppUrl(LIFF ID, location.pathname), never a query or hash. */
    public readonly url: string,
    /** The language LINE or the browser reports (liff.getAppLanguage()), for the page until the switch sets one. */
    public readonly locale: Locale,
    /** liff.getOS(): on a phone the page also offers a button that hands the URL to LINE. */
    public readonly os: LineOs
  ) {
    super('Open this page in LINE: the app signs in only inside the LINE app.');
    this.name = 'OpenInLineError';
  }
}
