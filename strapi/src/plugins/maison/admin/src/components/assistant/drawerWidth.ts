/**
 * How wide the assistant's drawer is. The chat has a width of its own, and nothing but the limit below takes from it:
 * - **Expand** makes the chat wider, 600px to 960px, and does nothing else.
 * - **History** shows the list of saved chats as a column beside the chat, to its left, and makes the drawer wider by the width of that column. The chat
 *   keeps its width. Closing the list makes the drawer narrower again.
 * - The drawer is never wider than 90vw. Only then does the chat column have less width: the list keeps its 260px.
 */

/** The width of the chat column: 600px, or 960px when the drawer is expanded. */
export const CHAT_WIDTH = { narrow: 600, wide: 960 } as const;

/** The width of the list of saved chats, with its border, as a column beside the chat. */
export const HISTORY_WIDTH = 260;

/**
 * The most of the window the drawer takes, so it never covers the whole screen: 90vw, with its 1px border. The drawer is a content box, so its
 * border is outside its width, and the limit on the width is 1px less than 90vw for the whole drawer to be at most 90vw. It is a CSS length: the
 * browser applies it as the window changes.
 */
export const MAX_DRAWER_WIDTH = 'calc(90vw - 1px)';

export const chatWidthOf = (expanded: boolean): number => (expanded ? CHAT_WIDTH.wide : CHAT_WIDTH.narrow);

/** The width the drawer asks for, in pixels: the chat, and the list beside it while History is on. The limit above applies on top of this. */
export const drawerWidthOf = ({ expanded, historyOpen }: { expanded: boolean; historyOpen: boolean }): number => chatWidthOf(expanded) + (historyOpen ? HISTORY_WIDTH : 0);
