const REVIEW = { action: 'plugin::maison.appointments.review', subject: null };
const CONFIRM = { action: 'plugin::maison.appointments.confirm', subject: null };
const MANAGE = { action: 'plugin::maison.demo.manage', subject: null };
const QUESTIONS_READ = { action: 'plugin::maison.questions.read', subject: null };
const QUESTIONS_ANSWER = { action: 'plugin::maison.questions.answer', subject: null };
const INQUIRIES_VIEW = { action: 'plugin::maison.inquiries.view', subject: null };
const INQUIRIES_REPLY = { action: 'plugin::maison.inquiries.reply', subject: null };
const ASSISTANT_USE = { action: 'plugin::maison.assistant.use', subject: null };

export const PERMISSIONS = {
  /** The menu entry and the page: staff who review requests, read questions, review inquiries, or manage the demo data. Any one is enough. */
  page: [REVIEW, MANAGE, QUESTIONS_READ, INQUIRIES_VIEW],
  /** Checked with useRBAC by the Maison page, which answers canReview, canConfirm, canManage, canRead, canAnswer, canView and canReply. */
  sections: [REVIEW, CONFIRM, MANAGE, QUESTIONS_READ, QUESTIONS_ANSWER, INQUIRIES_VIEW, INQUIRIES_REPLY],
  /**
   * The assistant: a drawer on every admin page, drawn by Maison's menu icon, which checks this with useRBAC and reads canUse. It is not in
   * `page`: it doesn't open the page on its own. The menu link itself needs `page`, so an admin who may use the assistant and may not open the
   * page has no drawer (the icon is not drawn for them).
   */
  assistant: [ASSISTANT_USE],
  /** The Homepage widget, which shows the requests board's numbers: staff who review requests. */
  widget: [REVIEW],
  /** The second Homepage widget, which shows the open inquiries by queue: staff who review inquiries. */
  inquiriesWidget: [INQUIRIES_VIEW],
};
