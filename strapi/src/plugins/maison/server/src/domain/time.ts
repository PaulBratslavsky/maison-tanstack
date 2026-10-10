/** e.g. "10月10日(土) 14:00" */
export function formatJaDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('month')}月${get('day')}日(${get('weekday')}) ${get('hour')}:${get('minute')}`;
}

/** e.g. "Sat 10 Oct, 14:00": the weekday, day, month and 24-hour time in `timeZone`, with no year, as formatJaDateTime. */
export function formatEnDateTime(date: Date, timeZone: string): string {
  // Put together from en-US's parts: its three-letter names don't change, where en-GB writes September "Sept".
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** e.g. "2026-10-10T14:00:00+09:00": wall-clock time in `timeZone`, with that zone's UTC offset at that instant. */
export function toZonedIso(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const [year, month, day, hour, minute, second] = [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')];
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** UTC offset in minutes of `timeZone` at `date`, e.g. 540 for Tokyo. */
const offsetMinutes = (date: Date, timeZone: string): number => {
  const [, sign, hours, minutes] = /([+-])(\d{2}):(\d{2})$/.exec(toZonedIso(date, timeZone)) as RegExpExecArray;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
};

/** The instant a calendar day (YYYY-MM-DD) starts in `timeZone`. The second pass corrects for a DST change that night. */
const startOfDay = (isoDate: string, timeZone: string): Date => {
  const utcMidnight = Date.parse(`${isoDate}T00:00:00Z`);
  const guess = utcMidnight - offsetMinutes(new Date(utcMidnight), timeZone) * 60_000;
  return new Date(utcMidnight - offsetMinutes(new Date(guess), timeZone) * 60_000);
};

/** [start, end) of a calendar day in `timeZone`, for "visits on this day" filters. */
export function zonedDayRange(isoDate: string, timeZone: string): { start: Date; end: Date } {
  const next = new Date(`${isoDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: startOfDay(isoDate, timeZone), end: startOfDay(next.toISOString().slice(0, 10), timeZone) };
}

/** A date as an ISO string, or null when there is none. */
export const isoOrNull = (value: unknown): string | null => (value ? new Date(value as string | number | Date).toISOString() : null);
