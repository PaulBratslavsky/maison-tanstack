import { toLocale } from './liff';
import type { Locale } from './types';

/** Where the header's language switch remembers the choice on this device. */
const LOCALE_KEY = 'maison.locale';

const isLocale = (value: unknown): value is Locale => value === 'ja' || value === 'en';

/**
 * The screens' language: the customer's own choice with the switch, else the language LINE gives at sign-in, else
 * the demo default (VITE_DEMO_LOCALE), read the way LINE's languages are.
 */
export const resolveLocale = ({ override, signedIn, demo }: { override: Locale | null; signedIn: Locale | null; demo: string }): Locale =>
  override ?? signedIn ?? toLocale(demo);

/** The language chosen on this device, or null: nothing stored, something else stored, or no storage to read. */
export const readStoredLocale = (storage: Pick<Storage, 'getItem'> | null): Locale | null => {
  try {
    const value = storage?.getItem(LOCALE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null; // storage blocked, e.g. a private window
  }
};

/** Remembers the choice on this device. Never throws: without storage, the choice lasts until the page reloads. */
export const storeLocale = (storage: Pick<Storage, 'setItem'> | null, locale: Locale): void => {
  try {
    storage?.setItem(LOCALE_KEY, locale);
  } catch {
    // storage blocked or full: not remembered this time
  }
};
