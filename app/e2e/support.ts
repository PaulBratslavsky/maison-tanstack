const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The next given weekday (0 = Sunday … 6 = Saturday) at least two days away, as YYYY-MM-DD. It counts on this machine's
 * calendar, and the app counts Tokyo's: a date two or more days ahead is never before Tokyo's tomorrow, whichever time zone
 * the machine is in, and a calendar date has the same weekday everywhere.
 */
export const nextWeekday = (weekday: number): string => {
  const date = new Date();
  const ahead = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + (ahead < 2 ? ahead + 7 : ahead));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
