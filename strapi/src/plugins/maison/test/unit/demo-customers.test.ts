import { describe, expect, it } from 'vitest';
import activity from '../../server/seed/activity.json';
import { mapConcurrently } from '../../server/src/domain/concurrency';
import { assignActivity, isDemoCustomer, isYourLine, type ActivitySeed } from '../../server/src/domain/demo-activity';
import { DEMO_DETAIL } from '../../server/src/domain/line-outcome';

const seed = activity as ActivitySeed;
const SUBJECTS = activity.customers.map((customer) => customer.subject);
const subjectOf = (key: string) => activity.customers.find((customer) => customer.key === key)?.subject;
/** Paul's own LINE account, as the plugin's demoLineUserId names it, as a subject. */
const YOU = `line:U${'0123456789abcdef'.repeat(2)}`;
/** The same account as demoLineUserId has it: the LINE user ID, without the `line:` prefix. */
const YOU_ID = YOU.slice('line:'.length);

describe('isDemoCustomer', () => {
  it("is true for each of the five made-up customers in activity.json, and only for them", () => {
    for (const subject of SUBJECTS) expect(isDemoCustomer(subject), subject).toBe(true);
    expect(SUBJECTS).toHaveLength(5);
  });

  it.each([
    ['a real-looking customer', `line:U${'a'.repeat(32)}`],
    ['Paul\'s own account', YOU],
    ['a made-up subject that is not in the seed', 'line:Udec0de00000000000000000000000009'],
    ['a made-up subject without its line: prefix', 'Udec0de00000000000000000000000001'],
    ['a made-up subject in capitals', 'line:UDEC0DE00000000000000000000000001'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
  ])('is false for %s', (_label, subject) => {
    expect(isDemoCustomer(subject)).toBe(false);
  });
});

describe('isYourLine', () => {
  it("is true for the subject of the presenter's own LINE account, and only for it", () => {
    expect(isYourLine(YOU, YOU_ID)).toBe(true);
  });

  it('is false for every subject when demoLineUserId is not set, the presenter\'s own included', () => {
    expect(isYourLine(YOU, null)).toBe(false);
    expect(isYourLine(YOU, undefined as never)).toBe(false);
    expect(isYourLine(YOU, '')).toBe(false);
    expect(isYourLine('line:', '')).toBe(false);
    expect(isYourLine('line:', null)).toBe(false);
  });

  it('is false for each of the five made-up customers, who are demo customers and not you', () => {
    for (const subject of SUBJECTS) {
      expect(isYourLine(subject, YOU_ID), subject).toBe(false);
      expect(isDemoCustomer(subject), subject).toBe(true);
    }
  });

  it("is never true for a made-up customer's subject: no subject is both yours and a demo customer's", () => {
    expect([YOU, ...SUBJECTS].filter((subject) => isYourLine(subject, YOU_ID) && isDemoCustomer(subject))).toEqual([]);
  });

  it.each([
    ['another real customer', `line:U${'a'.repeat(32)}`],
    ['an ID that only starts like yours', `${YOU}0`],
    ['an ID that only ends like yours', `line:Ux${YOU_ID}`],
    ['your ID without its line: prefix', YOU_ID],
    ['your subject in capitals', YOU.toUpperCase()],
    ['your subject with a space after it', `${YOU} `],
    ['your subject with a space before it', ` ${YOU}`],
    ['a made-up subject that is not in the seed', 'line:Udec0de00000000000000000000000009'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', { customer: YOU }],
    ['an array holding your subject', [YOU]],
    ['a String object, which is not a string', new String(YOU)],
  ])('is false for %s', (_label, subject) => {
    expect(isYourLine(subject, YOU_ID)).toBe(false);
  });

  it('reads the ID it is given, so a different ID names a different account', () => {
    const other = `U${'f'.repeat(32)}`;
    expect(isYourLine(`line:${other}`, other)).toBe(true);
    expect(isYourLine(YOU, other)).toBe(false);
  });
});

describe('the demo outcome', () => {
  it('says what happened in plain words', () => {
    expect(DEMO_DETAIL).toBe('Demo customer: no LINE message');
  });
});

describe('the demo activity seed: the items for your own LINE account', () => {
  const yours = <T extends { owner?: string }>(items: T[]) => items.filter((item) => item.owner === 'you');

  it('are one waiting request, one open question with no answer in product knowledge, and one complaint', () => {
    const [request, ...otherRequests] = yours(activity.appointments);
    expect(otherRequests).toEqual([]);
    expect(request.confirmed).toBe(false);

    const [question, ...otherQuestions] = yours(activity.questions);
    expect(otherQuestions).toEqual([]);
    expect(question).toMatchObject({ status: 'open', reason: 'no_answer' });

    const [inquiry, ...otherInquiries] = yours(activity.inquiries);
    expect(otherInquiries).toEqual([]);
    expect(inquiry.labels?.kind).toBe('complaint');
  });

  it('mark nothing else, and use no owner but "you"', () => {
    for (const item of [...activity.appointments, ...activity.questions, ...activity.inquiries]) {
      expect([undefined, 'you']).toContain((item as { owner?: string }).owner);
    }
  });
});

describe('assignActivity', () => {
  const subjects = (assigned: Array<{ subject: string }>) => assigned.map((entry) => entry.subject);

  it('gives every item to its made-up customer when there is no account of yours', () => {
    const assigned = assignActivity(seed, { you: null, youCanRequest: true });
    expect(subjects(assigned.appointments)).toEqual(seed.appointments.map((visit) => subjectOf(visit.customer)));
    expect(subjects(assigned.questions)).toEqual(seed.questions.map((question) => subjectOf(question.customer)));
    expect(subjects(assigned.inquiries)).toEqual(seed.inquiries.map((inquiry) => subjectOf(inquiry.customer)));
    for (const entry of [...assigned.appointments, ...assigned.questions, ...assigned.inquiries]) {
      expect(entry.yours).toBe(false);
      expect(isDemoCustomer(entry.subject)).toBe(true);
    }
  });

  it('gives you the three items marked "you", and every other item to its made-up customer, in the order of the seed', () => {
    const assigned = assignActivity(seed, { you: YOU, youCanRequest: true });
    const expected = <T extends { customer: string; owner?: string }>(items: T[]) =>
      items.map((item) => (item.owner === 'you' ? YOU : subjectOf(item.customer)));
    expect(subjects(assigned.appointments)).toEqual(expected(seed.appointments));
    expect(subjects(assigned.questions)).toEqual(expected(seed.questions));
    expect(subjects(assigned.inquiries)).toEqual(expected(seed.inquiries));

    const mine = [...assigned.appointments, ...assigned.questions, ...assigned.inquiries].filter((entry) => entry.yours);
    expect(mine).toHaveLength(3);
    for (const entry of mine) expect(entry.subject).toBe(YOU);
    expect(assigned.appointments.map((entry) => entry.item)).toEqual(seed.appointments);
    expect(assigned.questions.map((entry) => entry.item)).toEqual(seed.questions);
    expect(assigned.inquiries.map((entry) => entry.item)).toEqual(seed.inquiries);
  });

  it('leaves your request with its made-up customer when your account has as many open requests as a customer may have', () => {
    const assigned = assignActivity(seed, { you: YOU, youCanRequest: false });
    expect(assigned.appointments.every((entry) => !entry.yours && isDemoCustomer(entry.subject))).toBe(true);
    expect(assigned.questions.filter((entry) => entry.yours)).toHaveLength(1);
    expect(assigned.inquiries.filter((entry) => entry.yours)).toHaveLength(1);
  });

  it('throws for an item whose customer the seed does not name', () => {
    const broken = { ...seed, inquiries: [{ ...seed.inquiries[0], customer: 'nobody' }] };
    expect(() => assignActivity(broken, { you: null, youCanRequest: true })).toThrow(/nobody/);
  });
});

describe('mapConcurrently', () => {
  /** A task per item that waits for its turn to end, so a test can see how many run at once. */
  const tracker = () => {
    let running = 0;
    let most = 0;
    const started: number[] = [];
    const task = async (item: number) => {
      started.push(item);
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return item * 10;
    };
    return { task, started, most: () => most };
  };

  it('answers each result in the order of the items', async () => {
    const { task } = tracker();
    expect(await mapConcurrently([1, 2, 3, 4, 5, 6], 4, task)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('runs at most `limit` at once, and that many when there are enough', async () => {
    const { task, most } = tracker();
    await mapConcurrently(Array.from({ length: 16 }, (_, index) => index), 4, task);
    expect(most()).toBe(4);
  });

  it('starts the items in order', async () => {
    const { task, started } = tracker();
    await mapConcurrently([1, 2, 3, 4, 5, 6, 7], 3, task);
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('answers an empty list for no items, and calls nothing', async () => {
    const { task, started } = tracker();
    expect(await mapConcurrently([], 4, task)).toEqual([]);
    expect(started).toEqual([]);
  });

  it('rejects with the first failure, and starts no item after it', async () => {
    const started: number[] = [];
    const work = async (item: number) => {
      started.push(item);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (item === 2) throw new Error('database is locked');
      return item;
    };
    await expect(mapConcurrently([1, 2, 3, 4, 5, 6, 7, 8], 2, work)).rejects.toThrow('database is locked');
    // Items 1 and 2 ran together; 3 started when 1 ended, at the same moment 2 failed. Nothing started after that.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toEqual([1, 2, 3]);
  });
});
