import type { ReactNode } from 'react';

import { Cross } from '@strapi/icons';

import type { ToolInfo } from '../../assistant';
import { ChatColumn, ChatLayout, ChatTopBar, TopBarSpacer } from './ChatFrame';
import { chatWidthOf } from './drawerWidth';
import { ModelBadge } from './ModelBadge';
import { ToolsPopover } from './ToolsPopover';
import { CollapseIcon, ExpandIcon, HistoryIcon, NewChatIcon, TopBarIcon } from './TopBarIcon';

interface ChatAreaProps {
  model: string;
  tools: readonly ToolInfo[];
  /** Whether there is a chat to start over from: messages, or a notice. With none, New chat does nothing and is switched off. */
  canStartOver: boolean;
  /** The notice under the messages offers a new chat as the way on: the button says so, in words. */
  newChatOffered: boolean;
  onNewChat: () => void;
  /** The saved chats, a column to the left of the chat column. The drawer is made wider by the column while it is open, so the chat keeps its width. */
  sidebar: ReactNode;
  /** Whether the saved chats are open: the History button shows them, and its label says what it will do. */
  historyOpen: boolean;
  onToggleHistory: () => void;
  /** Whether the drawer is expanded: the button makes the chat wider when it is not, and narrower when it is, and its label says which. It does nothing else. */
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Close was pressed. */
  onClose: () => void;
  /** The chat column under the top bar: the messages, the error box and the composer. */
  children: ReactNode;
}

/**
 * The chat area: the saved chats and the chat column, and in the column the top bar and what is under it. From the left, the top bar has History,
 * the tools and the model, and at the right end New chat, Expand (or Collapse) and Close. strapi-plugin-tanstack-ai's context badge, "local"
 * marker, memories and notes are not copied. Expand and Close are the drawer's own: the reference has no drawer. The chat column starts from
 * the width of the chat (drawerWidth.ts), which History never takes from.
 */
export const ChatArea = ({
  model,
  tools,
  canStartOver,
  newChatOffered,
  onNewChat,
  sidebar,
  historyOpen,
  onToggleHistory,
  expanded,
  onToggleExpanded,
  onClose,
  children,
}: ChatAreaProps) => (
  <ChatLayout>
    {sidebar}
    <ChatColumn $width={chatWidthOf(expanded)}>
      <ChatTopBar>
        <TopBarIcon label={historyOpen ? 'Hide history' : 'History'} active={historyOpen} expanded={historyOpen} onClick={onToggleHistory}>
          <HistoryIcon />
        </TopBarIcon>
        <ToolsPopover tools={tools} />
        <ModelBadge model={model} />
        <TopBarSpacer />
        <TopBarIcon label="New chat" disabled={!canStartOver} emphasis={newChatOffered ? 'New chat' : undefined} onClick={onNewChat}>
          <NewChatIcon />
        </TopBarIcon>
        <TopBarIcon label={expanded ? 'Collapse the assistant' : 'Expand the assistant'} onClick={onToggleExpanded}>
          {expanded ? <CollapseIcon /> : <ExpandIcon />}
        </TopBarIcon>
        <TopBarIcon label="Close the assistant" tipAlign="end" onClick={onClose}>
          <Cross />
        </TopBarIcon>
      </ChatTopBar>
      {children}
    </ChatColumn>
  </ChatLayout>
);
