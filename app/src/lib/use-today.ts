import { useEffect, useState } from 'react';

import { tokyoDays } from './format';

/** How often a screen looks at the clock for a new day. */
const CHECK_MS = 30_000;

const tokyoDate = (moment: Date) => tokyoDays(1, moment)[0].date;

/**
 * The time, renewed when the day changes on Tokyo's calendar (checked every 30 seconds), so a screen that counts days
 * renders again at Tokyo's midnight and not between. The booking sheet counts its days from it: left open past midnight,
 * it offers the new days, and a day it had chosen that has become today asks for a later one.
 */
export function useToday(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      const next = new Date();
      setNow((previous) => (tokyoDate(previous) === tokyoDate(next) ? previous : next));
    }, CHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
