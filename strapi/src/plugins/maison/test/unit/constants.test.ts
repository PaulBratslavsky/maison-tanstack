import { describe, expect, it } from 'vitest';
import {
  ACTION,
  ANALYSIS_STATUSES,
  ASSISTANT_LIMITS,
  CLOSE_REASONS,
  INQUIRY_FILTERS,
  INQUIRY_KINDS,
  INQUIRY_QUEUES,
  INQUIRY_STATUSES,
  INQUIRY_VIA,
  LABEL_BATCH,
  MAX_LABEL_ATTEMPTS,
  MAX_OPEN_QUESTIONS,
  PLUGIN_ID,
  QUESTION_REASONS,
  QUESTION_STATUSES,
  SAVED_CHATS,
  SENTIMENT_LABELS,
  TOOL_NAMES,
  UID,
} from '../../server/src/constants';

describe('constants', () => {
  it('uses the maison plugin id everywhere', () => {
    expect(PLUGIN_ID).toBe('maison');
    for (const uid of Object.values(UID)) expect(uid.startsWith('plugin::maison.')).toBe(true);
    for (const action of Object.values(ACTION)) expect(action.startsWith('plugin::maison.')).toBe(true);
  });

  it('declares the thirteen tools exactly once each', () => {
    expect(TOOL_NAMES).toHaveLength(13);
    expect(new Set(TOOL_NAMES).size).toBe(13);
  });

  it('lists hand_off_to_staff right after my_appointments, and log_inquiry right after it, in the order the tools are registered', () => {
    expect(TOOL_NAMES).toEqual([
      'browse_collections', 'search_products', 'view_product', 'find_boutiques', 'search_knowledge',
      'request_appointment', 'my_appointments', 'hand_off_to_staff', 'log_inquiry',
      'appointment_requests', 'confirm_appointment', 'pending_confirmations', 'record_confirmation',
    ]);
  });

  it('declares the staff actions', () => {
    expect(ACTION.appointmentsReview).toBe('plugin::maison.appointments.review');
    expect(ACTION.appointmentsConfirm).toBe('plugin::maison.appointments.confirm');
  });

  it('declares the question: its UID, its three actions, its reasons and statuses, and how many a customer can have open', () => {
    expect(UID.question).toBe('plugin::maison.question');
    expect(ACTION.questionsAsk).toBe('plugin::maison.questions.ask');
    expect(ACTION.questionsRead).toBe('plugin::maison.questions.read');
    expect(ACTION.questionsAnswer).toBe('plugin::maison.questions.answer');
    expect(QUESTION_REASONS).toEqual(['no_answer', 'asked_for_person']);
    expect(QUESTION_STATUSES).toEqual(['open', 'taken', 'answered']);
    expect(MAX_OPEN_QUESTIONS).toBe(5);
  });

  it('declares the inquiry: its UID, its three actions, the values of its labels and workflow, and the limits on labelling', () => {
    expect(UID.inquiry).toBe('plugin::maison.inquiry');
    expect(ACTION.inquiriesLog).toBe('plugin::maison.inquiries.log');
    expect(ACTION.inquiriesView).toBe('plugin::maison.inquiries.view');
    expect(ACTION.inquiriesReply).toBe('plugin::maison.inquiries.reply');
    expect(INQUIRY_KINDS).toEqual(['question', 'complaint', 'praise', 'other']);
    expect(SENTIMENT_LABELS).toEqual(['positive', 'neutral', 'negative']);
    expect(ANALYSIS_STATUSES).toEqual(['pending', 'analyzed', 'failed', 'skipped']);
    expect(INQUIRY_QUEUES).toEqual(['needs-answer', 'complaint', 'praise', 'none']);
    expect(INQUIRY_STATUSES).toEqual(['open', 'replied', 'closed']);
    expect(CLOSE_REASONS).toEqual(['answered-elsewhere', 'not-needed', 'spam']);
    expect(INQUIRY_VIA).toEqual(['concierge', 'line-chat']);
    expect(MAX_LABEL_ATTEMPTS).toBe(5);
    expect(LABEL_BATCH).toBe(10);
  });

  it('declares the filters the Inquiries tab shows, in the order of its pills', () => {
    expect(INQUIRY_FILTERS).toEqual(['needs-answer', 'complaint', 'praise', 'not-labelled', 'all']);
  });

  it('declares the assistant: its permission, and its limits in one place', () => {
    expect(ACTION.assistantUse).toBe('plugin::maison.assistant.use');
    expect(ASSISTANT_LIMITS).toEqual({
      staffMessages: 20,
      modelTurns: 6,
      deadlineMs: 90_000,
      maxTokens: 16_000,
      listRows: 50,
      listTextChars: 300,
      draftChars: 2000,
    });
  });

  it('declares the saved chats: the content type, and how many the sidebar lists and how long a title is', () => {
    expect(UID.conversation).toBe('plugin::maison.conversation');
    expect(SAVED_CHATS).toEqual({ listRows: 100, titleChars: 80 });
  });
});
