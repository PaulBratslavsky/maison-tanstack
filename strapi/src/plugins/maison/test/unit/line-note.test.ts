import { describe, expect, it } from 'vitest';
import { lineNote } from '../../admin/src/line-note';
import { replyNotice } from '../../admin/src/questions';
import { DEMO_DETAIL } from '../../server/src/domain/line-outcome';

describe("lineNote: what a question's or an inquiry's status line says about LINE", () => {
  it("says the message failed, in LINE's words, in red", () => {
    expect(lineNote({ outcome: 'failed', detail: 'LINE answered 400.' })).toEqual({ text: 'LINE message failed: LINE answered 400.', tone: 'danger' });
    expect(lineNote({ outcome: 'failed', detail: null })).toEqual({ text: 'LINE message failed.', tone: 'danger' });
    expect(lineNote({ outcome: 'failed', detail: '' })).toEqual({ text: 'LINE message failed.', tone: 'danger' });
  });

  it('says a made-up customer gets no LINE message, in grey, never red, whatever the detail says', () => {
    expect(lineNote({ outcome: 'demo', detail: DEMO_DETAIL })).toEqual({ text: 'Demo customer: no LINE message.', tone: 'neutral' });
    expect(lineNote({ outcome: 'demo', detail: null })).toEqual({ text: 'Demo customer: no LINE message.', tone: 'neutral' });
  });

  it('says nothing once a message went out, or before there was one', () => {
    expect(lineNote({ outcome: 'sent', detail: '' })).toBeNull();
    expect(lineNote(null)).toBeNull();
    expect(lineNote(undefined)).toBeNull();
  });
});

describe('replyNotice, for a demo customer', () => {
  it("shows the server's words as an info notice: the action happened, and no LINE message went", () => {
    const message = 'Marked Q-4821 taken. Demo customer: no LINE message.';
    expect(replyNotice({ status: 'demo', message })).toEqual({ type: 'info', message });
  });

  it('still warns, and stays, when something after the action went wrong', () => {
    const message = "Answered Q-4821. Demo customer: no LINE message. It couldn't be added to product knowledge: database is locked";
    expect(replyNotice({ status: 'demo', message, warning: true })).toEqual({ type: 'warning', message, blockTransition: true });
  });

  it('is a success for a message LINE took, as before', () => {
    expect(replyNotice({ status: 'sent', message: 'Sent the LINE message for Q-4821.' })).toEqual({
      type: 'success',
      message: 'Sent the LINE message for Q-4821.',
    });
  });
});
