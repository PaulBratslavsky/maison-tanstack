import { describe, expect, it } from 'vitest';
import { CHAT_WIDTH, HISTORY_WIDTH, MAX_DRAWER_WIDTH, chatWidthOf, drawerWidthOf } from '../../admin/src/components/assistant/drawerWidth';

/**
 * How wide the assistant's drawer is. The chat has a width of its own, 600px or 960px when expanded, and History never takes from it: the list of
 * saved chats is a column of 260px beside the chat, and opening it makes the drawer wider by that much. Paul's words for it: "history should not
 * interfere with the width, it should just open wider to preserve the chat". Only the limit of 90vw can take width from the chat.
 */
describe('the chat width', () => {
  it('is 600px, or 960px when the drawer is expanded', () => {
    expect(CHAT_WIDTH).toEqual({ narrow: 600, wide: 960 });
    expect(chatWidthOf(false)).toBe(600);
    expect(chatWidthOf(true)).toBe(960);
  });
});

describe('the width of the list of saved chats', () => {
  it('is 260px', () => {
    expect(HISTORY_WIDTH).toBe(260);
  });
});

describe('the drawer width', () => {
  it('is the width of the chat while History is off, so Expand makes the chat wider and does nothing else', () => {
    expect(drawerWidthOf({ expanded: false, historyOpen: false })).toBe(600);
    expect(drawerWidthOf({ expanded: true, historyOpen: false })).toBe(960);
  });

  it('is 260px wider while History is on: 860px, or 1220px expanded', () => {
    expect(drawerWidthOf({ expanded: false, historyOpen: true })).toBe(860);
    expect(drawerWidthOf({ expanded: true, historyOpen: true })).toBe(1220);
  });

  it('leaves the chat as wide as it was when History opens, at either width: the list is added beside it', () => {
    for (const expanded of [false, true]) {
      expect(drawerWidthOf({ expanded, historyOpen: true }) - HISTORY_WIDTH, String(expanded)).toBe(chatWidthOf(expanded));
    }
  });

  it('never covers the whole screen: it is at most 90vw, whatever its width, and only then does the chat column have less width', () => {
    // The drawer is a content box with a 1px border, so the width is held 1px under 90vw, and the drawer with its border is at most 90vw.
    expect(MAX_DRAWER_WIDTH).toBe('calc(90vw - 1px)');
  });
});
