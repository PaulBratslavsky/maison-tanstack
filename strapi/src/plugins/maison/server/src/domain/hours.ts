/** Index matches Date.prototype.getUTCDay(). */
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface OpeningHoursEntry {
  weekday: Weekday;
  opens: string;
  closes: string;
}

export const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether a YYYY-MM-DD is on the calendar. `new Date()` would quietly turn 2026-09-31 into 1 October. */
export const isRealIsoDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const toMinutes = (hhmm: string): number => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};

export type HoursValidation = { ok: true; hours: OpeningHoursEntry[] } | { ok: false; reason: string };

export function validateOpeningHours(value: unknown): HoursValidation {
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'openingHours must be an array of { weekday, opens, closes }' };
  }
  const seen = new Set<string>();
  const hours: OpeningHoursEntry[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, reason: `openingHours[${index}] must be an object` };
    }
    const { weekday, opens, closes } = entry as Record<string, unknown>;
    if (typeof weekday !== 'string' || !(WEEKDAYS as readonly string[]).includes(weekday)) {
      return { ok: false, reason: `openingHours[${index}].weekday must be one of ${WEEKDAYS.join(', ')}` };
    }
    if (seen.has(weekday)) {
      return { ok: false, reason: `openingHours lists ${weekday} more than once` };
    }
    if (typeof opens !== 'string' || !TIME.test(opens) || typeof closes !== 'string' || !TIME.test(closes)) {
      return { ok: false, reason: `openingHours[${index}] opens and closes must be HH:MM (00:00-23:59)` };
    }
    if (toMinutes(opens) >= toMinutes(closes)) {
      return { ok: false, reason: `openingHours[${index}] must open before it closes` };
    }
    seen.add(weekday);
    hours.push({ weekday: weekday as Weekday, opens, closes });
  }
  return { ok: true, hours };
}

export interface ZonedParts {
  isoDate: string;
  weekday: Weekday;
  minutes: number;
}

/** Wall-clock date, weekday and minutes-since-midnight of an instant in a time zone. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday').toLowerCase().slice(0, 3) as Weekday,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Weekday of a calendar date (YYYY-MM-DD); independent of time zone. */
export const weekdayOfDate = (isoDate: string): Weekday => WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];

export const hoursForDate = (hours: OpeningHoursEntry[], isoDate: string): OpeningHoursEntry | null =>
  hours.find((entry) => entry.weekday === weekdayOfDate(isoDate)) ?? null;

export interface OpenCheck {
  open: boolean;
  isoDate: string;
  weekday: Weekday;
  entry: OpeningHoursEntry | null;
}

/** Open means opens <= local time < closes on that local weekday. A missing weekday means closed. */
export function checkOpenAt(hours: OpeningHoursEntry[], date: Date, timeZone: string): OpenCheck {
  const { isoDate, weekday, minutes } = zonedParts(date, timeZone);
  const entry = hours.find((candidate) => candidate.weekday === weekday) ?? null;
  const open = entry !== null && minutes >= toMinutes(entry.opens) && minutes < toMinutes(entry.closes);
  return { open, isoDate, weekday, entry };
}
