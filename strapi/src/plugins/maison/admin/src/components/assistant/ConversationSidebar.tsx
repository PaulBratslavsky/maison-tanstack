import { Box, Typography } from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import styled from 'styled-components';

import type { SavedChatRow } from '../../conversations';
import { HISTORY_WIDTH } from './drawerWidth';

/**
 * The history sidebar, copied from strapi-plugin-tanstack-ai 1.6.0 (`ConversationSidebar.tsx`): 260px wide when open, and closed it
 * collapses to no width instead of leaving the page, so opening it is a width change and not a sudden change in the layout. At the top is New chat,
 * under it the list of this admin's chats, newest first, each row a title and a trash button that shows on hover or keyboard focus.
 * Without "Manage history": Maison has no page for it.
 *
 * What differs from the reference, on purpose:
 * - Its width includes its border (`box-sizing: border-box`), so the column is exactly 260px (`HISTORY_WIDTH`). The assistant's drawer is as wide as
 *   the chat and this column together, so a border outside the 260px would take a pixel from the chat. Opening the column makes the drawer wider and
 *   never takes width from the chat (drawerWidth.ts).
 * - While an answer comes, the rows, New chat and the trash buttons are off. Opening another chat then would swap the messages under an
 *   answer that is still being written.
 * - A closed sidebar is `inert`, so its buttons leave the tab order. The reference sets only `aria-hidden`, which leaves them focusable.
 * - The open chat's row says so to screen readers (`aria-current`), and each trash button names its chat.
 */

const SidebarRoot = styled.aside<{ $open: boolean }>`
  box-sizing: border-box;
  width: ${({ $open }) => ($open ? `${HISTORY_WIDTH}px` : '0px')};
  min-width: ${({ $open }) => ($open ? `${HISTORY_WIDTH}px` : '0px')};
  display: flex;
  flex-direction: column;
  border-right: ${({ $open, theme }) => ($open ? `1px solid ${theme.colors.neutral200}` : 'none')};
  background: ${({ theme }) => theme.colors.neutral100};
  overflow: hidden;
  transition: width 0.2s ease, min-width 0.2s ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const NewChatButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.neutral100};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const ChatList = styled.div`
  flex: 1;
  overflow-y: auto;
`;

/**
 * The row is a container holding two siblings, not a button holding a button. Nesting them is invalid HTML that browsers recover from
 * unpredictably, and the outer control's accessible name then absorbs the inner one's label.
 */
const Row = styled.div<{ $active: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 12px 0 0;
  background: ${({ $active, theme }) => ($active ? theme.colors.neutral200 : 'transparent')};

  &:hover {
    background: ${({ theme }) => theme.colors.neutral200};
  }

  /* Also shown on keyboard focus, or the trash button would be for the mouse only. */
  &:hover .delete-btn:not(:disabled),
  & .delete-btn:focus-visible:not(:disabled) {
    opacity: 1;
  }
`;

const SelectButton = styled.button`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 10px 0 10px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const DeleteButton = styled.button`
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.neutral600};

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.neutral300};
    color: ${({ theme }) => theme.colors.danger600};
  }

  &:disabled {
    cursor: not-allowed;
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

const Title = styled(Typography)`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
`;

interface ConversationSidebarProps {
  chats: readonly SavedChatRow[];
  /** The saved chat that is open, null for one that is not saved yet. */
  openId: string | null;
  open: boolean;
  /** An answer is on its way: the rows, New chat and the trash buttons are off. */
  busy: boolean;
  onSelect: (documentId: string) => void;
  onNew: () => void;
  onDelete: (documentId: string) => void;
}

export const ConversationSidebar = ({ chats, openId, open, busy, onSelect, onNew, onDelete }: ConversationSidebarProps) => (
  // React 18 has no `inert` property: the attribute is written as an empty string, which is how a browser reads a boolean attribute.
  <SidebarRoot $open={open} aria-hidden={!open} aria-label="Saved chats" {...(open ? {} : { inert: '' })}>
    <Box padding={3}>
      <NewChatButton type="button" disabled={busy} onClick={onNew}>
        <Plus />
        New chat
      </NewChatButton>
    </Box>

    <ChatList>
      {chats.map((chat) => (
        <Row key={chat.documentId} $active={chat.documentId === openId}>
          <SelectButton type="button" disabled={busy} aria-current={chat.documentId === openId ? 'true' : undefined} onClick={() => onSelect(chat.documentId)}>
            <Title variant="omega" textColor="neutral800">
              {chat.title}
            </Title>
          </SelectButton>
          <DeleteButton type="button" className="delete-btn" disabled={busy} aria-label={`Delete chat: ${chat.title}`} onClick={() => onDelete(chat.documentId)}>
            <Trash />
          </DeleteButton>
        </Row>
      ))}

      {chats.length === 0 && (
        <Box padding={4}>
          <Typography variant="omega" textColor="neutral500">
            No saved chats yet.
          </Typography>
        </Box>
      )}
    </ChatList>
  </SidebarRoot>
);
