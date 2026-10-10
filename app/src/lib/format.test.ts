import { describe, expect, it, vi } from 'vitest';
import { dayLabel, isRealDate, listOf, mediaUrl, nextSaturday, personalizationKind, sizeCm, timeSlots, tokyoDays, tomorrow, visitTime, yen } from './format';

// Every date below is an instant, so the results don't depend on the machine's time zone. The suite passes under
// TZ=America/Los_Angeles and TZ=Asia/Tokyo alike. Tokyo is UTC+9 all year: noon in Tokyo is 03:00Z.
describe('format', () => {
  it("formats yen in the customer's language, and Tokyo visit times", () => {
    expect(yen(385000, 'ja')).toBe('￥385,000'); // ja-JP, as Node's ICU and Chrome write it (Safari: ¥385,000)
    expect(yen(385000, 'en')).toBe('¥385,000');
    expect(visitTime('2026-10-10T14:00:00+09:00', 'ja')).toContain('14:00');
    expect(visitTime('2026-10-10T05:00:00.000Z', 'en')).toContain('14:00');
  });

  it("joins names the way the customer's language does", () => {
    expect(listOf(['Weekender 50', 'Cabin Case 55', 'Passport Cover'], 'en')).toBe('Weekender 50, Cabin Case 55 and Passport Cover');
    expect(listOf(['Weekender 50', 'Cabin Case 55'], 'en')).toBe('Weekender 50 and Cabin Case 55');
    expect(listOf(['ウィークエンダー 50', 'キャビン・ケース 55', 'パスポートカバー'], 'ja')).toBe('ウィークエンダー 50、キャビン・ケース 55、パスポートカバー');
    expect(listOf(['Weekender 50'], 'en')).toBe('Weekender 50');
    expect(listOf([], 'ja')).toBe('');
  });

  it("names the catalog's personalization kinds in both languages", () => {
    expect(personalizationKind('initials-hot-stamp', 'en')).toBe('Hot-stamped initials');
    expect(personalizationKind('initials-hot-stamp', 'ja')).toBe('イニシャルの箔押し');
    for (const kind of ['initials-hot-stamp', 'hand-painted-stripes', 'monogram-color']) {
      for (const locale of ['ja', 'en'] as const) expect(personalizationKind(kind, locale)).not.toBe(kind.replace(/-/g, ' '));
    }
  });

  it('shows a kind it has no name for as its slug, with spaces', () => {
    expect(personalizationKind('laser-etching', 'ja')).toBe('laser etching');
    expect(personalizationKind('constructor', 'en')).toBe('constructor');
  });

  it('picks the next Saturday at least two days away', () => {
    expect(nextSaturday(new Date('2026-10-07T03:00:00Z'))).toBe('2026-10-10'); // Wednesday → Saturday
    expect(nextSaturday(new Date('2026-10-09T03:00:00Z'))).toBe('2026-10-17'); // Friday → the Saturday after
    expect(nextSaturday(new Date('2026-10-10T03:00:00Z'))).toBe('2026-10-17'); // Saturday → next week
  });

  it("counts days on Tokyo's calendar, not the machine's", () => {
    // 11:30 on Thursday 1 October in Tokyo, while it's still Wednesday evening in California.
    expect(tomorrow(new Date('2026-10-01T02:30:00Z'))).toBe('2026-10-02');
    expect(nextSaturday(new Date('2026-10-01T02:30:00Z'))).toBe('2026-10-03');
    // A minute either side of midnight in Tokyo, from Friday 9 October into Saturday 10 October.
    expect(nextSaturday(new Date('2026-10-09T14:59:00Z'))).toBe('2026-10-17');
    expect(nextSaturday(new Date('2026-10-09T15:00:00Z'))).toBe('2026-10-17');
    expect(tomorrow(new Date('2026-10-09T14:59:00Z'))).toBe('2026-10-10');
    expect(tomorrow(new Date('2026-10-09T15:00:00Z'))).toBe('2026-10-11');
    // And from Thursday 8 October into Friday 9 October, where the default Saturday moves a week on.
    expect(nextSaturday(new Date('2026-10-08T14:59:00Z'))).toBe('2026-10-10');
    expect(nextSaturday(new Date('2026-10-08T15:00:00Z'))).toBe('2026-10-17');
  });

  it("lists days on Tokyo's calendar, today first, whatever the machine's clock says", () => {
    // 11:30 on Thursday 1 October in Tokyo, while it's still Wednesday evening in California.
    expect(tokyoDays(3, new Date('2026-10-01T02:30:00Z'))).toEqual([
      { date: '2026-10-01', weekday: 4 },
      { date: '2026-10-02', weekday: 5 },
      { date: '2026-10-03', weekday: 6 },
    ]);
    // A minute either side of midnight in Tokyo.
    expect(tokyoDays(1, new Date('2026-10-01T14:59:00Z'))).toEqual([{ date: '2026-10-01', weekday: 4 }]);
    expect(tokyoDays(1, new Date('2026-10-01T15:00:00Z'))).toEqual([{ date: '2026-10-02', weekday: 5 }]);
    // Month and year ends, and a leap day.
    expect(tokyoDays(4, new Date('2026-12-30T03:00:00Z')).map((day) => day.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(tokyoDays(3, new Date('2028-02-28T03:00:00Z')).map((day) => day.date)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it("names a day for the booking sheet's chips, as the mockup does: its weekday and the day of the month", () => {
    expect(dayLabel('2026-10-03', 'en')).toBe('Sat 3');
    expect(dayLabel('2026-10-03', 'ja')).toBe('3日(土)');
    expect(dayLabel('2026-10-31', 'en')).toBe('Sat 31');
    expect(dayLabel('2026-11-01', 'ja')).toBe('1日(日)');
  });

  it("writes a piece's size in centimetres, width × height × depth, and nothing when the catalog has none", () => {
    expect(sizeCm({ width: 50, height: 29, depth: 22 })).toBe('50 × 29 × 22 cm');
    expect(sizeCm({ width: 19, height: 10, depth: 2.5 })).toBe('19 × 10 × 2.5 cm');
    expect(sizeCm(null)).toBeNull();
  });

  it('offers half-hour slots that end 30 minutes before closing', () => {
    const slots = timeSlots('11:00', '20:00');
    expect(slots[0]).toBe('11:00');
    expect(slots.at(-1)).toBe('19:30');
    expect(slots).toHaveLength(18);
  });

  it('makes relative media URLs absolute', () => {
    expect(mediaUrl('/uploads/a.png')).toMatch(/^https?:\/\/.+\/uploads\/a\.png$/);
    expect(mediaUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(mediaUrl(null)).toBeNull();
  });

  it('accepts only real calendar dates, like the Maison tools', () => {
    expect(isRealDate('2026-10-10')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true);
    for (const value of ['2026-02-29', '2026-09-31', '2026-02-30', '2026-11-31', '2027-02-30', '2026-04-31', '']) {
      expect(isRealDate(value)).toBe(false);
    }
  });

  it("never throws where Date refuses a day that isn't on the calendar (JavaScriptCore: LINE on iPhone)", () => {
    // V8 rolls 2026-02-30 over to 2 March. JavaScriptCore answers Invalid Date instead, whose toISOString() throws.
    // This stand-in does what JavaScriptCore does, so the guard is tested here too.
    const V8Date = Date;
    class JavaScriptCoreDate extends V8Date {
      constructor(...args: unknown[]) {
        if (typeof args[0] !== 'string') {
          super(...(args as [number]));
          return;
        }
        const rolled = new V8Date(args[0]);
        super(rolled.toISOString().slice(0, 10) === args[0].slice(0, 10) ? rolled.getTime() : Number.NaN);
      }
    }
    vi.stubGlobal('Date', JavaScriptCoreDate);
    try {
      for (const value of ['2026-02-30', '2026-11-31', '2027-02-30', '2026-04-31']) {
        expect(() => isRealDate(value)).not.toThrow();
        expect(isRealDate(value)).toBe(false);
      }
      expect(isRealDate('2026-10-10')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
