/**
 * What the Inquiries tab and its Homepage widget show and send, apart from React: the rows of GET /maison/inquiries, the
 * bodies the POSTs take, which button a row gets, and the words the page uses. The page is thin over these, and
 * test/unit/inquiries-admin.test.ts holds them to what the server's own service and schemas accept.
 */
import type { QuestionStatus } from './questions';

export type InquiryFilter = 'needs-answer' | 'complaint' | 'praise' | 'not-labelled' | 'all';
export type InquiryKind = 'question' | 'complaint' | 'praise' | 'other';
export type SentimentLabel = 'positive' | 'neutral' | 'negative';
export type InquiryQueue = 'needs-answer' | 'complaint' | 'praise' | 'none';
export type InquiryStatus = 'open' | 'replied' | 'closed';
export type CloseReason = 'answered-elsewhere' | 'not-needed' | 'spam';
export type AnalysisStatus = 'pending' | 'analyzed' | 'failed' | 'skipped';
export type Language = 'ja' | 'en';

/** One row of GET /maison/inquiries (StaffInquiryView on the server). */
export interface StaffInquiry {
  documentId: string;
  /** When the customer wrote, as an ISO string in UTC. */
  createdAt: string;
  /** The customer, masked like "line:U4af…88". Staff never see the full LINE user ID. */
  customer: string;
  /** What the customer wrote, with its line breaks. */
  message: string;
  /** What the concierge answered, with its line breaks, or null when it said nothing. */
  reply: string | null;
  /** The chat's language: a reply to the customer is written in it. */
  language: Language;
  product: { slug: string; name: string } | null;
  knowledgeFound: boolean;
  handedOff: boolean;
  /** The question a hand-off recorded. Its status is null when that question no longer exists. */
  question: { reference: string; status: QuestionStatus | null } | null;
  /** The labels are the model's, until a person changes them (`humanCorrected`). */
  kind: InquiryKind | null;
  /** Null for a label a person gave, which has no score. */
  sentimentScore: number | null;
  sentimentLabel: SentimentLabel | null;
  answered: boolean | null;
  /** The model's reason for its labels, in its own words. */
  reason: string | null;
  /** The model's name for what the inquiry is about, in its own words. */
  topic: string | null;
  analysisStatus: AnalysisStatus;
  analysisAttempts: number;
  humanCorrected: boolean;
  queue: InquiryQueue;
  status: InquiryStatus;
  closeReason: CloseReason | null;
  replyText: string | null;
  repliedAt: string | null;
  repliedBy: string | null;
  /** How the last LINE message to the customer went, or null before there was one. `demo`: a made-up demo customer, who gets none. */
  line: { outcome: 'sent' | 'failed' | 'demo'; detail: string | null } | null;
  /** The presenter's own LINE account (the plugin's demoLineUserId): shown with a "Your LINE" label. */
  yourLine: boolean;
}

/** What GET /maison/inquiries/summary answers: the open inquiries each filter shows. */
export interface InquiriesSummary {
  needsAnswer: number;
  complaint: number;
  praise: number;
  notLabelled: number;
}

/**
 * What GET /maison/inquiries/quota answers. `configured` is false without a channel access token: replies can't be sent
 * then, and `used` and `limit` are null, as they are when LINE gave no answer.
 */
export interface Quota {
  configured: boolean;
  used: number | null;
  /** Null when the channel has no limit. */
  limit: number | null;
}

/**
 * What the four POSTs answer with a 200: the server's own message, and `warning` when something after the action went
 * wrong. Reply on LINE also says `status`: `demo` for a made-up demo customer, who gets no LINE message.
 */
export interface ActionAnswer {
  message: string;
  warning?: boolean;
  status?: string;
}

/**
 * The intro under the tab's title: what the queues are, that a model labels each inquiry, and, only for an admin who can
 * change labels, that they can. Change label is behind the same permission as Reply on LINE (`canReply` on the page), so
 * an admin with the view permission alone has no button for it and isn't told they can.
 */
export const introText = (canChangeLabels: boolean): string =>
  `What customers ask the concierge, in queues. A model labels each inquiry${canChangeLabels ? ', and you can change its label' : ''}.`;

/** The filters, in the order of the pills. They are the values GET /maison/inquiries takes as `filter`. */
export const FILTERS: readonly InquiryFilter[] = ['needs-answer', 'complaint', 'praise', 'not-labelled', 'all'];

export const FILTER_LABELS: Record<InquiryFilter, string> = {
  'needs-answer': 'Needs an answer',
  complaint: 'Complaints',
  praise: 'Praise',
  'not-labelled': 'Not labelled',
  all: 'All',
};

/** The tab opens on the queue that needs a person, as the server does without a filter. */
export const DEFAULT_FILTER: InquiryFilter = 'needs-answer';

/** How many rows the tab asks for. The route takes up to 100. */
export const LIST_LIMIT = 50;

/** The four cards, in the order of the first four pills: each counts the open inquiries its filter shows. */
export const COUNTS: ReadonlyArray<{ key: keyof InquiriesSummary; label: string }> = [
  { key: 'needsAnswer', label: FILTER_LABELS['needs-answer'] },
  { key: 'complaint', label: FILTER_LABELS.complaint },
  { key: 'praise', label: FILTER_LABELS.praise },
  { key: 'notLabelled', label: FILTER_LABELS['not-labelled'] },
];

const SUMMARY_KEYS = ['needsAnswer', 'complaint', 'praise', 'notLabelled'] as const;

/** Whether an answer is a summary: the four counts. Anything else would show as empty cards. */
export const isSummary = (value: unknown): value is InquiriesSummary =>
  typeof value === 'object' && value !== null && SUMMARY_KEYS.every((key) => Number.isInteger((value as Record<string, unknown>)[key]));

const KIND_LABELS: Record<InquiryKind, string> = { question: 'Question', complaint: 'Complaint', praise: 'Praise', other: 'Other' };
const SENTIMENT_NAMES: Record<SentimentLabel, string> = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' };
const CLOSE_REASON_LABELS: Record<CloseReason, string> = { 'answered-elsewhere': 'Answered elsewhere', 'not-needed': 'Not needed', spam: 'Spam' };

const optionsOf = <T extends string>(labels: Record<T, string>): Array<{ value: T; label: string }> =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

/** The selects of Change label and Close, in the server's order (test/unit/inquiries-admin.test.ts). */
export const KIND_OPTIONS = optionsOf(KIND_LABELS);
export const SENTIMENT_OPTIONS = optionsOf(SENTIMENT_NAMES);
export const CLOSE_REASON_OPTIONS = optionsOf(CLOSE_REASON_LABELS);

/** The kind badge: Question, Complaint, Praise or Other, and Not labelled for an inquiry nobody has labelled. */
export const kindLabel = (kind: InquiryKind | null): string => (kind ? (KIND_LABELS[kind] ?? kind) : 'Not labelled');

/**
 * The sentiment column: "negative (-0.6)", the label with its score. A label a person gave has no score, so it shows
 * alone, like "negative". With no label there is a dash. The score has two decimals at most and no trailing zero, and
 * never shows as "-0".
 */
export const sentimentText = (score: number | null, label: SentimentLabel | null): string => {
  if (!label) return '-';
  if (typeof score !== 'number' || !Number.isFinite(score)) return label;
  return `${label} (${Number(score.toFixed(2))})`;
};

/**
 * The status badge: "Open", "Replied by Jane" ("staff" stands in for a name the reply doesn't have), or "Closed" with
 * the reason written out, like "Closed: answered elsewhere". A reason it has no words for is left out, so one odd row
 * can't fail the table.
 */
export const statusLabel = ({ status, repliedBy, closeReason }: Pick<StaffInquiry, 'status' | 'repliedBy' | 'closeReason'>): string => {
  if (status === 'open') return 'Open';
  if (status === 'replied') return `Replied by ${repliedBy || 'staff'}`;
  const reason = closeReason ? CLOSE_REASON_LABELS[closeReason] : undefined;
  return reason ? `Closed: ${reason.toLowerCase()}` : 'Closed';
};

/**
 * The note under the kind badge: why an inquiry has no labels yet (waiting for the next sweep, skipped because AI was
 * off, or failed, which is when Label again is offered), or that a person changed its labels, which makes the model's
 * reason and topic the model's alone. Nothing for an inquiry the model labelled.
 */
export const labelNote = ({ analysisStatus, humanCorrected }: Pick<StaffInquiry, 'analysisStatus' | 'humanCorrected'>): string | null => {
  if (humanCorrected) return 'Label changed by staff';
  if (analysisStatus === 'pending') return 'Waiting to be labelled';
  if (analysisStatus === 'skipped') return 'Labelling was off';
  if (analysisStatus === 'failed') return 'Labelling failed';
  return null;
};

/**
 * What a hand-off's row says about its question: "Q-4821 · answer it under Questions", because that is where it is
 * answered, and "Q-4821 · answered under Questions" once it has been. A question that no longer exists can't be
 * answered, so the row says that and sends staff nowhere.
 */
export const handOffText = ({ reference, status }: NonNullable<StaffInquiry['question']>): string => {
  if (status === 'answered') return `${reference} · answered under Questions`;
  if (status === null) return `${reference} · no longer under Questions`;
  return `${reference} · answer it under Questions`;
};

/**
 * Reply on LINE: an open inquiry that is no hand-off. A hand-off is answered under Questions, where the question's own
 * flow and the product knowledge loop stay the one way to answer it, and the server refuses a reply to it
 * (`use_question`). Neither does it take a reply to a closed or a replied inquiry.
 */
export const canReplyTo = ({ status, question }: Pick<StaffInquiry, 'status' | 'question'>): boolean => status === 'open' && question === null;

/** Close: an open inquiry. A replied one keeps its reply, and a closed one is closed. */
export const canClose = ({ status }: Pick<StaffInquiry, 'status'>): boolean => status === 'open';

/** Label again: an inquiry the model failed on, unless a person has labelled it since: the server refuses that one (`not_failed`). */
export const canLabelAgain = ({ analysisStatus, humanCorrected }: Pick<StaffInquiry, 'analysisStatus' | 'humanCorrected'>): boolean =>
  analysisStatus === 'failed' && !humanCorrected;

/** The most a reply can have, in characters (UTF-16 units, as the server counts them) after trimming. The server's `replyInquiryInput` allows the same. */
export const REPLY_LIMIT = 2000;

/** The reply has more characters than the server takes. It counts them after trimming, as the dialog does. */
export const replyTooLong = (text: string): boolean => text.trim().length > REPLY_LIMIT;

/** Send on LINE: 1 to 2,000 characters after trimming. That is what the server takes, and nothing it refuses. */
export const canSendReply = (text: string): boolean => text.trim() !== '' && !replyTooLong(text);

/** What POST /maison/inquiries/:documentId/reply takes. */
export interface ReplyBody {
  text: string;
}

/** The body Send on LINE posts: the text, trimmed, with the line breaks inside it left alone. */
export const replyBody = (text: string): ReplyBody => ({ text: text.trim() });

/**
 * The texts the dialog offers, the same words as the server's `suggestedReply` (test/unit/inquiries-admin.test.ts holds
 * them equal): an apology and the next step for a complaint, thanks and a request for a review or a word to a friend for praise.
 */
const SUGGESTED: Record<'complaint' | 'praise', Record<Language, string>> = {
  complaint: {
    en: "We're sorry about this, and thank you for telling us. A member of our team will look into it and reply in this chat with the next step.",
    ja: 'ご不便をおかけし、申し訳ございません。お知らせいただき、ありがとうございます。担当者が確認し、こちらのトークで今後のご案内をいたします。',
  },
  praise: {
    en: 'Thank you so much for your kind words. If you have a moment, a review or a word to a friend would mean a great deal to us.',
    ja: '温かいお言葉をありがとうございます。よろしければ、レビューやご友人へのご紹介をいただけますと大変励みになります。',
  },
};

/**
 * The text "Use the suggested text" puts in the box for an inquiry in this queue and in the chat's language, or null
 * when the queue has none: a question needs an answer written for it. Anything but Japanese gets English, as the server does.
 */
export const suggestedReply = (queue: InquiryQueue, language: Language): string | null =>
  queue === 'complaint' || queue === 'praise' ? SUGGESTED[queue][language === 'ja' ? 'ja' : 'en'] : null;

/** The box after "Use the suggested text": the text in an empty box, or after what staff have written, as a new paragraph, so nothing they typed is lost. */
export const insertSuggested = (text: string, suggested: string): string => (text.trim() === '' ? suggested : `${text.trimEnd()}\n\n${suggested}`);

/** What the dialog of Change label holds: the two selects, each '' until a label is picked. */
export interface LabelForm {
  kind: string;
  sentimentLabel: string;
}

/** What POST /maison/inquiries/:documentId/label takes: a kind, a sentiment, or both. */
export interface LabelBody {
  kind?: InquiryKind;
  sentimentLabel?: SentimentLabel;
}

type Labels = Pick<StaffInquiry, 'kind' | 'sentimentLabel'>;

/** The dialog opens on the inquiry's labels, whoever gave them, with nothing chosen for a label it hasn't got. */
export const labelForm = ({ kind, sentimentLabel }: Labels): LabelForm => ({ kind: kind ?? '', sentimentLabel: sentimentLabel ?? '' });

/**
 * The body Save label posts: only what staff changed. The server clears the model's score when it is given a sentiment,
 * so a person who only changes the kind mustn't send one. A select left empty, or holding anything but a label, sends nothing.
 */
export const labelBody = (form: LabelForm, current: Labels): LabelBody => {
  const kind = KIND_OPTIONS.find(({ value }) => value === form.kind)?.value;
  const sentimentLabel = SENTIMENT_OPTIONS.find(({ value }) => value === form.sentimentLabel)?.value;
  return {
    ...(kind !== undefined && kind !== current.kind ? { kind } : {}),
    ...(sentimentLabel !== undefined && sentimentLabel !== current.sentimentLabel ? { sentimentLabel } : {}),
  };
};

/**
 * Save label: it changes something, which is what the server takes (a kind, a sentiment, or both), and an inquiry with no
 * kind gets one. The server refuses a sentiment alone for such an inquiry ("Pick a kind too."): with no kind it is in no
 * queue, and a person's label takes it out of Not labelled.
 */
export const canSaveLabels = (form: LabelForm, current: Labels): boolean => {
  const body = labelBody(form, current);
  return Object.keys(body).length > 0 && (body.kind !== undefined || current.kind !== null);
};

/** What the server answers, with `invalid_input`, when Change label gets a sentiment alone for an inquiry with no kind. A test holds this equal to it. */
const PICK_A_KIND = 'Pick a kind too.';

/**
 * What the dialog of Change label says under Kind while Save label is disabled for want of a kind: staff changed the
 * sentiment of an inquiry that has no kind, and picked none. The server's own words for that body, so the page explains the
 * disabled button in the words the server would refuse it with. Nothing otherwise.
 */
export const kindNeededNotice = (form: LabelForm, current: Labels): string | null => {
  const { kind, sentimentLabel } = labelBody(form, current);
  return sentimentLabel !== undefined && kind === undefined && current.kind === null ? PICK_A_KIND : null;
};

/** A count LINE reports. */
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The line above the table: "LINE messages this month: 12 of 200", or "LINE messages this month: 12" for a channel with
 * no limit. Nothing when LINE gave no count: no token, or no answer, which the server answers as null.
 */
export const quotaText = (quota: Quota): string => {
  if (!isCount(quota?.used)) return '';
  const count = (value: number) => value.toLocaleString('en-US');
  return `LINE messages this month: ${count(quota.used)}${isCount(quota.limit) ? ` of ${count(quota.limit)}` : ''}`;
};

/** What the server refuses a reply with, and says in the log, when it has no channel access token. A test holds this equal to `NO_TOKEN` in the server's line-outcome.ts. */
const NO_TOKEN_TEXT = "LINE_CHANNEL_ACCESS_TOKEN isn't set: Strapi can't message customers on LINE.";

/**
 * Why Send on LINE can't send, when the quota says Strapi has no channel access token: the server's own message, which the
 * reply form shows up front instead of after Send. Nothing before the quota has loaded, and when it failed to: the form stays
 * usable then, and the server refuses a reply it can't send.
 */
export const noTokenNotice = (quota: Quota | null | undefined): string | null => (quota?.configured === false ? NO_TOKEN_TEXT : null);
