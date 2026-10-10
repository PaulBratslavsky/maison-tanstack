import { describe, expect, it } from 'vitest';
import { formatEnDateTime, formatJaDateTime, isoOrNull, toZonedIso, zonedDayRange } from '../../server/src/domain/time';

describe('formatJaDateTime', () => {
  it('formats a Tokyo date and time in Japanese', () => {
    expect(formatJaDateTime(new Date('2026-10-10T05:00:00Z'), 'Asia/Tokyo')).toBe('10月10日(土) 14:00');
  });

  it('pads minutes and uses 24-hour time', () => {
    expect(formatJaDateTime(new Date('2026-10-14T09:05:00Z'), 'Asia/Tokyo')).toBe('10月14日(水) 18:05');
  });
});

describe('formatEnDateTime', () => {
  it('formats a Tokyo date and time in English: the weekday, day, month and time, without a year', () => {
    expect(formatEnDateTime(new Date('2026-10-10T05:00:00Z'), 'Asia/Tokyo')).toBe('Sat 10 Oct, 14:00');
  });

  it('pads minutes and uses 24-hour time', () => {
    expect(formatEnDateTime(new Date('2026-10-14T09:05:00Z'), 'Asia/Tokyo')).toBe('Wed 14 Oct, 18:05');
  });

  it("gives Tokyo's day, not UTC's, across a date boundary", () => {
    // 15:30 on Friday 9 October in UTC is already Saturday in Tokyo.
    expect(formatEnDateTime(new Date('2026-10-09T15:30:00Z'), 'Asia/Tokyo')).toBe('Sat 10 Oct, 00:30');
  });

  it('crosses into the next month at midnight, which it writes as 00:00, with no leading zero on the day', () => {
    expect(formatEnDateTime(new Date('2026-10-31T15:00:00Z'), 'Asia/Tokyo')).toBe('Sun 1 Nov, 00:00');
  });

  it('names every month in three letters, September included', () => {
    expect(formatEnDateTime(new Date('2026-09-09T05:00:00Z'), 'Asia/Tokyo')).toBe('Wed 9 Sep, 14:00');
  });
});

describe('toZonedIso', () => {
  it('writes Tokyo wall-clock time with its offset', () => {
    expect(toZonedIso(new Date('2026-10-10T05:00:00Z'), 'Asia/Tokyo')).toBe('2026-10-10T14:00:00+09:00');
  });

  it('crosses midnight into the next Tokyo day', () => {
    expect(toZonedIso(new Date('2026-10-05T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-10-06T08:30:00+09:00');
  });

  it('handles negative offsets and daylight saving time', () => {
    expect(toZonedIso(new Date('2026-07-01T12:00:00Z'), 'America/New_York')).toBe('2026-07-01T08:00:00-04:00');
  });

  it('drops milliseconds and writes +00:00 for UTC', () => {
    expect(toZonedIso(new Date('2026-10-10T05:00:00.789Z'), 'UTC')).toBe('2026-10-10T05:00:00+00:00');
  });
});

describe('zonedDayRange', () => {
  const range = (isoDate: string, timeZone: string) => {
    const { start, end } = zonedDayRange(isoDate, timeZone);
    return [start.toISOString(), end.toISOString()];
  };

  it('starts a Tokyo day at 15:00 UTC the day before', () => {
    expect(range('2026-10-10', 'Asia/Tokyo')).toEqual(['2026-10-09T15:00:00.000Z', '2026-10-10T15:00:00.000Z']);
  });

  it('crosses month ends', () => {
    expect(range('2026-10-31', 'Asia/Tokyo')).toEqual(['2026-10-30T15:00:00.000Z', '2026-10-31T15:00:00.000Z']);
  });

  it('gives a 23-hour day when daylight saving time starts', () => {
    expect(range('2026-03-08', 'America/New_York')).toEqual(['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z']);
  });
});

describe('isoOrNull', () => {
  it.each([null, undefined, ''])('is null for %j: there is no date', (value) => {
    expect(isoOrNull(value)).toBeNull();
  });

  it.each([
    ['an ISO string already', '2026-10-03T01:12:00.000Z'],
    ['an ISO string with an offset', '2026-10-03T10:12:00+09:00'],
    ['a Date', new Date('2026-10-03T01:12:00.000Z')],
    ['milliseconds since 1970', Date.parse('2026-10-03T01:12:00.000Z')],
  ])('writes %s as an ISO string in UTC', (_label, value) => {
    expect(isoOrNull(value)).toBe('2026-10-03T01:12:00.000Z');
  });
});
