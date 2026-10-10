import { describe, expect, it } from 'vitest';
import { fullTime, timeAgo, visitTime } from '../../admin/src/time';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A fixed "now", so no test depends on the clock. */
const NOW = new Date('2026-10-05T12:00:00+09:00');
/** The moment `ms` before NOW. Only the date reading looks at the digits of the string, and the tests for that give their own. */
const before = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('timeAgo', () => {
  it('says "just now" for the first minute, down to the last millisecond of it', () => {
    expect(timeAgo(before(0), NOW)).toBe('just now');
    expect(timeAgo(before(30 * SECOND), NOW)).toBe('just now');
    expect(timeAgo(before(MINUTE - 1), NOW)).toBe('just now');
  });

  it('says "N min ago" from the first minute to the last millisecond before an hour, rounding down', () => {
    expect(timeAgo(before(MINUTE), NOW)).toBe('1 min ago');
    expect(timeAgo(before(12 * MINUTE + 30 * SECOND), NOW)).toBe('12 min ago');
    expect(timeAgo(before(HOUR - 1), NOW)).toBe('59 min ago');
  });

  it('says "N h ago" from the first hour to the last millisecond before a day, rounding down', () => {
    expect(timeAgo(before(HOUR), NOW)).toBe('1 h ago');
    expect(timeAgo(before(3 * HOUR + 59 * MINUTE), NOW)).toBe('3 h ago');
    expect(timeAgo(before(DAY - 1), NOW)).toBe('23 h ago');
  });

  it('gives the date from a whole day on, as the English short month and the day', () => {
    expect(timeAgo('2026-10-04T12:00:00+09:00', NOW)).toBe('Oct 4'); // exactly a day
    expect(timeAgo('2026-10-04T12:00:01+09:00', NOW)).toBe('23 h ago'); // a second short of it
    expect(timeAgo('2026-10-01T09:00:00+09:00', NOW)).toBe('Oct 1');
    expect(timeAgo('2026-09-30T23:30:00+09:00', NOW)).toBe('Sep 30');
    expect(timeAgo('2025-12-31T09:00:00+09:00', NOW)).toBe('Dec 31');
  });

  it('names every month the same way whatever the browser\'s language', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach((name, index) => {
      const month = String(index + 1).padStart(2, '0');
      expect(timeAgo(`2025-${month}-09T09:00:00+09:00`, NOW)).toBe(`${name} 9`);
    });
  });

  it("reads the calendar day written in the string, which is the boutique's, whatever the browser's time zone", () => {
    // 2026-09-30T18:00Z, and 2026-10-01T04:30Z: neither would read the same in every time zone, if the browser's were used.
    expect(timeAgo('2026-10-01T03:00:00+09:00', NOW)).toBe('Oct 1');
    expect(timeAgo('2026-09-30T23:30:00-05:00', NOW)).toBe('Sep 30');
  });

  it('reads a moment ahead of now, from a clock that runs behind the server, as "just now"', () => {
    expect(timeAgo(before(-1), NOW)).toBe('just now');
    expect(timeAgo(before(-HOUR), NOW)).toBe('just now');
    expect(timeAgo(before(-3 * DAY), NOW)).toBe('just now');
  });

  it('shows a value that is not a date as it came, so a bad answer never shows as "NaN min ago"', () => {
    expect(timeAgo('soon', NOW)).toBe('soon');
    expect(timeAgo('', NOW)).toBe('');
  });
});

describe('visitTime', () => {
  it("writes the visit in the boutique's own time, whatever the browser's time zone", () => {
    expect(visitTime('2026-10-10T14:00:00+09:00')).toBe('Oct 10, 14:00');
    expect(visitTime('2026-10-01T09:05:00+09:00')).toBe('Oct 1, 09:05');
    expect(visitTime('2026-12-31T23:59:00+09:00')).toBe('Dec 31, 23:59');
  });

  it('shows a value that is not a date and time as it came', () => {
    expect(visitTime('tomorrow')).toBe('tomorrow');
    expect(visitTime('2026-10-10')).toBe('2026-10-10');
  });
});

describe('fullTime', () => {
  it("writes the full date and time as the board writes a visit, in the boutique's own time", () => {
    expect(fullTime('2026-10-01T09:00:07+09:00')).toBe('2026-10-01 09:00');
    expect(fullTime('2026-09-30T23:30:00-05:00')).toBe('2026-09-30 23:30');
  });

  it('shows a value that is not a date and time as it came', () => {
    expect(fullTime('tomorrow')).toBe('tomorrow');
  });
});
