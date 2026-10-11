import { describe, expect, it } from 'vitest';
import { customEventNote, errorNotice } from '../../admin/src/assistant';
import { ASSISTANT_LIMITS } from '../../server/src/constants';
import { CHAT_TOO_LONG_TEXT, SOMETHING_WRONG_TEXT, staffErrorOf } from '../../server/src/assistant/errors';

/**
 * The admin bundle can't import server code when it runs, so admin/src/assistant.ts writes a few of the server's values
 * out again. This test imports both sides and fails when either one changes without the other.
 */
describe('the texts the admin repeats from the server', () => {
  it("says the number of steps the server allows in one answer: the model turns of ASSISTANT_LIMITS", () => {
    expect(customEventNote('max_turns')).toBe(`The assistant stopped after ${ASSISTANT_LIMITS.modelTurns} steps. Ask a narrower question.`);
  });

  it("says a chat that is too long as the server does, for a 413 and for the server's own chat_too_long error", () => {
    const fromStatus = errorNotice(new Error('HTTP error! status: 413 Payload Too Large'));
    expect(fromStatus).toEqual({ text: CHAT_TOO_LONG_TEXT, newChat: true });

    const serverText = staffErrorOf({ code: 'chat_too_long' }, { model: 'claude-sonnet-5-5' }).message;
    expect(serverText).toBe(CHAT_TOO_LONG_TEXT);
    expect(fromStatus.text).toBe(serverText);
  });

  // The two errors that offer New chat are told apart by their code. If the server renamed one, the page would stop offering it.
  it('offers a new chat for the two server errors that call for one: the chat that is too long, and a history Anthropic rejected', () => {
    const context = { model: 'claude-sonnet-5-5' };
    const tooLong = staffErrorOf({ code: 'chat_too_long' }, context);
    const rejected = staffErrorOf({ code: '400', message: 'messages.1.content.0: Invalid `signature` in `thinking` block' }, context);

    for (const staff of [tooLong, rejected]) {
      const error = Object.assign(new Error(staff.message), { code: staff.code });
      expect(errorNotice(error), staff.code).toEqual({ text: staff.message, newChat: true, code: staff.code });
    }
  });

  it("says the general error as the server does, for every error it can't name", () => {
    const serverText = staffErrorOf({ code: 'unknown' }, { model: 'claude-sonnet-5-5' }).message;
    expect(serverText).toBe(SOMETHING_WRONG_TEXT);

    for (const error of [undefined, new Error('Something broke'), new Error('HTTP error! status: 400 Bad Request'), new Error('HTTP error! status: 500 Server Error')]) {
      expect(errorNotice(error).text, String(error)).toBe(SOMETHING_WRONG_TEXT);
    }
  });
});
