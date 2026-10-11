// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatArea } from '../../admin/src/components/assistant/ChatArea';
import { declarationsOf } from './css';
import { renderInTheme } from './render';

const TOOLS = [
  { name: 'list_requests', label: 'Visit requests' },
  { name: 'inquiry_counts', label: 'Inquiry counts' },
];

const area = (props: Partial<Parameters<typeof ChatArea>[0]> = {}) => (
  <ChatArea
    model="claude-sonnet-5-5"
    tools={TOOLS}
    canStartOver
    newChatOffered={false}
    onNewChat={() => {}}
    sidebar={<nav aria-label="The sidebar">The saved chats</nav>}
    historyOpen={false}
    onToggleHistory={() => {}}
    expanded={false}
    onToggleExpanded={() => {}}
    onClose={() => {}}
    {...props}
  >
    <p>The messages and the composer</p>
  </ChatArea>
);

const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('ChatArea', () => {
  it('has the sidebar, then History, the tools, the model, New chat, Expand and Close in the top bar, in that order, and what it is given under it', () => {
    renderInTheme(area());
    const sidebar = screen.getByRole('navigation', { name: 'The sidebar' });
    const history = screen.getByRole('button', { name: 'History' });
    const tools = screen.getByRole('button', { name: 'Tools (2)' });
    const model = screen.getByText('claude-sonnet-5-5');
    const newChat = screen.getByRole('button', { name: 'New chat' });
    const expand = screen.getByRole('button', { name: 'Expand the assistant' });
    const close = screen.getByRole('button', { name: 'Close the assistant' });
    const body = screen.getByText('The messages and the composer');
    expect(before(sidebar, history)).toBe(true);
    expect(before(history, tools)).toBe(true);
    expect(before(tools, model)).toBe(true);
    expect(before(model, newChat)).toBe(true);
    expect(before(newChat, expand)).toBe(true);
    expect(before(expand, close)).toBe(true);
    expect(before(close, body)).toBe(true);
  });

  describe('Expand and Close', () => {
    it('widens the drawer with Expand, which says so, and narrows it with Collapse, which says so', async () => {
      const onToggleExpanded = vi.fn();
      const view = renderInTheme(area({ onToggleExpanded }));
      expect(screen.queryByRole('button', { name: 'Collapse the assistant' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
      expect(onToggleExpanded).toHaveBeenCalledOnce();

      view.unmount();
      renderInTheme(area({ expanded: true, onToggleExpanded }));
      expect(screen.queryByRole('button', { name: 'Expand the assistant' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Collapse the assistant' }));
      expect(onToggleExpanded).toHaveBeenCalledTimes(2);
    });

    it('closes the drawer with Close, whose tooltip ends at its right edge, because it is at the edge of the screen', async () => {
      const onClose = vi.fn();
      renderInTheme(area({ onClose }));
      const close = screen.getByRole('button', { name: 'Close the assistant' });
      expect(close.getAttribute('data-tip')).toBe('Close the assistant');
      expect(close.querySelector('svg')).not.toBeNull();
      expect(declarationsOf(close, '::after').right).toBe('0');
      expect(declarationsOf(close, '::after').left).toBeUndefined();
      // Expand is not at the edge: its tooltip stays centred under it.
      expect(declarationsOf(screen.getByRole('button', { name: 'Expand the assistant' }), '::after').left).toBe('50%');
      await userEvent.click(close);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('are not switched off when there is no chat to start over from: they are about the drawer, not the chat', () => {
      renderInTheme(area({ canStartOver: false }));
      expect((screen.getByRole('button', { name: 'Expand the assistant' }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole('button', { name: 'Close the assistant' }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('the saved chats and the chat', () => {
    it('are side by side, the list first: the list is a column beside the chat, to its left, and never over it', () => {
      renderInTheme(area());
      const sidebar = screen.getByRole('navigation', { name: 'The sidebar' });
      expect(before(sidebar, screen.getByRole('button', { name: 'History' }))).toBe(true);
      expect(before(sidebar, screen.getByText('The messages and the composer'))).toBe(true);
      expect(declarationsOf(sidebar).position).toBeUndefined();
    });

    // History adds width to the drawer and the chat keeps its own: the column is 600px, or 960px when the drawer is expanded, and it is the one
    // that has less width when the drawer is at its limit of 90vw (it may shrink, and has nothing under it).
    it('give the chat column the width of the chat, 600px or 960px expanded, as the width it starts from, and let it shrink', () => {
      const view = renderInTheme(area());
      const column = screen.getByText('The messages and the composer').parentElement as HTMLElement;
      expect(declarationsOf(column).flex).toBe('1 1 600px');
      expect(declarationsOf(column)['min-width']).toBe('0');

      view.unmount();
      renderInTheme(area({ expanded: true }));
      expect(declarationsOf(screen.getByText('The messages and the composer').parentElement as HTMLElement).flex).toBe('1 1 960px');
    });
  });

  it('opens and closes the sidebar with History, which says what it will do and whether the sidebar is open', async () => {
    const onToggleHistory = vi.fn();
    const view = renderInTheme(area({ onToggleHistory }));
    const closed = screen.getByRole('button', { name: 'History' });
    expect(closed.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(closed);
    expect(onToggleHistory).toHaveBeenCalledOnce();

    view.unmount();
    renderInTheme(area({ historyOpen: true }));
    const opened = screen.getByRole('button', { name: 'Hide history' });
    expect(opened.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull();
  });

  it('names the model as the status gave it: the ID as it is, which the badge draws in capitals', () => {
    renderInTheme(area({ model: 'claude-sonnet-5' }));
    expect(screen.getByText('claude-sonnet-5')).toBeTruthy();
  });

  it('counts the tools it is given on the Tools button', () => {
    renderInTheme(area({ tools: [] }));
    expect(screen.getByRole('button', { name: 'Tools (0)' })).toBeTruthy();
  });

  it('starts a new chat when New chat is pressed', async () => {
    const onNewChat = vi.fn();
    renderInTheme(area({ onNewChat }));
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it('switches New chat off when there is no chat to start over from', async () => {
    const onNewChat = vi.fn();
    renderInTheme(area({ canStartOver: false, onNewChat }));
    const button = screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await userEvent.click(button);
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it('shows the words "New chat" on the button when the notice offers a new chat as the way on, and only then', () => {
    const { unmount } = renderInTheme(area({ newChatOffered: true }));
    expect(screen.getByRole('button', { name: 'New chat' }).textContent).toBe('New chat');
    unmount();
    renderInTheme(area({ newChatOffered: false }));
    expect(screen.getByRole('button', { name: 'New chat' }).textContent).toBe('');
  });

  it('does not copy the reference\'s memories, notes or context badge', () => {
    renderInTheme(area());
    for (const name of [/memories/i, /notes/i, /context/i, /local/i]) expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('draws in the dark theme too', () => {
    renderInTheme(area(), { dark: true });
    expect(screen.getByText('claude-sonnet-5-5')).toBeTruthy();
  });
});
