import { describe, expect, it } from 'vitest';
import knowledgeSchema from '../../server/src/content-types/knowledge/schema.json';
import { CLOSE_REASONS, INQUIRY_FILTERS, INQUIRY_KINDS, SENTIMENT_LABELS } from '../../server/src/constants';
import {
  answerInput,
  changeLabelInput,
  closeInquiryInput,
  handOffToStaffInput,
  inquiryListInput,
  isoDateInput,
  isoDateTimeInput,
  logInquiryInput,
  questionOutput,
  replyInquiryInput,
} from '../../server/src/mcp/schemas';

/** The messages a schema gives for a value; none when it's valid. */
const messagesOf = (schema: typeof isoDateInput, value: string) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('isoDateInput', () => {
  it.each(['2026-10-10', '2028-02-29'])('accepts the real date %s', (value) => {
    expect(messagesOf(isoDateInput, value)).toEqual([]);
  });

  it.each(['2026-02-29', '2026-09-31', '2026-02-31'])('rejects %s, which is not on the calendar', (value) => {
    expect(messagesOf(isoDateInput, value)).toEqual(['Not a real calendar date.']);
  });

  it('asks for YYYY-MM-DD when the format is wrong, and only that', () => {
    expect(messagesOf(isoDateInput, '10/10/2026')).toEqual(['Use YYYY-MM-DD.']);
  });
});

describe('isoDateTimeInput', () => {
  it.each(['2026-10-10T14:00:00+09:00', '2028-02-29T14:00+09:00', '2026-10-10T05:00:00Z', '2026-10-10T23:59:59.999+09:00'])(
    'accepts %s',
    (value) => {
      expect(messagesOf(isoDateTimeInput, value)).toEqual([]);
    }
  );

  it.each(['2026-09-31T14:00:00+09:00', '2026-02-29T14:00:00+09:00'])('rejects %s, whose day is not on the calendar', (value) => {
    expect(messagesOf(isoDateTimeInput, value)).toEqual(['Not a real calendar date.']);
  });

  it.each(['2026-10-10T24:00:00+09:00', '2026-10-10T24:00+09:00'])('rejects the hour 24 in %s', (value) => {
    expect(messagesOf(isoDateTimeInput, value)).toEqual(['Not a real time of day: the hour must be 00 to 23.']);
  });

  it('asks for ISO 8601 with a time zone when the format is wrong, and only that', () => {
    expect(messagesOf(isoDateTimeInput, 'next Saturday')).toEqual([
      'Use ISO 8601 with a time zone, e.g. 2026-10-10T14:00:00+09:00.',
    ]);
  });
});

describe('handOffToStaffInput', () => {
  const parse = (value: Record<string, unknown>) => handOffToStaffInput.safeParse(value);

  it.each([1, 1000])('accepts a question of %i characters', (length) => {
    expect(parse({ question: 'x'.repeat(length) }).success).toBe(true);
  });

  it('trims the question', () => {
    expect(parse({ question: '  Can the coffret hold a watch?\n' }).data?.question).toBe('Can the coffret hold a watch?');
  });

  it('counts the question after trimming it: 1,000 characters between spaces are accepted', () => {
    expect(parse({ question: ` ${'x'.repeat(1000)} ` }).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['whitespace only', ' \n\t '],
    ['1,001 characters', 'x'.repeat(1001)],
  ])('refuses a question that is %s', (_label, question) => {
    const result = parse({ question });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['question']);
  });

  it('refuses a call with no question', () => {
    expect(parse({}).success).toBe(false);
  });

  it.each(['no_answer', 'asked_for_person'])('accepts the reason %s', (reason) => {
    expect(parse({ question: 'x', reason }).data?.reason).toBe(reason);
  });

  it('leaves the reason out when it is not given: the tool makes it no_answer', () => {
    expect(parse({ question: 'x' }).data).toEqual({ question: 'x' });
  });

  it.each(['other', 'NO_ANSWER', ''])('refuses the reason "%s"', (reason) => {
    const result = parse({ question: 'x', reason });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['reason']);
  });

  it('accepts a productSlug that is a slug', () => {
    expect(parse({ question: 'x', productSlug: 'jewelry-coffret' }).data?.productSlug).toBe('jewelry-coffret');
  });

  it.each([
    ['capitals and a space', 'Jewelry Coffret'],
    ['an underscore', 'jewelry_coffret'],
    ['Japanese', 'ジュエリー'],
    ['nothing', ''],
    ['121 characters', 'a'.repeat(121)],
  ])('refuses a productSlug that is not a slug: %s', (_label, productSlug) => {
    const result = parse({ question: 'x', productSlug });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['productSlug']);
  });

  it.each(['ja', 'en'])('accepts the locale %s, and refuses another', (locale) => {
    expect(parse({ question: 'x', locale }).data?.locale).toBe(locale);
    expect(parse({ question: 'x', locale: 'fr' }).success).toBe(false);
  });

  it('has no customer field: whatever an argument says about the customer is dropped', () => {
    const subject = `line:U${'b'.repeat(32)}`;
    expect(parse({ question: 'x', subject, customer: subject }).data).toEqual({ question: 'x' });
  });
});

describe('questionOutput', () => {
  it('is an open question with its reference, and its piece or none', () => {
    const piece = { slug: 'jewelry-coffret', name: 'Jewelry Coffret' };
    expect(questionOutput.safeParse({ reference: 'Q-4821', status: 'open', product: piece }).success).toBe(true);
    expect(questionOutput.safeParse({ reference: 'Q-4821', status: 'open', product: null }).success).toBe(true);
  });

  it.each(['taken', 'answered'])('is never a question that is already %s', (status) => {
    expect(questionOutput.safeParse({ reference: 'Q-4821', status, product: null }).success).toBe(false);
  });
});

describe('answerInput, the title of the knowledge entry', () => {
  const ANSWER = { text: 'Yes, a watch up to 42 mm fits.', addToKnowledge: true, category: 'sizing' };
  const parse = (value: Record<string, unknown>) => answerInput.safeParse({ ...ANSWER, ...value });

  it('needs no title: without one the question is the title, and the parsed answer has no title at all', () => {
    const result = parse({});
    expect(result.success).toBe(true);
    expect(result.data).toEqual(ANSWER);
    expect(Object.keys(result.data ?? {})).not.toContain('title');
  });

  it('takes a title, and trims it', () => {
    expect(parse({ title: '  Does a watch fit in the coffret?\n' }).data?.title).toBe('Does a watch fit in the coffret?');
  });

  it.each([1, 200])('accepts a title of %i characters', (length) => {
    expect(parse({ title: 'x'.repeat(length) }).success).toBe(true);
  });

  it('counts the title after trimming it: 200 characters between spaces are accepted', () => {
    expect(parse({ title: ` ${'x'.repeat(200)} ` }).data?.title).toBe('x'.repeat(200));
  });

  it('counts UTF-16 units, as Strapi does for a title: 100 emoji fit, and 101 do not', () => {
    expect(parse({ title: '😀'.repeat(100) }).success).toBe(true);
    expect(parse({ title: '😀'.repeat(101) }).success).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['whitespace only', ' \n\t '],
    ['201 characters', 'x'.repeat(201)],
    ['not text', 42],
  ])('refuses a title that is %s', (_label, title) => {
    const result = parse({ title });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['title']);
  });

  it("allows as many characters as a knowledge entry's title holds", () => {
    const { maxLength } = knowledgeSchema.attributes.title;
    expect(maxLength).toBe(200);
    expect(parse({ title: 'x'.repeat(maxLength) }).success).toBe(true);
    expect(parse({ title: 'x'.repeat(maxLength + 1) }).success).toBe(false);
  });

  it('accepts a title when the answer is not added to product knowledge, for the service to leave unused', () => {
    const result = answerInput.safeParse({ text: ANSWER.text, addToKnowledge: false, title: 'Anything' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ text: ANSWER.text, addToKnowledge: false, title: 'Anything' });
  });

  it('still needs a category to add the answer to product knowledge, whatever the title', () => {
    const result = answerInput.safeParse({ text: ANSWER.text, addToKnowledge: true, title: 'Does a watch fit?' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['category']);
  });
});

describe('logInquiryInput', () => {
  const TURN = { message: 'Can the coffret hold a watch?', knowledgeFound: false, handedOff: true };
  const parse = (value: Record<string, unknown>) => logInquiryInput.safeParse({ ...TURN, ...value });
  const refusedAt = (value: Record<string, unknown>) => {
    const result = parse(value);
    expect(result.success).toBe(false);
    return result.error?.issues[0].path;
  };

  it('needs only the message and the two facts: the rest is left out of what it parses', () => {
    expect(logInquiryInput.safeParse(TURN).data).toEqual(TURN);
  });

  it('takes everything a turn has', () => {
    const full = { ...TURN, reply: "I'll pass this to our team.", questionReference: 'Q-4821', productSlug: 'jewelry-coffret', locale: 'en' };
    expect(logInquiryInput.safeParse(full).data).toEqual(full);
  });

  it.each([1, 4000])('accepts a message of %i characters', (length) => {
    expect(parse({ message: 'x'.repeat(length) }).success).toBe(true);
  });

  it('trims the message, and counts it after trimming', () => {
    expect(parse({ message: '  Can the coffret hold a watch?\n' }).data?.message).toBe('Can the coffret hold a watch?');
    expect(parse({ message: ` ${'x'.repeat(4000)} ` }).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['whitespace only', ' \n\t '],
    ['4,001 characters', 'x'.repeat(4001)],
  ])('refuses a message that is %s', (_label, message) => {
    expect(refusedAt({ message })).toEqual(['message']);
  });

  it('refuses a call with no message', () => {
    expect(logInquiryInput.safeParse({ knowledgeFound: false, handedOff: false }).success).toBe(false);
  });

  it.each([0, 1, 8000])('accepts a reply of %i characters: a turn can end with no text at all', (length) => {
    expect(parse({ reply: 'y'.repeat(length) }).success).toBe(true);
  });

  it('refuses a reply of 8,001 characters', () => {
    expect(refusedAt({ reply: 'y'.repeat(8001) })).toEqual(['reply']);
  });

  it.each(['knowledgeFound', 'handedOff'])('needs %s, as true or false', (field) => {
    const { [field]: _left, ...without } = TURN as Record<string, unknown>;
    expect(logInquiryInput.safeParse(without).success).toBe(false);
    expect(refusedAt({ [field]: 'yes' })).toEqual([field]);
    expect(refusedAt({ [field]: null })).toEqual([field]);
    expect(parse({ [field]: true }).success).toBe(true);
    expect(parse({ [field]: false }).success).toBe(true);
  });

  it('takes a question reference like Q-4821', () => {
    expect(parse({ questionReference: 'Q-4821' }).data?.questionReference).toBe('Q-4821');
  });

  it.each([
    ['too few digits', 'Q-482'],
    ['too many digits', 'Q-48210'],
    ['a small q', 'q-4821'],
    ['an appointment reference', 'APT-4821'],
    ['text around it', ' Q-4821'],
    ['nothing', ''],
  ])('refuses a question reference with %s', (_label, questionReference) => {
    expect(refusedAt({ questionReference })).toEqual(['questionReference']);
  });

  it('takes a productSlug that is a slug, and refuses one that is not', () => {
    expect(parse({ productSlug: 'jewelry-coffret' }).data?.productSlug).toBe('jewelry-coffret');
    for (const productSlug of ['Jewelry Coffret', 'jewelry_coffret', 'ジュエリー', '', 'a'.repeat(121)]) {
      expect(refusedAt({ productSlug }), productSlug).toEqual(['productSlug']);
    }
  });

  it.each(['ja', 'en'])('accepts the locale %s, and refuses another', (locale) => {
    expect(parse({ locale }).data?.locale).toBe(locale);
    expect(parse({ locale: 'fr' }).success).toBe(false);
  });

  it('has no customer field: whatever an argument says about the customer is dropped', () => {
    const subject = `line:U${'b'.repeat(32)}`;
    expect(parse({ subject, customer: subject, kind: 'praise', queue: 'praise' }).data).toEqual(TURN);
  });
});

describe('inquiryListInput', () => {
  const parse = (value: Record<string, unknown>) => inquiryListInput.safeParse(value);

  it('needs nothing', () => {
    expect(parse({}).data).toEqual({});
  });

  it.each(INQUIRY_FILTERS)('accepts the filter %s', (filter) => {
    expect(parse({ filter }).data?.filter).toBe(filter);
  });

  it('takes its filters from the one list in the constants: the same five, in the same order', () => {
    expect(inquiryListInput.shape.filter.unwrap().options).toEqual([...INQUIRY_FILTERS]);
  });

  it.each(['open', 'needs_answer', 'Praise', ''])('refuses the filter "%s"', (filter) => {
    const result = parse({ filter });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['filter']);
  });

  it.each([1, 50, 100])('accepts a limit of %i', (limit) => {
    expect(parse({ limit }).data?.limit).toBe(limit);
  });

  it.each([0, -1, 101, 1.5, '20'])('refuses a limit of %j', (limit) => {
    const result = parse({ limit });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['limit']);
  });
});

describe('closeInquiryInput', () => {
  it.each(CLOSE_REASONS)('accepts the reason %s', (reason) => {
    expect(closeInquiryInput.safeParse({ reason }).data).toEqual({ reason });
  });

  it.each([['another reason', 'resolved'], ['nothing', ''], ['a capital', 'Spam']])('refuses %s', (_label, reason) => {
    const result = closeInquiryInput.safeParse({ reason });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['reason']);
  });

  it('needs a reason', () => {
    expect(closeInquiryInput.safeParse({}).success).toBe(false);
  });
});

describe('changeLabelInput', () => {
  const parse = (value: Record<string, unknown>) => changeLabelInput.safeParse(value);

  it.each(INQUIRY_KINDS)('accepts the kind %s alone', (kind) => {
    expect(parse({ kind }).data).toEqual({ kind });
  });

  it.each(SENTIMENT_LABELS)('accepts the sentiment %s alone', (sentimentLabel) => {
    expect(parse({ sentimentLabel }).data).toEqual({ sentimentLabel });
  });

  it('accepts both', () => {
    expect(parse({ kind: 'praise', sentimentLabel: 'positive' }).data).toEqual({ kind: 'praise', sentimentLabel: 'positive' });
  });

  it.each([
    ['nothing', {}],
    ['a kind and a sentiment that are both left out', { kind: undefined, sentimentLabel: undefined }],
  ])('refuses %s, and says what to give', (_label, value) => {
    const result = parse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['Give a kind, a sentiment, or both.']);
  });

  it.each([
    ['a kind that is not one', { kind: 'angry' }, 'kind'],
    ['a sentiment that is not one', { sentimentLabel: 'angry' }, 'sentimentLabel'],
    ['a score in place of a label', { sentimentLabel: -0.6 }, 'sentimentLabel'],
  ])('refuses %s', (_label, value, field) => {
    const result = parse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual([field]);
  });
});

describe('replyInquiryInput', () => {
  const parse = (value: Record<string, unknown>) => replyInquiryInput.safeParse(value);

  it('takes the text, trimmed', () => {
    expect(parse({ text: '  We are sorry.\n' }).data).toEqual({ text: 'We are sorry.' });
  });

  it('keeps the line breaks and the spaces inside the text', () => {
    expect(parse({ text: 'Thank you.\n\n  We will call you.' }).data).toEqual({ text: 'Thank you.\n\n  We will call you.' });
  });

  it.each([1, 2000])('accepts a text of %i characters', (length) => {
    expect(parse({ text: 'x'.repeat(length) }).success).toBe(true);
  });

  it('counts the text after trimming it: 2,000 characters between spaces are accepted', () => {
    expect(parse({ text: ` ${'x'.repeat(2000)} ` }).data).toEqual({ text: 'x'.repeat(2000) });
  });

  it.each([
    ['an empty text', ''],
    ['a text of spaces and line breaks', '  \n '],
    ['a text of 2,001 characters', 'x'.repeat(2001)],
    ['a text that is not a string', 42],
    ['a text that is null', null],
  ])('refuses %s', (_label, text) => {
    const result = parse({ text });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['text']);
  });

  it('needs a text', () => {
    const result = parse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['text']);
  });

  it('has no field for who replies: whatever an argument says about the staff member is dropped', () => {
    expect(parse({ text: 'Thank you.', staffName: 'Mallory', repliedBy: 'Mallory', customer: 'line:Uaaa' }).data).toEqual({ text: 'Thank you.' });
  });
});
