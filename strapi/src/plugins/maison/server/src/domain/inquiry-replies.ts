import type { InquiryQueue, Locale } from '../constants';
import { quoteOf } from './question-messages';

/** What the reply form offers for a complaint: an apology, and what happens next. */
const COMPLAINT: Record<Locale, string> = {
  en: "We're sorry about this, and thank you for telling us. A member of our team will look into it and reply in this chat with the next step.",
  ja: 'ご不便をおかけし、申し訳ございません。お知らせいただき、ありがとうございます。担当者が確認し、こちらのトークで今後のご案内をいたします。',
};

/** What the reply form offers for praise: thanks, and a request for a review or a word to a friend. */
const PRAISE: Record<Locale, string> = {
  en: 'Thank you so much for your kind words. If you have a moment, a review or a word to a friend would mean a great deal to us.',
  ja: '温かいお言葉をありがとうございます。よろしければ、レビューやご友人へのご紹介をいただけますと大変励みになります。',
};

/** The text in the customer's language: English for anything that isn't Japanese, as the staff messages do. */
const inLanguage = (texts: Record<Locale, string>, language: Locale): string => (language === 'ja' ? texts.ja : texts.en);

/**
 * The text the reply form's "Use the suggested text" button puts in the box, for an inquiry in this queue and in the
 * customer's language, or null when the queue has none: a question needs an answer written for it, and a row in no queue
 * has nothing to suggest. Staff edit it before they send it.
 */
export const suggestedReply = (queue: InquiryQueue, language: Locale): string | null => {
  if (queue === 'complaint') return inLanguage(COMPLAINT, language);
  if (queue === 'praise') return inLanguage(PRAISE, language);
  return null;
};

export interface InquiryReplyInput {
  /** The inquiry's language: the message is written in it. */
  language: Locale;
  /** What the customer wrote, quoted at the top of the reply. */
  message: string;
  /** The staff member's own words. */
  text: string;
}

/**
 * The LINE message for a reply: the customer's words quoted (the first 80 characters, on one line), then the staff text,
 * then Maison's name. It is not signed with the staff member's name: the reply comes from Maison, and the name is only
 * recorded on the inquiry.
 *
 * The English line says "About your message", not "your question": a reply goes to any inquiry, and a praise or a
 * complaint is no question. The Japanese line says お問い合わせ, an inquiry, and is as it was.
 */
export const inquiryReplyText = ({ language, message, text }: InquiryReplyInput): string =>
  language === 'ja'
    ? `「${quoteOf(message)}」についてのお問い合わせへのご返信です。\n\n${text.trim()}\n\nMaison`
    : `About your message: "${quoteOf(message)}"\n\n${text.trim()}\n\nMaison`;
