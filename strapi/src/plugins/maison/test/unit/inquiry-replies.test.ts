import { describe, expect, it } from 'vitest';
import { INQUIRY_QUEUES } from '../../server/src/constants';
import { inquiryReplyText, suggestedReply } from '../../server/src/domain/inquiry-replies';
import { quoteOf } from '../../server/src/domain/question-messages';
import { replyInquiryInput } from '../../server/src/mcp/schemas';

const COMPLAINT_EN = "We're sorry about this, and thank you for telling us. A member of our team will look into it and reply in this chat with the next step.";
const COMPLAINT_JA = 'ご不便をおかけし、申し訳ございません。お知らせいただき、ありがとうございます。担当者が確認し、こちらのトークで今後のご案内をいたします。';
const PRAISE_EN = 'Thank you so much for your kind words. If you have a moment, a review or a word to a friend would mean a great deal to us.';
const PRAISE_JA = '温かいお言葉をありがとうございます。よろしければ、レビューやご友人へのご紹介をいただけますと大変励みになります。';

describe('suggestedReply', () => {
  it.each([
    ['complaint', 'en', COMPLAINT_EN],
    ['complaint', 'ja', COMPLAINT_JA],
    ['praise', 'en', PRAISE_EN],
    ['praise', 'ja', PRAISE_JA],
  ] as const)('gives the %s queue its text in %s, word for word', (queue, language, text) => {
    expect(suggestedReply(queue, language)).toBe(text);
  });

  // A question needs an answer written for it, and a row in no queue has nothing to suggest.
  it.each(['needs-answer', 'none'] as const)('gives nothing for the %s queue, in either language', (queue) => {
    expect(suggestedReply(queue, 'en')).toBeNull();
    expect(suggestedReply(queue, 'ja')).toBeNull();
  });

  it('suggests a text for the complaint and praise queues, and for no other', () => {
    expect(INQUIRY_QUEUES.filter((queue) => suggestedReply(queue, 'en') !== null)).toEqual(['complaint', 'praise']);
    expect(INQUIRY_QUEUES.filter((queue) => suggestedReply(queue, 'ja') !== null)).toEqual(['complaint', 'praise']);
  });

  it('gives a text staff can send as it is: the reply form takes it, as it takes any reply', () => {
    for (const queue of ['complaint', 'praise'] as const) {
      for (const language of ['en', 'ja'] as const) {
        const text = suggestedReply(queue, language) as string;
        expect(replyInquiryInput.safeParse({ text }).data).toEqual({ text });
      }
    }
  });
});

describe('inquiryReplyText', () => {
  const MESSAGE = 'The clasp of my coffret broke after a week.';
  const TEXT = 'We are sorry about the clasp. A member of our team will call you tomorrow.';

  it('quotes the customer in English, then the staff text, then signs as Maison', () => {
    expect(inquiryReplyText({ language: 'en', message: MESSAGE, text: TEXT })).toBe(
      `About your message: "${MESSAGE}"\n\n${TEXT}\n\nMaison`
    );
  });

  // A reply goes to any inquiry, and a praise or a complaint is no question: the opening line says only what it is about.
  it('opens an English reply with "About your message", for praise and for a complaint as for a question', () => {
    const praise = inquiryReplyText({ language: 'en', message: 'Thank you, the weekender is beautiful.', text: PRAISE_EN });
    const complaint = inquiryReplyText({ language: 'en', message: MESSAGE, text: COMPLAINT_EN });

    expect(praise.split('\n')[0]).toBe('About your message: "Thank you, the weekender is beautiful."');
    expect(complaint.split('\n')[0]).toBe(`About your message: "${MESSAGE}"`);
    expect(praise).not.toContain('question');
    expect(complaint).not.toContain('question');
  });

  it('quotes the customer in Japanese, then the staff text, then signs as Maison', () => {
    expect(inquiryReplyText({ language: 'ja', message: '腕時計は入りますか？', text: 'はい、42mmまでお入れいただけます。' })).toBe(
      '「腕時計は入りますか？」についてのお問い合わせへのご返信です。\n\nはい、42mmまでお入れいただけます。\n\nMaison'
    );
  });

  it('quotes the customer as the questions do: with quoteOf', () => {
    const message = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`;
    expect(inquiryReplyText({ language: 'en', message, text: TEXT })).toBe(`About your message: "${quoteOf(message)}"\n\n${TEXT}\n\nMaison`);
    expect(inquiryReplyText({ language: 'ja', message, text: TEXT })).toBe(
      `「${quoteOf(message)}」についてのお問い合わせへのご返信です。\n\n${TEXT}\n\nMaison`
    );
  });

  it('quotes the first 80 characters of the message on one line, ending with an ellipsis when it cut', () => {
    const message = `${'a'.repeat(50)}\n  ${'b'.repeat(50)}`;
    const quote = `${'a'.repeat(50)} ${'b'.repeat(28)}…`;
    expect(Array.from(quote)).toHaveLength(80);

    expect(inquiryReplyText({ language: 'en', message, text: TEXT })).toBe(`About your message: "${quote}"\n\n${TEXT}\n\nMaison`);
  });

  it('trims the staff text, and keeps the line breaks and the spaces inside it', () => {
    expect(inquiryReplyText({ language: 'en', message: MESSAGE, text: '  Thank you.\n\nWe will call you.  \n' })).toBe(
      `About your message: "${MESSAGE}"\n\nThank you.\n\nWe will call you.\n\nMaison`
    );
    expect(inquiryReplyText({ language: 'ja', message: '腕時計は入りますか？', text: '  ありがとうございます。\n\nお電話します。  \n' })).toBe(
      '「腕時計は入りますか？」についてのお問い合わせへのご返信です。\n\nありがとうございます。\n\nお電話します。\n\nMaison'
    );
  });

  it('sends the staff text whole, however long: a reply holds up to 2,000 characters', () => {
    const long = 'x'.repeat(2000);
    expect(inquiryReplyText({ language: 'en', message: MESSAGE, text: long })).toContain(`\n\n${long}\n\nMaison`);
  });

  it('sends a suggested text as it is, between the quote and the signature', () => {
    expect(inquiryReplyText({ language: 'en', message: MESSAGE, text: COMPLAINT_EN })).toBe(
      `About your message: "The clasp of my coffret broke after a week."\n\n${COMPLAINT_EN}\n\nMaison`
    );
    expect(inquiryReplyText({ language: 'ja', message: 'ストラップが切れました。', text: COMPLAINT_JA })).toBe(
      `「ストラップが切れました。」についてのお問い合わせへのご返信です。\n\n${COMPLAINT_JA}\n\nMaison`
    );
  });
});
