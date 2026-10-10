/**
 * What the Customer questions section of the Maison page shows and sends, apart from React: the rows of
 * GET /maison/questions, the answer POST /maison/questions/:reference/answer takes, and the notice a 200 from either
 * POST shows.
 */

export type QuestionStatus = 'open' | 'taken' | 'answered';
export type QuestionReason = 'no_answer' | 'asked_for_person';

/** One row of GET /maison/questions (StaffQuestionView on the server). */
export interface StaffQuestion {
  reference: string;
  /** The customer, masked like "line:U4af…88". Staff never see the full LINE user ID. */
  customer: string;
  /** The customer's LINE display name, when LINE gave one. */
  customerName: string | null;
  question: string;
  reason: QuestionReason;
  language: 'ja' | 'en';
  product: { slug: string; name: string } | null;
  status: QuestionStatus;
  /** Who took the question, then who answered it. */
  staffName: string | null;
  takenAt: string | null;
  answeredAt: string | null;
  answer: string | null;
  /** Whether the answer became a product knowledge entry. */
  addedToKnowledge: boolean;
  /** How the last LINE message to the customer went, or null before there was one. `demo`: a made-up demo customer, who gets none. */
  line: { outcome: 'sent' | 'failed' | 'demo'; detail: string } | null;
  /** The presenter's own LINE account (the plugin's demoLineUserId): shown with a "Your LINE" label. */
  yourLine: boolean;
  /** When the concierge handed the question over, as an ISO string in UTC. */
  createdAt: string;
}

/** Why the concierge handed a question to staff, in the words of the Why column. */
export const REASON_LABELS: Record<QuestionReason, string> = {
  no_answer: 'No answer in product knowledge',
  asked_for_person: 'Asked for a person',
};

/** "Open", "Taken by Jane" or "Answered by Jane". "staff" stands in for a name the question doesn't have. */
export const statusLabel = ({ status, staffName }: Pick<StaffQuestion, 'status' | 'staffName'>): string => {
  if (status === 'open') return 'Open';
  return `${status === 'taken' ? 'Taken' : 'Answered'} by ${staffName || 'staff'}`;
};

/** Let them know: only a question nobody has taken, since sending the message is what takes it. */
export const canLetThemKnow = ({ status }: Pick<StaffQuestion, 'status'>): boolean => status === 'open';

/** Answer: a question that is open, or taken by someone who let the customer know. */
export const canAnswer = ({ status }: Pick<StaffQuestion, 'status'>): boolean => status === 'open' || status === 'taken';

/** The categories of the Answer dialog's select: the server's KNOWLEDGE_CATEGORIES, in its order (test/unit/questions-admin.test.ts). */
export const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
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
];

/** Tokyo's calendar and clock, written "2026-10-03 10:12", the way Swedish writes them. h23 writes midnight as 00:00, not 24:00. */
const TOKYO_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * "2026-10-03T01:12:00.000Z" → "2026-10-03 10:12": when the question came in, on the boutique's clock whatever the time
 * zone of the browser. A value that isn't a date is shown as it came, so one bad row can't fail the table.
 */
export const askedAt = (iso: string): string => (Number.isNaN(Date.parse(iso)) ? iso : TOKYO_TIME.format(new Date(iso)));

/** The most an answer can have, in characters (UTF-16 units, as the server counts them) after trimming. The server's `answerInput` allows the same. */
export const ANSWER_LIMIT = 2000;
/** The most a title in product knowledge can have, counted the same way: what the knowledge content type's `title` holds. */
export const TITLE_LIMIT = 200;

/**
 * The title Add to product knowledge starts with: the customer's question, with its whitespace collapsed, cut to the
 * title's 200 UTF-16 units with "…" when it was longer. It never splits an emoji, which is two units. It's what the server
 * makes the title of an answer sent without one (`knowledgeTitleOf`, which test/unit/questions-admin.test.ts holds this to).
 */
export const defaultTitle = (question: string): string => {
  const collapsed = question.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= TITLE_LIMIT) return collapsed;
  let kept = '';
  for (const char of collapsed) {
    if (kept.length + char.length > TITLE_LIMIT - 1) break;
    kept += char;
  }
  return `${kept}…`;
};

/** What the Answer dialog holds. `category` is '' until staff pick one, and `title` starts as the question. */
export interface AnswerForm {
  text: string;
  addToKnowledge: boolean;
  category: string;
  /** The title of the product knowledge entry. Only used while `addToKnowledge` is ticked. */
  title: string;
}

/** The answer has more characters than the server takes. It counts them after trimming, as the dialog does. */
export const answerTooLong = (text: string): boolean => text.trim().length > ANSWER_LIMIT;

/** The title has more characters than the server takes, counted after trimming. */
export const titleTooLong = (title: string): boolean => title.trim().length > TITLE_LIMIT;

/**
 * Send on LINE: there's an answer of up to 2,000 characters, and with Add to product knowledge ticked, a category to
 * file it under and a title of 1 to 200 characters. That is what the server takes, and nothing it refuses: the
 * dialog never sends a body that fails (test/unit/questions-admin.test.ts tries every mix against `answerInput`).
 */
export const canSendAnswer = ({ text, addToKnowledge, category, title }: AnswerForm): boolean => {
  if (text.trim() === '' || answerTooLong(text)) return false;
  if (!addToKnowledge) return true;
  return CATEGORY_OPTIONS.some(({ value }) => value === category) && title.trim() !== '' && !titleTooLong(title);
};

/** What POST /maison/questions/:reference/answer takes. */
export interface AnswerBody {
  text: string;
  addToKnowledge: boolean;
  /** Only with `addToKnowledge`. */
  category?: string;
  /** Only with `addToKnowledge`: the title of the product knowledge entry. */
  title?: string;
}

/**
 * The body Send on LINE posts. With Add to product knowledge unticked there is no `category` or `title` key at all: the
 * server's schema refuses null and '' for either, and what was picked or typed before the box was unticked mustn't go with it.
 */
export const answerBody = ({ text, addToKnowledge, category, title }: AnswerForm): AnswerBody =>
  addToKnowledge ? { text, addToKnowledge, category, title } : { text, addToKnowledge };

/**
 * What the Questions tab's number counts, and the query that asks for it: the Open filter, which lists the questions
 * staff can still answer, open or taken.
 */
export const OPEN_QUESTIONS = { status: 'open' } as const;

/** How many questions a GET /maison/questions answer holds, or null when it isn't a list of questions: the tab shows no number then. */
export const countOfQuestions = (answer: unknown): number | null => {
  const questions = (answer as { questions?: unknown } | null | undefined)?.questions;
  return Array.isArray(questions) ? questions.length : null;
};

/**
 * What POST …/notify and POST …/answer answer with a 200: a `sent` ReplyOutcome on the server, or a `demo` one for a
 * made-up demo customer, who gets no LINE message while the action still happens.
 */
export interface SentReply {
  reference: string;
  status: 'sent' | 'demo';
  /** What happened, in the server's words. */
  message: string;
  /** True when the customer has the message but something after it went wrong, which `message` says. */
  warning?: boolean;
  /** The knowledge entry the answer became. */
  knowledgeDocumentId?: string;
}

/**
 * The notice a 200 shows: the server's own message, as a warning when it says the message went out but something after
 * it went wrong. A warning stays until it is dismissed (`blockTransition`): it says "Don't send it again", which has to
 * be read, and a notice that fades after a few seconds can be missed. A success fades as any notice does. For a made-up
 * demo customer (`status: 'demo'`) it is an info notice: the action happened, and no LINE message went.
 */
export const replyNotice = ({
  message,
  warning,
  status,
}: {
  message: string;
  warning?: boolean;
  status?: string;
}): { type: 'success' | 'warning' | 'info'; message: string; blockTransition?: true } => {
  if (warning === true) return { type: 'warning', message, blockTransition: true };
  return { type: status === 'demo' ? 'info' : 'success', message };
};
