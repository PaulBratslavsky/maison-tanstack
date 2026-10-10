import type { Locale } from '../constants';
import { fitUnits, teaser } from './text';

/** How much of the question a LINE message quotes, in characters. */
export const QUOTE_LENGTH = 80;
/** What a knowledge entry's title holds, in UTF-16 units: its `maxLength`. */
const TITLE_LENGTH = 200;

/** The question as a LINE message quotes it: on one line, cut to 80 characters with "…". An emoji counts as one, so it is never split. */
export const quoteOf = (question: string): string => teaser(question, QUOTE_LENGTH);

/**
 * A knowledge entry's title, from the question it answers or the title staff wrote for it, with its whitespace collapsed
 * and cut to the 200 UTF-16 units Strapi's `maxLength` counts: a question of emoji still fits.
 */
export const knowledgeTitleOf = (question: string): string => fitUnits(question, TITLE_LENGTH);

export interface QuestionMessageInput {
  /** The question's language: the message is written in it. */
  language: Locale;
  /** The staff member's first name, or null to speak for the team. */
  staffName: string | null;
  question: string;
  /** The piece's name in the question's language, or null when the question isn't about one. */
  productName: string | null;
}

/** Who is writing, the question quoted, and thanks: the first sentence of every staff message. */
const opening = ({ language, staffName, question, productName }: QuestionMessageInput): string => {
  const quote = quoteOf(question);
  if (language === 'ja') {
    const who = staffName ? `Maisonのクライアントアドバイザー、${staffName}でございます。` : 'Maisonのクライアントアドバイザーでございます。';
    return `${who}${productName ? `${productName}についての` : ''}ご質問「${quote}」をいただき、ありがとうございます。`;
  }
  const who = staffName ? `Hello, this is ${staffName}, a client advisor at Maison.` : "Hello, this is Maison's client advisor team.";
  // The customer's words stay as they wrote them: a full stop goes after the quote, only when it doesn't end a sentence.
  const end = /[.!?。！？]$/.test(quote) ? '' : '.';
  return `${who} Thank you for your question${productName ? ` about the ${productName}` : ''}: "${quote}"${end}`;
};

/** The sign-off. Japanese puts U+3000, the full-width space, between Maison and the name. */
const signature = ({ language, staffName }: QuestionMessageInput): string =>
  language === 'ja' ? (staffName ? `Maison　${staffName}` : 'Maison') : staffName ? `${staffName}, Maison` : 'Maison';

/** Let them know: a person has the question and is looking into it. */
export const acknowledgementText = (input: QuestionMessageInput): string =>
  input.language === 'ja'
    ? `${opening(input)}ただいま確認しておりますので、分かり次第こちらのトークでご連絡いたします。\n${signature(input)}`
    : `${opening(input)} I'm looking into it and will reply here in this chat as soon as I can.\n${signature(input)}`;

/** Answer: the answer, between the opening and an invitation to reply. */
export const answerText = (input: QuestionMessageInput & { answer: string }): string =>
  input.language === 'ja'
    ? `${opening(input)}\n\n${input.answer.trim()}\n\nほかにもご不明な点がございましたら、こちらのトークにお気軽にご返信ください。\n${signature(input)}`
    : `${opening(input)}\n\n${input.answer.trim()}\n\nIf anything else comes to mind, just reply here.\n${signature(input)}`;
