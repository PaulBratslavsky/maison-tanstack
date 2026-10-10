import { describe, expect, it } from 'vitest';
import activity from '../../server/seed/activity.json';
import content from '../../server/seed/content.json';
import knowledge from '../../server/seed/knowledge.json';
import appointmentSchema from '../../server/src/content-types/appointment/schema.json';
import inquirySchema from '../../server/src/content-types/inquiry/schema.json';
import questionSchema from '../../server/src/content-types/question/schema.json';
import { CREATED_VIA, INQUIRY_KINDS, LOCALES, QUESTION_REASONS } from '../../server/src/constants';
import {
  DEMO_MODEL_VERSION,
  HAND_OFF_LOGGED_AFTER_MS,
  RECEIVED_WITHIN_HOURS,
  VISIT_DAYS,
  demoActivityLoaded,
  hoursBefore,
  inStockAt,
  inquiryLabels,
  piecesAt,
  visitTime,
} from '../../server/src/domain/demo-activity';
import { checkOpenAt, toMinutes, validateOpeningHours, zonedParts, type OpeningHoursEntry } from '../../server/src/domain/hours';
import { sentimentLabelOf } from '../../server/src/domain/inquiry-criteria';
import { queueFor } from '../../server/src/domain/inquiry-queue';
import { parseSubject } from '../../server/src/domain/subject';

const TOKYO = 'Asia/Tokyo';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Each boutique's opening hours, as the catalog seeds them. */
const HOURS: Record<string, OpeningHoursEntry[]> = Object.fromEntries(
  content.boutiques.map((boutique) => {
    const hours = validateOpeningHours(boutique.openingHours);
    if (hours.ok === false) throw new Error(`${boutique.slug}: ${hours.reason}`);
    return [boutique.slug, hours.hours];
  })
);

/** The stock levels, as Load demo catalog creates them. */
const STOCK = Object.entries(content.stock).flatMap(([productSlug, perBoutique]) =>
  Object.entries(perBoutique).map(([boutiqueSlug, quantity]) => ({ productSlug, boutiqueSlug, quantity }))
);
const PUBLISHED = content.products.map((product) => product.slug);

/** Whole days from `now`'s day to `at`'s day, on Tokyo's calendar. */
const daysAway = (now: Date, at: Date) =>
  (Date.parse(`${zonedParts(at, TOKYO).isoDate}T00:00:00Z`) - Date.parse(`${zonedParts(now, TOKYO).isoDate}T00:00:00Z`)) / DAY_MS;

/** Every 7 hours for two weeks from the start of a Monday in Tokyo, so each weekday is "today" at several times of the day. */
const NOWS = Array.from({ length: 48 }, (_, index) => new Date(Date.parse('2026-10-04T15:00:00Z') + index * 7 * HOUR_MS));

/** What a seeded visit must be, whenever the button is pressed: in the window, on a half-hour, inside the hours, a whole visit before closing. */
const expectBookable = (at: Date | null, boutique: string, now: Date, label: string) => {
  expect(at, label).not.toBeNull();
  const visit = at as Date;
  const { weekday, minutes } = zonedParts(visit, TOKYO);
  const away = daysAway(now, visit);
  expect(away, label).toBeGreaterThanOrEqual(VISIT_DAYS.first);
  expect(away, label).toBeLessThanOrEqual(VISIT_DAYS.last);
  expect(minutes % 30, label).toBe(0);
  expect(visit.getUTCSeconds(), label).toBe(0);
  expect(checkOpenAt(HOURS[boutique], visit, TOKYO).open, label).toBe(true);
  const entry = HOURS[boutique].find((candidate) => candidate.weekday === weekday) as OpeningHoursEntry;
  expect(minutes + 30, label).toBeLessThanOrEqual(toMinutes(entry.closes));
};

describe('visitTime', () => {
  // Monday 5 October 2026, 10:00 in Tokyo.
  const MONDAY = new Date('2026-10-05T01:00:00Z');

  it('keeps the day and the time asked for when the boutique is open then', () => {
    const at = visitTime({ daysAhead: 3, time: '14:00', hours: HOURS.ginza, now: MONDAY, timezone: TOKYO });
    expect(at?.toISOString()).toBe('2026-10-08T05:00:00.000Z');
  });

  it('moves a visit off a day the boutique is closed, to the next day: Osaka on a Tuesday goes to the Wednesday', () => {
    const at = visitTime({ daysAhead: 8, time: '14:00', hours: HOURS.osaka, now: MONDAY, timezone: TOKYO });
    expect(zonedParts(at as Date, TOKYO)).toEqual({ isoDate: '2026-10-14', weekday: 'wed', minutes: 14 * 60 });
  });

  it('moves a closed last day of the window to the day before, so the visit stays in it', () => {
    // 13 days after Wednesday 30 September is Tuesday 13 October, when Osaka is closed.
    const now = new Date('2026-09-30T01:00:00Z');
    const at = visitTime({ daysAhead: 13, time: '14:00', hours: HOURS.osaka, now, timezone: TOKYO });
    expect(zonedParts(at as Date, TOKYO).isoDate).toBe('2026-10-12');
  });

  it('keeps a day asked for outside the window inside it', () => {
    expect(daysAway(MONDAY, visitTime({ daysAhead: 0, time: '14:00', hours: HOURS.ginza, now: MONDAY, timezone: TOKYO }) as Date)).toBe(2);
    expect(daysAway(MONDAY, visitTime({ daysAhead: 30, time: '14:00', hours: HOURS.ginza, now: MONDAY, timezone: TOKYO }) as Date)).toBe(13);
  });

  it.each([
    ['before opening', '09:00', 11 * 60],
    ['at closing', '20:00', 19 * 60 + 30],
    ['after closing', '22:15', 19 * 60 + 30],
    ['between half-hours, nearer the hour', '14:10', 14 * 60],
    ['between half-hours, nearer the half', '14:20', 14 * 60 + 30],
  ])('takes the nearest half-hour inside the hours for a time %s', (_case, time, minutes) => {
    const at = visitTime({ daysAhead: 3, time, hours: HOURS.ginza, now: MONDAY, timezone: TOKYO });
    expect(zonedParts(at as Date, TOKYO).minutes).toBe(minutes);
  });

  it('starts at the first half-hour after an opening that is not on one, and ends a whole visit before closing', () => {
    const hours: OpeningHoursEntry[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((weekday) => ({
      weekday: weekday as OpeningHoursEntry['weekday'], opens: '10:15', closes: '18:45',
    }));
    expect(zonedParts(visitTime({ daysAhead: 3, time: '08:00', hours, now: MONDAY, timezone: TOKYO }) as Date, TOKYO).minutes).toBe(10 * 60 + 30);
    expect(zonedParts(visitTime({ daysAhead: 3, time: '18:30', hours, now: MONDAY, timezone: TOKYO }) as Date, TOKYO).minutes).toBe(18 * 60);
  });

  it('skips a day too short for a whole visit on a half-hour', () => {
    const hours: OpeningHoursEntry[] = [
      { weekday: 'thu', opens: '11:10', closes: '11:50' },
      { weekday: 'fri', opens: '11:00', closes: '20:00' },
    ];
    expect(zonedParts(visitTime({ daysAhead: 3, time: '11:00', hours, now: MONDAY, timezone: TOKYO }) as Date, TOKYO).isoDate).toBe('2026-10-09');
  });

  it('answers null when the boutique is open on no day of the window', () => {
    expect(visitTime({ daysAhead: 3, time: '14:00', hours: [], now: MONDAY, timezone: TOKYO })).toBeNull();
  });

  it('never books Osaka on a Tuesday, whatever day it is pressed and whichever day is asked for', () => {
    for (const now of NOWS) {
      for (let daysAhead = VISIT_DAYS.first; daysAhead <= VISIT_DAYS.last; daysAhead += 1) {
        const at = visitTime({ daysAhead, time: '14:00', hours: HOURS.osaka, now, timezone: TOKYO });
        const label = `${now.toISOString()} +${daysAhead}`;
        expect(at, label).not.toBeNull();
        expect(zonedParts(at as Date, TOKYO).weekday, label).not.toBe('tue');
      }
    }
  });

  it("books every seeded visit in the window, on a half-hour, inside its boutique's hours, whenever the button is pressed", () => {
    for (const now of NOWS) {
      for (const visit of activity.appointments) {
        const at = visitTime({ daysAhead: visit.daysAhead, time: visit.time, hours: HOURS[visit.boutique], now, timezone: TOKYO });
        expectBookable(at, visit.boutique, now, `${visit.customer} at ${visit.boutique}, pressed ${now.toISOString()}`);
      }
    }
  });
});

describe('inStockAt and piecesAt', () => {
  const levels = [
    { productSlug: 'weekender-50', boutiqueSlug: 'ginza', quantity: 2 },
    { productSlug: 'voyage-trunk-110', boutiqueSlug: 'ginza', quantity: 0 },
    { productSlug: 'card-case-quatre', boutiqueSlug: 'ginza', quantity: 8 },
    { productSlug: 'card-case-quatre', boutiqueSlug: 'osaka', quantity: 5 },
    { productSlug: 'retired-piece', boutiqueSlug: 'ginza', quantity: 3 },
  ];
  const published = ['weekender-50', 'voyage-trunk-110', 'card-case-quatre'];

  it("lists a boutique's published pieces with at least one in stock, in slug order", () => {
    expect(inStockAt(levels, 'ginza', published)).toEqual(['card-case-quatre', 'weekender-50']);
    expect(inStockAt(levels, 'osaka', published)).toEqual(['card-case-quatre']);
    expect(inStockAt(levels, 'omotesando', published)).toEqual([]);
  });

  it('keeps the pieces a visit wants that the boutique has', () => {
    expect(piecesAt(['weekender-50', 'voyage-trunk-110'], ['card-case-quatre', 'weekender-50'])).toEqual(['weekender-50']);
  });

  it('takes the first piece the boutique has when it has none of them, and none when it has nothing', () => {
    expect(piecesAt(['voyage-trunk-110'], ['card-case-quatre', 'weekender-50'])).toEqual(['card-case-quatre']);
    expect(piecesAt(['voyage-trunk-110'], [])).toEqual([]);
  });

  it("finds every piece the seeded visits want in their boutique's stock, as the catalog seeds it", () => {
    for (const visit of activity.appointments) {
      const stocked = inStockAt(STOCK, visit.boutique, PUBLISHED);
      expect(piecesAt(visit.pieces, stocked), `${visit.customer} at ${visit.boutique}`).toEqual(visit.pieces);
    }
  });
});

describe('sentimentLabelOf', () => {
  it.each([
    [-1, 'negative'],
    [-0.21, 'negative'],
    [-0.2, 'neutral'],
    [0, 'neutral'],
    [0.2, 'neutral'],
    [0.21, 'positive'],
    [1, 'positive'],
  ])('labels %s %s, as the labelling prompt defines it', (score, label) => {
    expect(sentimentLabelOf(score)).toBe(label);
  });
});

describe('inquiryLabels', () => {
  const complaint = { kind: 'complaint' as const, sentimentScore: -0.6, answered: true, reason: 'The strap frays.', topic: 'strap repair' };

  it("gives a labelled inquiry the seed's labels, the sentiment label of its score, and the queue queueFor gives", () => {
    expect(inquiryLabels(complaint, false)).toEqual({
      ...complaint,
      sentimentLabel: 'negative',
      analysisStatus: 'analyzed',
      analysisAttempts: 0,
      modelVersion: DEMO_MODEL_VERSION,
      queue: 'complaint',
    });
  });

  it("names no prompt version, so nobody takes the seed's labels for a model's", () => {
    expect(inquiryLabels(complaint, false)).not.toHaveProperty('promptVersion');
    expect(DEMO_MODEL_VERSION).toBe('demo-seed');
  });

  it('puts every combination in the queue queueFor gives, a hand-off in Needs an answer', () => {
    for (const kind of INQUIRY_KINDS) {
      for (const answered of [true, false]) {
        for (const handedOff of [true, false]) {
          const labels = { kind, sentimentScore: 0, answered, reason: 'r', topic: 't' };
          expect(inquiryLabels(labels, handedOff).queue, `${kind} ${answered} ${handedOff}`).toBe(queueFor({ handedOff, kind, answered }));
        }
      }
    }
    expect(inquiryLabels({ ...complaint, kind: 'question', answered: false }, true).queue).toBe('needs-answer');
  });

  it('leaves an unlabelled inquiry pending for the sweep, with no labels, in the queue a logged turn gets', () => {
    expect(inquiryLabels(null, false)).toEqual({ analysisStatus: 'pending', analysisAttempts: 0, queue: queueFor({ handedOff: false, kind: null, answered: null }) });
  });
});

describe('demoActivityLoaded', () => {
  it('is false only when none of the demo customers has an appointment, a question or an inquiry', () => {
    expect(demoActivityLoaded({ appointments: 0, questions: 0, inquiries: 0 })).toBe(false);
    expect(demoActivityLoaded({ appointments: 1, questions: 0, inquiries: 0 })).toBe(true);
    expect(demoActivityLoaded({ appointments: 0, questions: 1, inquiries: 0 })).toBe(true);
    expect(demoActivityLoaded({ appointments: 0, questions: 0, inquiries: 1 })).toBe(true);
    expect(demoActivityLoaded({ appointments: 5, questions: 5, inquiries: 10 })).toBe(true);
  });
});

describe('hoursBefore', () => {
  it('is that many hours before now, to the millisecond', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(hoursBefore(now, 1.5).toISOString()).toBe('2026-10-06T10:30:00.000Z');
    expect(hoursBefore(now, 70).toISOString()).toBe('2026-10-03T14:00:00.000Z');
  });
});

describe('the demo activity seed', () => {
  const customers = activity.customers.map((customer) => customer.key);
  const productSlugs = new Set(PUBLISHED);
  const JAPANESE = /[぀-ヿ一-鿿]/;
  const handOffs = activity.questions.map((question) => question.handOff);

  describe('customers', () => {
    it('are five made-up customers, each with a display name', () => {
      expect(activity.customers).toHaveLength(5);
      expect(new Set(customers).size).toBe(5);
      expect(new Set(activity.customers.map((customer) => customer.subject)).size).toBe(5);
      for (const customer of activity.customers) {
        expect(parseSubject(customer.subject), customer.key).toBe(customer.subject);
        expect(customer.name.trim().length, customer.key).toBeGreaterThan(0);
        expect(customer.name.length, customer.key).toBeLessThanOrEqual(questionSchema.attributes.customerName.maxLength);
      }
    });

    it('have LINE subjects that are clearly fake: line:Udec0de, zeros, then one digit', () => {
      for (const customer of activity.customers) expect(customer.subject, customer.key).toMatch(/^line:Udec0de0{25}[1-9]$/);
    });
  });

  describe('requests', () => {
    it('are one per customer: three waiting for staff and two confirmed', () => {
      expect(activity.appointments.map((visit) => visit.customer).sort()).toEqual([...customers].sort());
      expect(activity.appointments.filter((visit) => visit.confirmed)).toHaveLength(2);
      expect(activity.appointments.filter((visit) => !visit.confirmed)).toHaveLength(3);
    });

    it('are at Ginza, Omotesando and Osaka, on a day in the window and at a half-hour', () => {
      expect(new Set(activity.appointments.map((visit) => visit.boutique))).toEqual(new Set(['ginza', 'omotesando', 'osaka']));
      for (const visit of activity.appointments) {
        expect(visit.daysAhead, visit.customer).toBeGreaterThanOrEqual(VISIT_DAYS.first);
        expect(visit.daysAhead, visit.customer).toBeLessThanOrEqual(VISIT_DAYS.last);
        expect(visit.time, visit.customer).toMatch(/^([01]\d|2[0-3]):(00|30)$/);
      }
    });

    it('mix English and Japanese, the app and the concierge, and two carry a short note', () => {
      expect(new Set(activity.appointments.map((visit) => visit.language))).toEqual(new Set(LOCALES));
      expect(new Set(activity.appointments.map((visit) => visit.createdVia))).toEqual(new Set(['app', 'concierge']));
      for (const visit of activity.appointments) expect(CREATED_VIA, visit.customer).toContain(visit.createdVia);
      const notes = activity.appointments.flatMap((visit) => (visit.note ? [visit.note] : []));
      expect(notes).toHaveLength(2);
      for (const note of notes) expect(note.length).toBeLessThanOrEqual(Math.min(appointmentSchema.attributes.customerNote.maxLength, 120));
    });
  });

  describe('questions', () => {
    it('are one per customer: three open, one taken and one answered', () => {
      expect(activity.questions.map((question) => question.customer).sort()).toEqual([...customers].sort());
      const open = activity.questions.filter((question) => question.status === 'open');
      expect(open.map((question) => question.reason).sort()).toEqual(['asked_for_person', 'no_answer', 'no_answer']);
      expect(activity.questions.filter((question) => question.status === 'taken')).toHaveLength(1);
      expect(activity.questions.filter((question) => question.status === 'answered')).toHaveLength(1);
      for (const question of activity.questions) expect(QUESTION_REASONS, question.customer).toContain(question.reason);
    });

    it('name the staff member who took or answered one, and when, and the answer', () => {
      const taken = activity.questions.find((question) => question.status === 'taken');
      expect(taken?.staffName).toBeTruthy();
      expect(taken?.takenHoursAgo).toBeGreaterThan(0);
      expect(taken?.takenHoursAgo).toBeLessThan(taken?.hoursAgo as number);
      const answered = activity.questions.find((question) => question.status === 'answered');
      expect(answered?.staffName).toBeTruthy();
      expect(answered?.answer?.trim().length).toBeGreaterThan(0);
      expect(answered?.answer?.length).toBeLessThanOrEqual(questionSchema.attributes.answer.maxLength);
      expect(answered?.answeredHoursAgo).toBeGreaterThan(0);
      expect(answered?.answeredHoursAgo).toBeLessThan(answered?.hoursAgo as number);
      for (const question of activity.questions.filter(({ status }) => status === 'open')) {
        expect(question, question.customer).not.toHaveProperty('staffName');
        expect(question, question.customer).not.toHaveProperty('answer');
      }
    });

    it('mix English and Japanese, and some are about a piece the catalog has', () => {
      expect(new Set(activity.questions.map((question) => question.language))).toEqual(new Set(LOCALES));
      const aboutPieces = activity.questions.flatMap((question) => (question.productSlug ? [question.productSlug] : []));
      expect(aboutPieces.length).toBeGreaterThanOrEqual(2);
      for (const slug of aboutPieces) expect(productSlugs.has(slug), slug).toBe(true);
      for (const question of activity.questions) expect(question.question.length).toBeLessThanOrEqual(questionSchema.attributes.question.maxLength);
    });

    it("each come with the concierge's hand-off reply, labelled as a question it didn't answer", () => {
      for (const handOff of handOffs) {
        expect(handOff.reply.trim().length).toBeGreaterThan(0);
        expect(handOff.labels.kind).toBe('question');
        expect(handOff.labels.answered).toBe(false);
      }
    });
  });

  describe('standalone inquiries', () => {
    const byKind = (kind: string) => activity.inquiries.filter((inquiry) => inquiry.labels?.kind === kind);

    it('are five: two complaints, one praise, one question answered from knowledge, and one left for the sweep', () => {
      expect(activity.inquiries).toHaveLength(5);
      expect(byKind('complaint')).toHaveLength(2);
      expect(byKind('praise')).toHaveLength(1);
      expect(byKind('question')).toHaveLength(1);
      expect(activity.inquiries.filter((inquiry) => inquiry.labels === null)).toHaveLength(1);
    });

    it('give the complaints a negative sentiment and the praise a positive one', () => {
      for (const inquiry of byKind('complaint')) expect(sentimentLabelOf(inquiry.labels?.sentimentScore as number)).toBe('negative');
      for (const inquiry of byKind('praise')) expect(sentimentLabelOf(inquiry.labels?.sentimentScore as number)).toBe('positive');
    });

    it('answer the question from a seeded product knowledge entry, word for word', () => {
      const [question] = byKind('question');
      expect(question.knowledgeFound).toBe(true);
      expect(question.labels?.answered).toBe(true);
      expect(inquiryLabels(question.labels as any, false).queue).toBe('none');
      expect(knowledge.entries.some((entry) => question.reply.includes(entry.answer))).toBe(true);
    });

    it('belong to the demo customers, and each has a reply', () => {
      for (const inquiry of activity.inquiries) {
        expect(customers, inquiry.message).toContain(inquiry.customer);
        expect(inquiry.reply.trim().length, inquiry.message).toBeGreaterThan(0);
        if (inquiry.productSlug) expect(productSlugs.has(inquiry.productSlug), inquiry.productSlug).toBe(true);
      }
    });
  });

  it('mixes English and Japanese across the inquiries, hand-offs included', () => {
    const languages = [...activity.questions.map((question) => question.language), ...activity.inquiries.map((inquiry) => inquiry.language)];
    expect(new Set(languages)).toEqual(new Set(LOCALES));
  });

  it('gives every label a kind and a score the content type takes, and a reason and topic in English that fit', () => {
    const labels = [...handOffs.map((handOff) => handOff.labels), ...activity.inquiries.flatMap((inquiry) => (inquiry.labels ? [inquiry.labels] : []))];
    expect(labels).toHaveLength(9);
    for (const label of labels) {
      expect(INQUIRY_KINDS).toContain(label.kind);
      expect(label.sentimentScore).toBeGreaterThanOrEqual(-1);
      expect(label.sentimentScore).toBeLessThanOrEqual(1);
      expect(label.reason.length, label.reason).toBeLessThanOrEqual(inquirySchema.attributes.reason.maxLength);
      expect(label.topic.length, label.topic).toBeLessThanOrEqual(inquirySchema.attributes.topic.maxLength);
      expect(label.reason, label.reason).not.toMatch(JAPANESE);
      expect(label.topic, label.topic).not.toMatch(JAPANESE);
      // One or two sentences.
      expect(label.reason.split(/[.!?](\s|$)/).filter((part) => part.trim().length > 1).length, label.reason).toBeLessThanOrEqual(2);
    }
  });

  it('fits every message and reply in what the inquiry content type holds', () => {
    const turns = [
      ...activity.questions.map((question) => ({ message: question.question, reply: question.handOff.reply })),
      ...activity.inquiries,
    ];
    for (const { message, reply } of turns) {
      expect(message.length).toBeLessThanOrEqual(inquirySchema.attributes.message.maxLength);
      expect(reply.length).toBeLessThanOrEqual(inquirySchema.attributes.reply.maxLength);
    }
  });

  it('spreads when each row came in over the last three days, never two at the same moment', () => {
    const received = [
      ...activity.appointments.map((visit) => visit.hoursAgo),
      ...activity.questions.map((question) => question.hoursAgo),
      ...activity.inquiries.map((inquiry) => inquiry.hoursAgo),
    ];
    for (const hours of received) {
      expect(hours).toBeGreaterThan(0);
      expect(hours).toBeLessThan(RECEIVED_WITHIN_HOURS);
    }
    // A hand-off's inquiry comes HAND_OFF_LOGGED_AFTER_MS after its question, so no other row may be that close to a question.
    const moments = [...received.map((hours) => hours * HOUR_MS), ...activity.questions.map((question) => question.hoursAgo * HOUR_MS - HAND_OFF_LOGGED_AFTER_MS)];
    expect(new Set(moments).size).toBe(moments.length);
    expect(Math.max(...received) - Math.min(...received)).toBeGreaterThanOrEqual(48);
  });
});
