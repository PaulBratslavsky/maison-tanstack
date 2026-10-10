import { describe, expect, it } from 'vitest';
import {
  checkOpenAt,
  hoursForDate,
  isRealIsoDate,
  validateOpeningHours,
  zonedParts,
  type OpeningHoursEntry,
} from '../../server/src/domain/hours';

const TOKYO = 'Asia/Tokyo';
const everyDay = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((weekday) => ({
  weekday,
  opens: '11:00',
  closes: '20:00',
}));
const osaka: OpeningHoursEntry[] = everyDay.filter((entry) => entry.weekday !== 'tue');

describe('validateOpeningHours', () => {
  it('accepts a valid week', () => {
    const result = validateOpeningHours(everyDay);
    expect(result.ok).toBe(true);
  });

  it.each([
    ['not an array', { mon: '11:00' }],
    ['unknown weekday', [{ weekday: 'monday', opens: '11:00', closes: '20:00' }]],
    ['bad time', [{ weekday: 'mon', opens: '11', closes: '20:00' }]],
    ['24:00', [{ weekday: 'mon', opens: '11:00', closes: '24:00' }]],
    ['opens after closes', [{ weekday: 'mon', opens: '20:00', closes: '11:00' }]],
    ['duplicate weekday', [
      { weekday: 'mon', opens: '11:00', closes: '20:00' },
      { weekday: 'mon', opens: '12:00', closes: '19:00' },
    ]],
  ])('rejects %s', (_label, value) => {
    const result = validateOpeningHours(value);
    expect(result.ok).toBe(false);
  });
});

describe('zonedParts', () => {
  it('reads Tokyo wall-clock time from a UTC instant', () => {
    expect(zonedParts(new Date('2026-10-10T05:00:00Z'), TOKYO)).toEqual({
      isoDate: '2026-10-10',
      weekday: 'sat',
      minutes: 14 * 60,
    });
  });

  it('crosses midnight into the next Tokyo day', () => {
    expect(zonedParts(new Date('2026-10-05T23:30:00Z'), TOKYO)).toEqual({
      isoDate: '2026-10-06',
      weekday: 'tue',
      minutes: 8 * 60 + 30,
    });
  });
});

describe('checkOpenAt', () => {
  it.each([
    ['opening minute', '2026-10-10T02:00:00Z', true],
    ['one minute before opening', '2026-10-10T01:59:00Z', false],
    ['last minute before closing', '2026-10-10T10:59:00Z', true],
    ['exactly closing time', '2026-10-10T11:00:00Z', false],
  ])('Ginza hours: %s', (_label, iso, expected) => {
    expect(checkOpenAt(everyDay, new Date(iso), TOKYO).open).toBe(expected);
  });

  it('treats a missing weekday as closed (Osaka on Tuesday)', () => {
    const result = checkOpenAt(osaka, new Date('2026-10-06T05:00:00Z'), TOKYO);
    expect(result).toEqual({ open: false, isoDate: '2026-10-06', weekday: 'tue', entry: null });
  });

  it('judges a UTC Monday-night request as Tuesday morning in Tokyo', () => {
    const result = checkOpenAt(osaka, new Date('2026-10-05T23:30:00Z'), TOKYO);
    expect(result.weekday).toBe('tue');
    expect(result.open).toBe(false);
  });
});

describe('isRealIsoDate', () => {
  it.each(['2026-10-10', '2028-02-29', '2026-09-30', '2026-12-31'])('accepts %s', (value) => {
    expect(isRealIsoDate(value)).toBe(true);
  });

  it.each([
    ['29 February in a common year', '2026-02-29'],
    ['31 September', '2026-09-31'],
    ['31 February', '2026-02-31'],
    ['month 13', '2026-13-01'],
    ['day 00', '2026-10-00'],
    ['a one-digit day', '2026-10-1'],
    ['a date and time', '2026-10-10T00:00:00Z'],
    ['words', 'next Saturday'],
  ])('rejects %s', (_label, value) => {
    expect(isRealIsoDate(value)).toBe(false);
  });
});

describe('hoursForDate', () => {
  it('returns the entry for a calendar date', () => {
    expect(hoursForDate(osaka, '2026-10-10')).toEqual({ weekday: 'sat', opens: '11:00', closes: '20:00' });
  });

  it('returns null for a closed day', () => {
    expect(hoursForDate(osaka, '2026-10-06')).toBeNull();
  });
});
