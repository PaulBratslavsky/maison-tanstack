import { describe, expect, it } from 'vitest';
import {
  QUOTE_LENGTH,
  acknowledgementText,
  answerText,
  knowledgeTitleOf,
  quoteOf,
  type QuestionMessageInput,
} from '../../server/src/domain/question-messages';

const english: QuestionMessageInput = {
  language: 'en',
  staffName: 'Jane',
  question: 'Can it hold a watch?',
  productName: 'Jewelry Coffret',
};
const japanese: QuestionMessageInput = {
  language: 'ja',
  staffName: 'Jane',
  question: '腕時計は入りますか？',
  productName: 'ジュエリー・コフレ',
};

// The Japanese signature separates Maison and the name with U+3000, the full-width space, which is spelled out here
// because it looks like an ordinary space.
const SIGNED_JA = `Maison${String.fromCodePoint(0x3000)}Jane`;

const ENGLISH_OPENING =
  'Hello, this is Jane, a client advisor at Maison. Thank you for your question about the Jewelry Coffret: "Can it hold a watch?"';
const JAPANESE_OPENING =
  'Maisonのクライアントアドバイザー、Janeでございます。ジュエリー・コフレについてのご質問「腕時計は入りますか？」をいただき、ありがとうございます。';

describe('acknowledgementText', () => {
  it('says in English who is writing, quotes the question about the piece, and promises a reply in this chat', () => {
    expect(acknowledgementText(english)).toBe(
      `${ENGLISH_OPENING} I'm looking into it and will reply here in this chat as soon as I can.\nJane, Maison`
    );
  });

  it('leaves the piece out of the English message when the question is not about one', () => {
    expect(acknowledgementText({ ...english, productName: null })).toBe(
      'Hello, this is Jane, a client advisor at Maison. Thank you for your question: "Can it hold a watch?" I\'m looking into it and will reply here in this chat as soon as I can.\nJane, Maison'
    );
  });

  it("speaks for the team in English without a staff member's name, and signs Maison alone", () => {
    const text = acknowledgementText({ ...english, staffName: null });
    expect(text).toBe(
      'Hello, this is Maison\'s client advisor team. Thank you for your question about the Jewelry Coffret: "Can it hold a watch?" I\'m looking into it and will reply here in this chat as soon as I can.\nMaison'
    );
    expect(text.startsWith("Hello, this is Maison's client advisor team. Thank you for your question")).toBe(true);
    expect(text.endsWith('\nMaison')).toBe(true);
  });

  it('puts a full stop after the quote when the question does not end a sentence', () => {
    expect(acknowledgementText({ ...english, question: 'Can it hold a watch' })).toContain(
      ': "Can it hold a watch". I\'m looking into it'
    );
  });

  it.each(['Is it open.', 'Is it open!', 'Is it open?', 'Is it open。', 'Is it open！', 'Is it open？'])(
    'adds no full stop after a quote that already ends a sentence: %s',
    (question) => {
      expect(acknowledgementText({ ...english, question })).toContain(`"${question}" I'm looking into it`);
    }
  );

  it('says it all in Japanese for a Japanese question, signed with a full-width space before the name', () => {
    const text = acknowledgementText(japanese);
    expect(text).toBe(
      'Maisonのクライアントアドバイザー、Janeでございます。ジュエリー・コフレについてのご質問「腕時計は入りますか？」をいただき、ありがとうございます。ただいま確認しておりますので、分かり次第こちらのトークでご連絡いたします。\nMaison　Jane'
    );
    expect(text.split('\n')[1].codePointAt(6)).toBe(0x3000);
  });

  it('drops the piece from the Japanese message when the question is not about one', () => {
    const text = acknowledgementText({ ...japanese, productName: null });
    expect(text).not.toContain('ジュエリー・コフレについての');
    expect(text).toBe(
      `Maisonのクライアントアドバイザー、Janeでございます。ご質問「腕時計は入りますか？」をいただき、ありがとうございます。ただいま確認しておりますので、分かり次第こちらのトークでご連絡いたします。\n${SIGNED_JA}`
    );
  });

  it("speaks for the team in Japanese without a staff member's name, and signs Maison alone", () => {
    const text = acknowledgementText({ ...japanese, staffName: null });
    expect(text.startsWith('Maisonのクライアントアドバイザーでございます。')).toBe(true);
    expect(text.endsWith('\nMaison')).toBe(true);
    expect(text).toBe(
      'Maisonのクライアントアドバイザーでございます。ジュエリー・コフレについてのご質問「腕時計は入りますか？」をいただき、ありがとうございます。ただいま確認しておりますので、分かり次第こちらのトークでご連絡いたします。\nMaison'
    );
  });

  it('quotes a long question cut to 80 characters', () => {
    const text = acknowledgementText({ ...english, question: 'a'.repeat(81) });
    expect(text).toContain(`"${'a'.repeat(79)}…".`);
  });
});

describe('answerText', () => {
  it('puts the trimmed answer between the English opening and an invitation to reply', () => {
    expect(answerText({ ...english, answer: '  Yes, a watch up to 42 mm fits.  ' })).toBe(
      `${ENGLISH_OPENING}\n\nYes, a watch up to 42 mm fits.\n\nIf anything else comes to mind, just reply here.\nJane, Maison`
    );
  });

  it('puts the trimmed answer between the Japanese opening and an invitation to reply, signed with a full-width space', () => {
    expect(answerText({ ...japanese, answer: '  はい、42mmまでの腕時計が収まります。  ' })).toBe(
      `${JAPANESE_OPENING}\n\nはい、42mmまでの腕時計が収まります。\n\nほかにもご不明な点がございましたら、こちらのトークにお気軽にご返信ください。\n${SIGNED_JA}`
    );
  });

  it('speaks for the team, and leaves the piece out, when there is no name and no piece', () => {
    expect(answerText({ ...english, staffName: null, productName: null, answer: 'Yes.' })).toBe(
      'Hello, this is Maison\'s client advisor team. Thank you for your question: "Can it hold a watch?"\n\nYes.\n\nIf anything else comes to mind, just reply here.\nMaison'
    );
  });
});

describe('quoteOf', () => {
  it('collapses runs of spaces and new lines to one space, and trims', () => {
    expect(quoteOf('  Can   it\n\nhold \t a watch?  ')).toBe('Can it hold a watch?');
  });

  it('quotes 80 characters as they are, and cuts 81 to 79 and an ellipsis', () => {
    expect(QUOTE_LENGTH).toBe(80);
    expect(quoteOf('a'.repeat(80))).toBe('a'.repeat(80));
    expect(quoteOf('a'.repeat(81))).toBe(`${'a'.repeat(79)}…`);
    expect(quoteOf('あ'.repeat(81))).toBe(`${'あ'.repeat(79)}…`);
  });

  it('counts characters, so an emoji is never split', () => {
    expect(quoteOf('😀'.repeat(80))).toBe('😀'.repeat(80));
    const cut = quoteOf('😀'.repeat(81));
    expect(Array.from(cut)).toHaveLength(80);
    expect(cut).toBe(`${'😀'.repeat(79)}…`);
  });
});

describe('knowledgeTitleOf', () => {
  it('keeps 200 characters as they are, and cuts 201 to 199 and an ellipsis', () => {
    expect(knowledgeTitleOf('a'.repeat(200))).toBe('a'.repeat(200));
    expect(knowledgeTitleOf('a'.repeat(201))).toBe(`${'a'.repeat(199)}…`);
  });

  it('collapses runs of spaces and new lines to one space, and trims', () => {
    expect(knowledgeTitleOf('  Can   it\nhold a watch?  ')).toBe('Can it hold a watch?');
  });

  it("fits the title's 200 UTF-16 units, which Strapi's maxLength counts, without splitting an emoji", () => {
    const title = knowledgeTitleOf('😀'.repeat(150));
    expect(title).toBe(`${'😀'.repeat(99)}…`);
    expect(title.length).toBeLessThanOrEqual(200);
  });
});
