import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANSWER_LIMIT,
  CATEGORY_OPTIONS,
  REASON_LABELS,
  TITLE_LIMIT,
  answerBody,
  askedAt,
  canAnswer,
  canLetThemKnow,
  canSendAnswer,
  OPEN_QUESTIONS,
  countOfQuestions,
  defaultTitle,
  replyNotice,
  statusLabel,
} from '../../admin/src/questions';
import { YOUR_LINE_LABEL, yourLineBadge } from '../../admin/src/your-line';
import { KNOWLEDGE_CATEGORIES, QUESTION_REASONS } from '../../server/src/constants';
import { knowledgeTitleOf } from '../../server/src/domain/question-messages';
import { answerInput, questionsListInput } from '../../server/src/mcp/schemas';
import questionsService from '../../server/src/services/questions';
import { fakeStrapi } from './fake-strapi';

describe('statusLabel', () => {
  it('says Open for a question nobody has taken', () => {
    expect(statusLabel({ status: 'open', staffName: null })).toBe('Open');
  });

  it('names the staff member who took a question, and who answered it', () => {
    expect(statusLabel({ status: 'taken', staffName: 'Jane' })).toBe('Taken by Jane');
    expect(statusLabel({ status: 'answered', staffName: 'Jane' })).toBe('Answered by Jane');
  });

  it.each([null, ''])('says "staff" when the name is missing (%j)', (staffName) => {
    expect(statusLabel({ status: 'taken', staffName })).toBe('Taken by staff');
    expect(statusLabel({ status: 'answered', staffName })).toBe('Answered by staff');
  });
});

describe('REASON_LABELS', () => {
  it('words the two reasons the concierge hands a question over for', () => {
    expect(REASON_LABELS).toEqual({ no_answer: 'No answer in product knowledge', asked_for_person: 'Asked for a person' });
  });

  it('labels every reason the server records, and no other', () => {
    expect(Object.keys(REASON_LABELS)).toEqual([...QUESTION_REASONS]);
  });
});

describe('the buttons a question gets', () => {
  it.each([
    ['open', true, true],
    ['taken', false, true],
    ['answered', false, false],
  ] as const)('%s: Let them know is %s, Answer is %s', (status, letThemKnow, answer) => {
    expect(canLetThemKnow({ status })).toBe(letThemKnow);
    expect(canAnswer({ status })).toBe(answer);
  });
});

describe('CATEGORY_OPTIONS', () => {
  it("has the server's knowledge categories as its values, in the server's order", () => {
    expect(CATEGORY_OPTIONS.map(({ value }) => value)).toEqual([...KNOWLEDGE_CATEGORIES]);
  });

  it('labels each category in words staff know', () => {
    expect(CATEGORY_OPTIONS).toEqual([
      { value: 'care', label: 'Care' },
      { value: 'materials', label: 'Materials' },
      { value: 'sizing', label: 'Sizing' },
      { value: 'personalization', label: 'Personalization' },
      { value: 'delivery', label: 'Delivery' },
      { value: 'returns', label: 'Returns' },
      { value: 'repairs', label: 'Repairs' },
      { value: 'warranty', label: 'Warranty' },
      { value: 'gifting', label: 'Gifting' },
      { value: 'store', label: 'Boutiques and service' },
    ]);
  });
});

describe('askedAt', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('writes the moment in Tokyo time, whatever time zone the browser is in', () => {
    // Tokyo is 9 hours ahead of UTC. Los Angeles is a day behind it, and Kiritimati is 14 hours ahead of it.
    for (const zone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = zone;
      expect(askedAt('2026-10-03T01:12:00.000Z'), zone).toBe('2026-10-03 10:12');
    }
  });

  it("gives Tokyo's date, not UTC's, across a date boundary, and writes midnight as 00:00", () => {
    process.env.TZ = 'UTC';
    expect(askedAt('2026-10-02T15:00:00.000Z')).toBe('2026-10-03 00:00');
    expect(askedAt('2026-12-31T14:59:00.000Z')).toBe('2026-12-31 23:59');
  });

  it('pads every part, and reads an offset as well as Z', () => {
    expect(askedAt('2026-01-05T00:07:00.000Z')).toBe('2026-01-05 09:07');
    expect(askedAt('2026-10-03T10:12:00+09:00')).toBe('2026-10-03 10:12');
  });

  it("shows a value that isn't a date as it came, instead of failing the whole table", () => {
    expect(askedAt('soon')).toBe('soon');
  });
});

describe('the answer the dialog sends', () => {
  const TITLE = 'Does a watch fit in the coffret?';

  it('leaves category and title out when Add to product knowledge is unticked, even if they were filled in before', () => {
    const body = answerBody({ text: 'Yes, a watch up to 42 mm fits.', addToKnowledge: false, category: 'care', title: TITLE });
    expect(body).toEqual({ text: 'Yes, a watch up to 42 mm fits.', addToKnowledge: false });
    expect(Object.keys(body)).not.toContain('category');
    expect(Object.keys(body)).not.toContain('title');
    expect(answerInput.safeParse(body).success).toBe(true);
  });

  it("never says no category with null or an empty string: the server's schema refuses both", () => {
    const body = answerBody({ text: 'Yes.', addToKnowledge: false, category: '', title: '' });
    for (const category of [null, '']) {
      expect(answerInput.safeParse({ ...body, category }).success, JSON.stringify(category)).toBe(false);
    }
  });

  it('sends the category and the title with the box ticked, and the server accepts every category the select offers', () => {
    for (const { value } of CATEGORY_OPTIONS) {
      const body = answerBody({ text: 'Yes.', addToKnowledge: true, category: value, title: TITLE });
      expect(body).toEqual({ text: 'Yes.', addToKnowledge: true, category: value, title: TITLE });
      expect(answerInput.safeParse(body).success, value).toBe(true);
    }
  });

  it('sends the answer and the title as they were typed: the server trims them', () => {
    const body = answerBody({ text: '  Yes.\n\nNo charge. ', addToKnowledge: true, category: 'care', title: `  ${TITLE} ` });
    expect(body.text).toBe('  Yes.\n\nNo charge. ');
    expect(body.title).toBe(`  ${TITLE} `);
    expect(answerInput.parse(body).title).toBe(TITLE);
    expect(answerBody({ text: '  Yes.\n\nNo charge. ', addToKnowledge: false, category: '', title: '' }).text).toBe('  Yes.\n\nNo charge. ');
  });
});

describe('the title the dialog starts with', () => {
  it("is the customer's question", () => {
    expect(defaultTitle('Can the coffret hold a watch?')).toBe('Can the coffret hold a watch?');
  });

  it('has its whitespace collapsed and its ends trimmed', () => {
    expect(defaultTitle('  Can the coffret\n hold   a watch?\n')).toBe('Can the coffret hold a watch?');
  });

  it.each([
    ['200 letters stay whole', 'a'.repeat(200), 'a'.repeat(200)],
    ['201 letters become 199 and an ellipsis', 'a'.repeat(201), `${'a'.repeat(199)}…`],
    ['100 emoji, 200 units, stay whole', '😀'.repeat(100), '😀'.repeat(100)],
    ['101 emoji become 99 and an ellipsis, none in half', '😀'.repeat(101), `${'😀'.repeat(99)}…`],
    ['199 letters and an emoji, whose halves straddle the cut, become the 199 letters and an ellipsis', `${'a'.repeat(199)}😀`, `${'a'.repeat(199)}…`],
    ['a question of 1,000 letters, as long as one gets, becomes 199 and an ellipsis', 'a'.repeat(1000), `${'a'.repeat(199)}…`],
  ])('is cut like this: %s', (_label, question, title) => {
    expect(defaultTitle(question)).toBe(title);
    expect(defaultTitle(question).length).toBeLessThanOrEqual(TITLE_LIMIT);
  });

  it("is what the server would have made of the question, so leaving it alone changes nothing", () => {
    const questions = [
      'Can the coffret hold a watch?',
      '  腕時計は\u3000入りますか？ ',
      'Does it\nfit\t a watch?',
      'a'.repeat(201),
      `Can the coffret hold ${'😀'.repeat(150)} a watch?`,
      `${'a'.repeat(199)}😀`,
      '😀'.repeat(1000),
    ];
    for (const question of questions) expect(defaultTitle(question), question.slice(0, 20)).toBe(knowledgeTitleOf(question));
  });

  it('is one the server takes as a title, whatever the question', () => {
    for (const question of ['Can it?', 'a'.repeat(1000), '😀'.repeat(1000)]) {
      const body = answerBody({ text: 'Yes.', addToKnowledge: true, category: 'care', title: defaultTitle(question) });
      expect(answerInput.safeParse(body).success, question.slice(0, 20)).toBe(true);
    }
  });
});

describe('Send on LINE', () => {
  const TITLE = 'Does a watch fit in the coffret?';

  it.each([
    ['no answer yet', { text: '', addToKnowledge: false, category: '', title: '' }, false],
    ['an answer of only spaces and line breaks', { text: ' \n ', addToKnowledge: false, category: '', title: '' }, false],
    ['an answer, with the box unticked', { text: 'Yes.', addToKnowledge: false, category: '', title: '' }, true],
    ['an answer, the box ticked and no category yet', { text: 'Yes.', addToKnowledge: true, category: '', title: TITLE }, false],
    ['an answer, the box ticked, a category and a title', { text: 'Yes.', addToKnowledge: true, category: 'care', title: TITLE }, true],
    ['a category and a title but no answer', { text: '', addToKnowledge: true, category: 'care', title: TITLE }, false],
    ['a category the select does not offer', { text: 'Yes.', addToKnowledge: true, category: 'nonsense', title: TITLE }, false],
  ])('is enabled for %s: %s', (_label, form, enabled) => {
    expect(canSendAnswer(form)).toBe(enabled);
  });

  describe('the title in product knowledge', () => {
    const ticked = (title: string) => ({ text: 'Yes.', addToKnowledge: true, category: 'care', title });

    it.each([
      ['empty', false, ''],
      ['only spaces', false, '   '],
      ['only a line break and a tab', false, '\n\t'],
      ['a letter', true, 'T'],
      ['200 characters', true, 'x'.repeat(200)],
      ['200 characters between spaces', true, ` ${'x'.repeat(200)} `],
      ['201 characters', false, 'x'.repeat(201)],
      ['100 emoji, which are 200 units', true, '😀'.repeat(100)],
      ['101 emoji, which are 202 units', false, '😀'.repeat(101)],
    ])('with the box ticked, a title of %s: enabled is %s', (_label, enabled, title) => {
      expect(canSendAnswer(ticked(title))).toBe(enabled);
    });

    it.each([
      ['empty', ''],
      ['only spaces', '   '],
      ['500 characters', 'x'.repeat(500)],
    ])('is not looked at with the box unticked, so a title of %s keeps it enabled', (_label, title) => {
      expect(canSendAnswer({ text: 'Yes.', addToKnowledge: false, category: '', title })).toBe(true);
    });
  });

  describe('the answer', () => {
    it.each([
      ['1 character', true, 'x'],
      ['2,000 characters', true, 'x'.repeat(2000)],
      ['2,000 characters between spaces and line breaks', true, `\n ${'x'.repeat(2000)} \n`],
      ['2,001 characters', false, 'x'.repeat(2001)],
      ['1,001 emoji, which are 2,002 units', false, '😀'.repeat(1001)],
    ])('with an answer of %s, enabled is %s, with the box ticked or not', (_label, enabled, text) => {
      expect(canSendAnswer({ text, addToKnowledge: false, category: '', title: '' })).toBe(enabled);
      expect(canSendAnswer({ text, addToKnowledge: true, category: 'care', title: 'T' })).toBe(enabled);
    });

    it("has the server's limits: 2,000 characters for the answer and 200 for the title", () => {
      expect(ANSWER_LIMIT).toBe(2000);
      expect(TITLE_LIMIT).toBe(200);
    });
  });

  // Send on LINE is enabled exactly when the server would take what it posts, so the dialog never sends what is refused,
  // and never holds back what is fine.
  it('is enabled exactly when the server takes the body: every mix of answer, box, category and title', () => {
    const texts = ['', ' \n ', 'Yes.', 'x'.repeat(2000), 'x'.repeat(2001), ` ${'x'.repeat(2000)} `, '😀'.repeat(1000), '😀'.repeat(1001)];
    const categories = ['', 'care', 'nonsense'];
    const titles = ['', '   ', 'T', 'x'.repeat(200), 'x'.repeat(201), ` ${'x'.repeat(200)} `, '😀'.repeat(100), '😀'.repeat(101)];
    let combinations = 0;
    for (const text of texts) {
      for (const addToKnowledge of [true, false]) {
        for (const category of categories) {
          for (const title of titles) {
            const form = { text, addToKnowledge, category, title };
            const taken = answerInput.safeParse(answerBody(form)).success;
            expect(canSendAnswer(form), JSON.stringify({ ...form, text: text.length, title: title.length })).toBe(taken);
            combinations += 1;
          }
        }
      }
    }
    expect(combinations).toBe(texts.length * 2 * categories.length * titles.length);
  });
});

describe("the notice a sent answer or Let them know shows", () => {
  const MESSAGE = 'Sent the LINE message for Q-4821.';

  it('is a success when everything went through', () => {
    expect(replyNotice({ message: MESSAGE })).toEqual({ type: 'success', message: MESSAGE });
    expect(replyNotice({ message: MESSAGE, knowledgeDocumentId: 'k-new' })).toEqual({ type: 'success', message: MESSAGE });
  });

  it('is a warning, with the server’s own words, when the server says so: the customer has the message, but something went wrong after it', () => {
    const message = "Sent the LINE message for Q-4821, but recording it failed (database is locked). Don't send it again.";
    expect(replyNotice({ message, warning: true })).toEqual({ type: 'warning', message, blockTransition: true });
  });

  // "Don't send it again" has to be read. A notice that fades after a few seconds can be missed, and the message sent twice.
  it('stays on screen until it is dismissed, for a warning', () => {
    expect(replyNotice({ message: 'Sent it, but recording it failed. Don\'t send it again.', warning: true }).blockTransition).toBe(true);
  });

  it('fades as any notice does, for a success', () => {
    expect(replyNotice({ message: MESSAGE })).not.toHaveProperty('blockTransition');
    expect(replyNotice({ message: MESSAGE, warning: false })).not.toHaveProperty('blockTransition');
  });

  it('is a success when warning is false or is not the true the server sends', () => {
    expect(replyNotice({ message: MESSAGE, warning: false })).toEqual({ type: 'success', message: MESSAGE });
    expect(replyNotice({ message: MESSAGE, warning: 'true' as unknown as boolean })).toEqual({ type: 'success', message: MESSAGE });
  });
});

describe('the number of questions on the Questions tab', () => {
  it('counts the rows of the list the route answers', () => {
    expect(countOfQuestions({ questions: [{ reference: 'Q-4821' }, { reference: 'Q-4822' }] })).toBe(2);
    expect(countOfQuestions({ questions: [] })).toBe(0);
  });

  it('is nothing for an answer that is not a list of questions, so the tab shows no number', () => {
    for (const answer of [undefined, null, 'oops', 3, [], {}, { questions: 'many' }, { questions: null }, { error: { message: 'Forbidden' } }]) {
      expect(countOfQuestions(answer), JSON.stringify(answer)).toBeNull();
    }
  });

  // The Open filter lists the open and the taken questions (questions-ask.test.ts pins it): what staff still have to answer.
  it('asks the route for the Open filter, which it takes', () => {
    expect(OPEN_QUESTIONS).toEqual({ status: 'open' });
    expect(questionsListInput.safeParse(OPEN_QUESTIONS).success).toBe(true);
  });
});

describe('the question row\'s "Your LINE" label', () => {
  const YOU_ID = `U${'5ca1ab1e'.repeat(4)}`;
  const stored = (customer: string): Record<string, unknown> => ({
    reference: 'Q-4821', customer, customerName: null, question: 'Can the coffret hold a watch?', reason: 'no_answer', language: 'en',
    productSlug: null, status: 'open', staffName: null, takenAt: null, answeredAt: null, answer: null, knowledgeDocumentId: null,
    lineOutcome: null, lineDetail: null, createdAt: '2026-10-03T01:12:00.000Z',
  });
  const viewOf = async (customer: string, config: Record<string, unknown>) => {
    const documents = () => ({ findMany: vi.fn(async () => [stored(customer)]) });
    const result = await questionsService({ strapi: fakeStrapi({ documents, config }) }).list({ status: 'all' });
    if (result.ok === false) throw new Error(result.message);
    return result.value[0];
  };

  // The page reads `yourLine` from the server's own view, so the label shows on exactly the rows the server marks.
  it("is on the presenter's own question, as the server's view says, and on no other", async () => {
    const mine = await viewOf(`line:${YOU_ID}`, { demoLineUserId: YOU_ID });
    const theirs = await viewOf(`line:U${'a'.repeat(32)}`, { demoLineUserId: YOU_ID });
    expect(yourLineBadge(mine)?.label).toBe(YOUR_LINE_LABEL);
    expect(yourLineBadge(theirs)).toBeNull();
  });

  it('is on no row when demoLineUserId is not set', async () => {
    expect(yourLineBadge(await viewOf(`line:${YOU_ID}`, {}))).toBeNull();
  });
});
