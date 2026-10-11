/**
 * How the admin writes the server's times. The server sends each as Tokyo time with its offset ("2026-10-10T14:00:00+09:00"),
 * the boutique's own clock. The calendar is read from those digits, never from the browser's time zone or language, so a
 * laptop anywhere shows the same text.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Year, month, day and, when there is one, the time of day. */
const CALENDAR = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/;
const monthAndDay = (parts: RegExpExecArray) => `${MONTHS[Number(parts[2]) - 1]} ${Number(parts[3])}`;

/** "2026-10-10T14:00:00+09:00" → "Oct 10, 14:00". A value that isn't a date and time is shown as it came. */
export const visitTime = (iso: string) => {
  const parts = CALENDAR.exec(iso);
  return parts?.[4] ? `${monthAndDay(parts)}, ${parts[4]}` : iso;
};

/** "2026-10-01T09:00:07+09:00" → "2026-10-01 09:00": the full date and time, as the board writes a visit. */
export const fullTime = (iso: string) => {
  const parts = CALENDAR.exec(iso);
  return parts?.[4] ? `${parts[1]}-${parts[2]}-${parts[3]} ${parts[4]}` : iso;
};

/**
 * How long before `now` the moment `iso` was: "just now" for the first minute, then "12 min ago", then "3 h ago", and from
 * a whole day on its date, like "Oct 1". Each count rounds down. A moment ahead of `now` (a browser clock that runs behind
 * the server's) is "just now". A value that isn't a date is shown as it came.
 */
export const timeAgo = (iso: string, now: Date): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;

  const elapsed = now.getTime() - then;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;

  const parts = CALENDAR.exec(iso);
  return parts ? monthAndDay(parts) : iso;
};

const TOKYO_OFFSET = 9 * HOUR;

/**
 * `timeAgo` for a time the server wrote in UTC, like an inquiry's `createdAt` ("2026-10-03T20:00:00.000Z"). From a whole
 * day on, `timeAgo` gives the date written in the string, which for UTC digits can be the day before the boutique's. This
 * writes the same moment on the boutique's clock first. A value that isn't a date is shown as it came.
 */
export const utcTimeAgo = (iso: string, now: Date): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  return timeAgo(`${new Date(then + TOKYO_OFFSET).toISOString().slice(0, -1)}+09:00`, now);
};
