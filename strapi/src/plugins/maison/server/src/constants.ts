export const PLUGIN_ID = 'maison';

export const UID = {
  collection: 'plugin::maison.collection',
  product: 'plugin::maison.product',
  boutique: 'plugin::maison.boutique',
  stockLevel: 'plugin::maison.stock-level',
  appointment: 'plugin::maison.appointment',
  notification: 'plugin::maison.notification',
  knowledge: 'plugin::maison.knowledge',
  question: 'plugin::maison.question',
  inquiry: 'plugin::maison.inquiry',
  conversation: 'plugin::maison.conversation',
} as const;

/** Full action UIDs, as stored on admin tokens and checked by tool auth policies. */
export const ACTION = {
  catalogRead: 'plugin::maison.catalog.read',
  appointmentsRequest: 'plugin::maison.appointments.request',
  appointmentsReview: 'plugin::maison.appointments.review',
  appointmentsConfirm: 'plugin::maison.appointments.confirm',
  confirmationsSend: 'plugin::maison.confirmations.send',
  questionsAsk: 'plugin::maison.questions.ask',
  questionsRead: 'plugin::maison.questions.read',
  questionsAnswer: 'plugin::maison.questions.answer',
  inquiriesLog: 'plugin::maison.inquiries.log',
  inquiriesView: 'plugin::maison.inquiries.view',
  inquiriesReply: 'plugin::maison.inquiries.reply',
  demoManage: 'plugin::maison.demo.manage',
  assistantUse: 'plugin::maison.assistant.use',
} as const;

/** The Ask tab's limits, in one place. The chat, its tools and the page's tests read them from here. */
export const ASSISTANT_LIMITS = {
  /** Staff messages in one chat. The next one is refused. */
  staffMessages: 20,
  /** Model turns in one request. Each request starts at 0. */
  modelTurns: 6,
  /** How long one request may take, in milliseconds. */
  deadlineMs: 90_000,
  /** Output tokens in one model turn, thinking included. */
  maxTokens: 16_000,
  /** Rows in one list answer. */
  listRows: 50,
  /** Characters of each customer text in a list row. A single item keeps its full text. */
  listTextChars: 300,
  /** The longest draft, in characters. The dialogs and the server take the same. */
  draftChars: 2000,
} as const;

/** The Ask tab's saved chats. */
export const SAVED_CHATS = {
  /** The most chats the sidebar lists for one admin, newest first. */
  listRows: 100,
  /** The longest title, in characters. The title is the first staff message, cut. */
  titleChars: 80,
} as const;

export const TOOL_NAMES = [
  'browse_collections',
  'search_products',
  'view_product',
  'find_boutiques',
  'search_knowledge',
  'request_appointment',
  'my_appointments',
  'hand_off_to_staff',
  'log_inquiry',
  'appointment_requests',
  'confirm_appointment',
  'pending_confirmations',
  'record_confirmation',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const LOCALES = ['ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const CATEGORIES = ['trunk', 'bag', 'small-leather', 'travel', 'objet'] as const;
export const OCCASIONS = ['travel', 'anniversary', 'birthday', 'wedding', 'new-job'] as const;
export const PERSONALIZATION_KINDS = ['initials-hot-stamp', 'hand-painted-stripes', 'monogram-color'] as const;

/** What a product knowledge entry is about. The knowledge content type's category enum must match (test/unit/knowledge-schema.test.ts). */
export const KNOWLEDGE_CATEGORIES = ['care', 'materials', 'sizing', 'personalization', 'delivery', 'returns', 'repairs', 'warranty', 'gifting', 'store'] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

/** Why the concierge handed a question to staff. The question content type's reason enum must match (test/unit/question-schema.test.ts). */
export const QUESTION_REASONS = ['no_answer', 'asked_for_person'] as const;
export type QuestionReason = (typeof QUESTION_REASONS)[number];

/** A question is open until staff take it (Let them know) or answer it. The content type's status enum must match. */
export const QUESTION_STATUSES = ['open', 'taken', 'answered'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/** How many questions one customer can have with staff, open or taken, at a time. */
export const MAX_OPEN_QUESTIONS = 5;

/** One concierge turn as staff work from it. The inquiry content type's enums must match (test/unit/inquiry-schema.test.ts). */
export const INQUIRY_KINDS = ['question', 'complaint', 'praise', 'other'] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];
export const SENTIMENT_LABELS = ['positive', 'neutral', 'negative'] as const;
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];
export const ANALYSIS_STATUSES = ['pending', 'analyzed', 'failed', 'skipped'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
export const INQUIRY_QUEUES = ['needs-answer', 'complaint', 'praise', 'none'] as const;
export type InquiryQueue = (typeof INQUIRY_QUEUES)[number];
export const INQUIRY_STATUSES = ['open', 'replied', 'closed'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const CLOSE_REASONS = ['answered-elsewhere', 'not-needed', 'spam'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];
export const INQUIRY_VIA = ['concierge', 'line-chat'] as const;
/** What the Inquiries tab can show, as its pills. */
export const INQUIRY_FILTERS = ['needs-answer', 'complaint', 'praise', 'not-labelled', 'all'] as const;
export type InquiryFilter = (typeof INQUIRY_FILTERS)[number];
/** A row that failed this many times is parked until staff press Label again. */
export const MAX_LABEL_ATTEMPTS = 5;
/** How many inquiries one sweep labels. */
export const LABEL_BATCH = 10;

/** Where a visit was requested: the AI concierge, the app's own screens, or a website through the REST routes. */
export const CREATED_VIA = ['concierge', 'app', 'web'] as const;
export type CreatedVia = (typeof CREATED_VIA)[number];

/** Provides resolveSubject(authorization) for customer identity (oauth-mcp-manager 1.1). */
export const OAUTH_PLUGIN_ID = 'strapi-oauth-mcp-manager';
/** Informational only: which surface made the call ("concierge" or absent). Never used for identity. */
export const SURFACE_HEADER = 'x-maison-surface';
