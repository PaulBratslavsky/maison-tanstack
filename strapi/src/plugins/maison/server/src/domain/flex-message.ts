import type { Locale } from '../constants';

export interface ConfirmationMessageInput {
  /** The visit's language, which every word of the bubble is in. Japanese when it's left out. */
  language?: Locale;
  /** The house name, and the details below, come already in the visit's language. */
  houseName: string;
  reference: string;
  boutiqueName: string;
  boutiqueAddress: string;
  requestedForText: string;
  productNames: string[];
  appLink: string;
}

export interface FlexMessage {
  altText: string;
  contents: Record<string, unknown>;
}

// The app's black-and-white palette: ink on white, white on ink, and a grey that keeps 4.6:1 on white.
const INK = '#0a0a0a';
const WHITE = '#ffffff';
const MUTED = '#737373';

/** The bubble's own words in each language. */
const WORDS: Record<
  Locale,
  {
    altText: (reference: string) => string;
    title: string;
    reference: string;
    boutique: string;
    address: string;
    date: string;
    pieces: string;
    /** What goes between two pieces' names. */
    joiner: string;
    button: string;
  }
> = {
  ja: {
    altText: (reference) => `ご来店予約が確定しました（${reference}）`,
    title: 'ご来店予約が確定しました',
    reference: '予約番号',
    boutique: 'ブティック',
    address: '住所',
    date: '日時',
    pieces: 'お品物',
    joiner: '、',
    button: '予約を確認する',
  },
  en: {
    altText: (reference) => `Your visit is confirmed (${reference})`,
    title: 'Your visit is confirmed',
    reference: 'Reference',
    boutique: 'Boutique',
    address: 'Address',
    date: 'Date',
    pieces: 'Pieces',
    joiner: ', ',
    button: 'View your visit',
  },
};

/** LINE rejects empty text nodes, so empty values become a dash. */
const nonEmpty = (value: string) => (value.trim().length > 0 ? value : '-');

const row = (label: string, value: string) => ({
  type: 'box',
  layout: 'baseline',
  spacing: 'sm',
  contents: [
    { type: 'text', text: label, size: 'sm', color: MUTED, flex: 2 },
    { type: 'text', text: nonEmpty(value), size: 'sm', color: INK, flex: 5, wrap: true },
  ],
});

/**
 * The confirmation bubble, in the visit's language, ready for LINE's push API and LINE Bot MCP's push_flex_message.
 * Both languages share one layout.
 */
export function buildConfirmationMessage(input: ConfirmationMessageInput): FlexMessage {
  // A language a caller without types made up is Japanese too, even one that names an inherited key like constructor.
  const language = input.language ?? 'ja';
  const words = Object.prototype.hasOwnProperty.call(WORDS, language) ? WORDS[language] : WORDS.ja;
  return {
    altText: words.altText(input.reference),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: INK,
        paddingAll: '16px',
        contents: [{ type: 'text', text: nonEmpty(input.houseName), color: WHITE, align: 'center', weight: 'bold' }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: words.title, weight: 'bold', size: 'lg', wrap: true },
          row(words.reference, input.reference),
          row(words.boutique, input.boutiqueName),
          row(words.address, input.boutiqueAddress),
          row(words.date, input.requestedForText),
          row(words.pieces, input.productNames.join(words.joiner)),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', color: INK, action: { type: 'uri', label: words.button, uri: input.appLink } },
        ],
      },
    },
  };
}
