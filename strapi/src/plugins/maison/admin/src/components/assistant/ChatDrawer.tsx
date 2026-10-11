import * as React from 'react';

import { Box, Loader } from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import styled, { css, keyframes } from 'styled-components';

import { askTabState, canSend, type MessageSource } from '../../assistant';
import { useAssistant } from './AssistantProvider';
import { ChatArea } from './ChatArea';
import { ChatTopBar, TopBarSpacer } from './ChatFrame';
import { Composer } from './Composer';
import { ConversationSidebar } from './ConversationSidebar';
import { drawerWidthOf, MAX_DRAWER_WIDTH } from './drawerWidth';
import { ErrorBox, NoteBox } from './ErrorBox';
import { assistantLayer } from './layer';
import { MessageList } from './MessageList';
import { QuickQuestions } from './QuickQuestions';
import { SetupNotice } from './SetupNotice';
import { TopBarIcon } from './TopBarIcon';

const slideIn = keyframes`
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
`;

/**
 * The drawer: fixed to the right edge of the window, the full height, white, with a border on its left and the popup shadow. Its width is the width
 * of the chat, and of the list of saved chats while that is open (`drawerWidthOf`), and is never more than 90vw. It changes over 0.2 seconds, in
 * step with the list, which changes its own width in the same time, so the chat keeps its width as the list opens. It slides in from the right when
 * it opens. The page beside it stays usable: there is no dark layer behind it. Staff who prefer less motion get no slide and no change of width over time.
 *
 * It is not taken out of the page when it is closed. It is hidden: out of sight (`visibility`), out of reach of the pointer, and out of the keyboard
 * and the accessibility tree (`inert`, `aria-hidden`). Drawing it again would draw the chat's screen again, and what staff see when they open the
 * drawer must be what they left: the same messages, the same text box with what they typed in it, and where they had scrolled to. The box is a
 * content box, so the 1px border is outside its width and the chat column is exactly as wide as the chat. It is written out because the design
 * system's global style makes every box a border box, and in a border box the border would take one pixel from the chat.
 */
const DrawerRoot = styled.aside<{ $width: number; $open: boolean }>`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: ${assistantLayer};
  display: flex;
  flex-direction: column;
  box-sizing: content-box;
  width: ${({ $width }) => $width}px;
  max-width: ${MAX_DRAWER_WIDTH};
  background: ${({ theme }) => theme.colors.neutral0};
  border-left: 1px solid ${({ theme }) => theme.colors.neutral200};
  box-shadow: ${({ theme }) => theme.shadows.popupShadow};
  transition: width 0.2s ease;
  ${({ $open }) =>
    $open
      ? css`
          animation: ${slideIn} 0.2s ease-out;
        `
      : css`
          visibility: hidden;
          pointer-events: none;
        `}

  /* The drawer takes the focus while it has nothing better to give it to (see below), and a ring round all of it would only be noise. */
  &:focus {
    outline: none;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
    animation: none;
  }
`;

interface ChatDrawerProps {
  /** Whether the drawer is open. Closed, it stays in the page, hidden, with everything in it. */
  open: boolean;
  /** Whether the chat is wide (960px) and not narrow (600px). It changes the width of the chat and nothing else. */
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Close was pressed, or Escape. The parent hides the drawer and gives the focus back to the launcher. */
  onClose: () => void;
}

/**
 * The assistant's drawer: what the Ask tab was, in a panel that opens from a button on every admin page. The chat itself, and the text staff have
 * typed and not sent, are in the provider above, and the drawer stays in the page while it is closed, so both are as staff left them when they close
 * the drawer and open it again, and while they move between pages. Opening the drawer never starts a chat: only the New chat buttons do. Without a
 * set-up assistant the drawer shows why, and no text box.
 *
 * - Opening moves the focus to the text box. The text box is not there while the assistant is checked, or when it is not set up, so then the
 *   focus goes to the drawer, which Escape works from, and moves to the text box when it comes.
 * - Escape closes the drawer, when the focus is in it. It does not close it for an Escape that something else has used (a tooltip closing, or the
 *   list of tools, which says so by cancelling the event or by stopping it), and not for the Escape that cancels the conversion of Japanese.
 * - There is no focus trap: the page stays usable.
 * - Expand makes the chat wider and does nothing else. History alone shows and hides the saved chats, as a column beside the chat, and the drawer
 *   is wider by that column while it is open.
 */
export const ChatDrawer = ({ open, expanded, onToggleExpanded, onClose }: ChatDrawerProps) => {
  const assistant = useAssistant();
  const box = React.useRef<HTMLTextAreaElement>(null);
  const root = React.useRef<HTMLElement>(null);

  const state = assistant ? askTabState(assistant.status, assistant.statusFailed) : null;
  const showsChat = state?.kind === 'chat';

  // When the drawer opens, the focus goes to the text box, or to the drawer if there is no text box yet. A closed drawer is hidden, and can't take it.
  React.useEffect(() => {
    if (!open) return;
    if (box.current) box.current.focus();
    else root.current?.focus();
  }, [open]);

  // When the text box comes, it takes the focus if the focus is on the drawer or nowhere: still on the drawer, in a button that has just gone
  // (Check again), or lost with it. Staff may have moved the focus into the page meanwhile, and that is not taken from them.
  React.useEffect(() => {
    if (!open || !showsChat) return;
    const active = document.activeElement;
    if (!active || active === document.body || root.current?.contains(active)) box.current?.focus();
  }, [open, showsChat]);

  if (!assistant || !state) return null;

  const { busy, ready, notice, note, draft, history } = assistant;

  const closeButton = (
    <TopBarIcon label="Close the assistant" tipAlign="end" onClick={onClose}>
      <Cross />
    </TopBarIcon>
  );

  const frame = (listIsOpen: boolean, content: React.ReactNode) => (
    <DrawerRoot
      ref={root}
      role="complementary"
      aria-label="Maison assistant"
      aria-hidden={!open}
      // React 18 has no `inert` property: the attribute is written as an empty string, which is how a browser reads a boolean attribute.
      {...(open ? {} : { inert: '' })}
      tabIndex={-1}
      $open={open}
      $width={drawerWidthOf({ expanded, historyOpen: listIsOpen })}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.defaultPrevented) return;
        // The Escape that cancels the conversion of Japanese text (an input method that is composing) is the input method's. Safari reports
        // that Escape after the composition has ended, with keyCode 229.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        onClose();
      }}
    >
      {content}
    </DrawerRoot>
  );

  // Before the chat, the drawer has only Close in its top bar, so staff can always close it. It has no list of saved chats, so it is as wide as the chat.
  const bar = (
    <ChatTopBar>
      <TopBarSpacer />
      {closeButton}
    </ChatTopBar>
  );

  if (state.kind === 'loading') {
    return frame(
      false,
      <>
        {bar}
        <Box padding={6}>
          <Loader small>Checking the assistant…</Loader>
        </Box>
      </>
    );
  }

  if (state.kind === 'failed') {
    return frame(
      false,
      <>
        {bar}
        <Box padding={4}>
          <SetupNotice tone="danger" onCheckAgain={() => void assistant.recheck()}>
            {state.text}
          </SetupNotice>
        </Box>
      </>
    );
  }

  if (state.kind === 'not-ready') {
    return frame(
      false,
      <>
        {bar}
        <Box padding={4}>
          <SetupNotice title="The assistant isn't set up" onCheckAgain={() => void assistant.recheck()}>
            {state.text}
          </SetupNotice>
        </Box>
      </>
    );
  }

  const send = (message: string, source: MessageSource) => {
    if (!canSend({ text: message, busy, ready })) return;
    void assistant.send(message, source);
    // A quick question's button and Send are both switched off while the answer comes, so the focus would be lost with them: the text box keeps it.
    box.current?.focus();
  };

  return frame(
    history.sidebarOpen,
    <ChatArea
      model={state.model}
      tools={state.tools}
      canStartOver={assistant.messages.length > 0 || notice !== null || note !== null}
      newChatOffered={notice?.newChat === true}
      onNewChat={assistant.newChat}
      sidebar={
        <ConversationSidebar
          chats={history.chats}
          openId={history.openId}
          open={history.sidebarOpen}
          busy={busy}
          onSelect={(id) => void history.openChat(id)}
          onNew={assistant.newChat}
          onDelete={(id) => void history.deleteChat(id)}
        />
      }
      historyOpen={history.sidebarOpen}
      onToggleHistory={() => history.setSidebarOpen(!history.sidebarOpen)}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      onClose={onClose}
    >
      <MessageList messages={assistant.messages} busy={busy} />
      {/* A turn's error is shown in place of a problem with the saved chats, because it is about what staff are watching. */}
      {(notice?.text ?? history.error) && <ErrorBox>{notice?.text ?? history.error}</ErrorBox>}
      {note && <NoteBox>{note}</NoteBox>}
      {/* The five quick questions, directly above the text box and outside the list, for the whole chat. Pressing one sends it as a starter. */}
      <QuickQuestions onAsk={(question) => send(question, 'starter')} canAsk={(question) => canSend({ text: question, busy, ready })} />
      <Composer draft={draft} onDraft={assistant.setDraft} busy={busy} ready={ready} onSend={(text) => send(text, 'box')} onStop={assistant.stop} textareaRef={box} />
    </ChatArea>
  );
};
