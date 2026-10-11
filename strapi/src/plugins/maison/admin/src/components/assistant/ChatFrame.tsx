import styled from 'styled-components';

/**
 * The chat area and its pieces, copied from strapi-plugin-tanstack-ai 1.6.0 (`ChatPanel.tsx`): the sidebar and the chat column side by side, and
 * in the column the top bar, the messages and the composer. The reference puts them in a white rectangle with a 4px radius and the table
 * shadow, in the middle of a page. Here they fill the assistant's drawer, which has its own white frame, border and shadow (ChatDrawer.tsx).
 */

/**
 * Fills the drawer under nothing but itself: the drawer is a flex column and this takes what it has. `min-height: 0` is needed because a
 * flex child will not shrink below its content, so without it the messages would push the composer off the bottom instead of scrolling.
 */
export const ChatLayout = styled.div`
  display: flex;
  flex-direction: row;
  flex: 1 1 0%;
  min-height: 0;
  background: ${({ theme }) => theme.colors.neutral0};
`;

/**
 * The chat column. It starts from the width of the chat, 600px or 960px when the drawer is expanded (`$width`), and the list of saved chats is
 * added beside it, so opening the list makes the drawer wider and leaves the chat as wide as it was. The column may shrink (`flex-shrink: 1`,
 * `min-width: 0`): when the drawer is at its limit of 90vw, the list keeps its 260px and the chat column has less width.
 */
export const ChatColumn = styled.div<{ $width: number }>`
  display: flex;
  flex-direction: column;
  flex: 1 1 ${({ $width }) => $width}px;
  min-width: 0;
  min-height: 0;
`;

/**
 * The bar of controls. It wraps when it is too narrow for them, which a long model ID in the badge can cause when the window is small and the drawer
 * is held at 90vw: the last buttons then go to a second line, and none is cut off.
 */
export const ChatTopBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral200};
  gap: 8px;
`;

/** Pushes what follows to the right-hand end of the bar. */
export const TopBarSpacer = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`;
