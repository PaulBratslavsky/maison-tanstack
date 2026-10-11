// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConversationSidebar } from '../../admin/src/components/assistant/ConversationSidebar';
import { declarationsOf } from './css';
import { renderInTheme } from './render';

const CHATS = [
  { documentId: 'c3', title: 'Any complaints this week?', updatedAt: '2026-10-07T03:00:00.000Z' },
  { documentId: 'c2', title: 'Which visits are waiting for staff?', updatedAt: '2026-10-07T02:00:00.000Z' },
  { documentId: 'c1', title: '今日のお客様からの問い合わせは?', updatedAt: '2026-10-07T01:00:00.000Z' },
];

const sidebar = (props: Partial<Parameters<typeof ConversationSidebar>[0]> = {}) => (
  <ConversationSidebar chats={CHATS} openId="c2" open busy={false} onSelect={() => {}} onNew={() => {}} onDelete={() => {}} {...props} />
);
const root = () => screen.getByLabelText('Saved chats');

/** The rules styled-components wrote for an element: every rule in the document that starts with one of its classes. */
const cssOf = (element: Element): string => {
  const all = Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  const classes = Array.from(element.classList);
  return all
    .split('}')
    .filter((rule) => classes.some((name) => rule.trimStart().startsWith(`.${name}`)))
    .map((rule) => `${rule}}`)
    .join('\n');
};

describe('ConversationSidebar', () => {
  it('is a landmark that has a name, so a screen reader can speak it: an aside called "Saved chats"', () => {
    renderInTheme(sidebar());
    expect(root().tagName).toBe('ASIDE');
    expect(screen.getByRole('complementary', { name: 'Saved chats' })).toBe(root());
  });

  it('lists the chats in the order it is given, newest first, each as a button with its title', () => {
    renderInTheme(sidebar());
    const titles = within(root())
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text && !text.startsWith('New chat'));
    expect(titles).toEqual(['Any complaints this week?', 'Which visits are waiting for staff?', '今日のお客様からの問い合わせは?']);
  });

  it('opens a chat when its row is pressed', async () => {
    const onSelect = vi.fn();
    renderInTheme(sidebar({ onSelect }));
    await userEvent.click(screen.getByRole('button', { name: 'Any complaints this week?' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('c3');
  });

  it("marks the open chat's row, for a screen reader, and no other", () => {
    renderInTheme(sidebar());
    expect(screen.getByRole('button', { name: 'Which visits are waiting for staff?' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'Any complaints this week?' }).hasAttribute('aria-current')).toBe(false);
  });

  it('marks no row for a chat that is not saved yet', () => {
    renderInTheme(sidebar({ openId: null }));
    for (const button of within(root()).getAllByRole('button')) expect(button.hasAttribute('aria-current')).toBe(false);
  });

  it('starts a new chat with the button at its top', async () => {
    const onNew = vi.fn();
    renderInTheme(sidebar({ onNew }));
    await userEvent.click(within(root()).getByRole('button', { name: 'New chat' }));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it('deletes a chat with its own trash button, named for the chat, and opens nothing', async () => {
    const onDelete = vi.fn();
    const onSelect = vi.fn();
    renderInTheme(sidebar({ onDelete, onSelect }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Which visits are waiting for staff?' }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('c2');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the row and its trash button apart, as siblings: neither is inside the other', () => {
    renderInTheme(sidebar());
    const select = screen.getByRole('button', { name: 'Which visits are waiting for staff?' });
    const trash = screen.getByRole('button', { name: 'Delete chat: Which visits are waiting for staff?' });
    expect(select.contains(trash)).toBe(false);
    expect(trash.contains(select)).toBe(false);
    expect(select.parentElement).toBe(trash.parentElement);
  });

  it('says there are no saved chats when the list is empty', () => {
    renderInTheme(sidebar({ chats: [], openId: null }));
    expect(screen.getByText('No saved chats yet.')).toBeTruthy();
    expect(screen.queryByText('No saved chats yet.')?.closest('button')).toBeNull();
  });

  it('shows no empty text when there are chats', () => {
    renderInTheme(sidebar());
    expect(screen.queryByText('No saved chats yet.')).toBeNull();
  });

  describe('while an answer comes', () => {
    it('switches off every row, every trash button and New chat, and does nothing when they are pressed', async () => {
      const onSelect = vi.fn();
      const onNew = vi.fn();
      const onDelete = vi.fn();
      renderInTheme(sidebar({ busy: true, onSelect, onNew, onDelete }));
      const buttons = within(root()).getAllByRole('button') as HTMLButtonElement[];
      expect(buttons).toHaveLength(1 + CHATS.length * 2);
      for (const button of buttons) {
        expect(button.disabled, button.getAttribute('aria-label') ?? button.textContent ?? '').toBe(true);
        await userEvent.click(button);
      }
      expect(onSelect).not.toHaveBeenCalled();
      expect(onNew).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('switches them on again when the answer is over', () => {
      renderInTheme(sidebar({ busy: false }));
      for (const button of within(root()).getAllByRole('button') as HTMLButtonElement[]) expect(button.disabled).toBe(false);
    });
  });

  describe('closed', () => {
    it('is hidden from screen readers and inert, so its buttons leave the tab order', () => {
      renderInTheme(sidebar({ open: false }));
      const closed = document.querySelector('[aria-label="Saved chats"]') as HTMLElement;
      expect(closed.getAttribute('aria-hidden')).toBe('true');
      expect(closed.hasAttribute('inert')).toBe(true);
    });

    it('is not hidden and not inert when it is open', () => {
      renderInTheme(sidebar({ open: true }));
      expect(root().getAttribute('aria-hidden')).toBe('false');
      expect(root().hasAttribute('inert')).toBe(false);
    });

    it('is 260px wide when open and has no width at all when closed, so opening it changes its width and nothing around it', () => {
      const open = renderInTheme(sidebar({ open: true }));
      expect(cssOf(root())).toMatch(/[{;]width:260px;/);
      expect(cssOf(root())).toContain('min-width:260px');
      open.unmount();
      renderInTheme(sidebar({ open: false }));
      const closed = document.querySelector('[aria-label="Saved chats"]') as HTMLElement;
      expect(cssOf(closed)).toMatch(/[{;]width:0px;/);
      expect(cssOf(closed)).toContain('min-width:0px');
      expect(cssOf(closed)).toContain('overflow:hidden');
    });

    // The drawer is as wide as the chat plus this column, and the chat is exactly 600px or 960px. A border outside the 260px would take 1px from it.
    it('is 260px wide with its border inside, so the drawer is as wide as the chat and the column together, and not a pixel more', () => {
      renderInTheme(sidebar({ open: true }));
      const declarations = declarationsOf(root());
      expect(declarations['box-sizing']).toBe('border-box');
      expect(declarations.width).toBe('260px');
      expect(declarations['min-width']).toBe('260px');
      expect(declarations['border-right']).toMatch(/^1px solid /);
    });

    it('has no overlay form: it is a column beside the chat at either width of the drawer', () => {
      renderInTheme(sidebar({ open: true }));
      expect(declarationsOf(root()).position).toBeUndefined();
      expect(declarationsOf(root()).display).toBe('flex');
    });

    it('keeps its rows in the document, so opening it is a change of width and not a new list', () => {
      renderInTheme(sidebar({ open: false }));
      expect(document.querySelectorAll('[aria-label="Saved chats"] button').length).toBeGreaterThan(0);
    });
  });

  it('has no "Manage history" link: Maison has no page for it', () => {
    renderInTheme(sidebar());
    expect(screen.queryByText(/manage history/i)).toBeNull();
    expect(within(root()).queryByRole('link')).toBeNull();
  });

  it('draws in the dark theme too', () => {
    renderInTheme(sidebar(), { dark: true });
    expect(screen.getByRole('button', { name: 'Any complaints this week?' })).toBeTruthy();
  });
});
