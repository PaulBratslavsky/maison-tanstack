// @vitest-environment jsdom
import { darkTheme, lightTheme } from '@strapi/design-system';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CollapseIcon, ExpandIcon, HistoryIcon, NewChatIcon, ToolsIcon, TopBarIcon } from '../../admin/src/components/assistant/TopBarIcon';
import { declarationsOf } from './css';
import { renderInTheme } from './render';

/** The CSS styled-components wrote for an element: every rule in the document that starts with one of its classes. */
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

describe('TopBarIcon', () => {
  it('is a button named by its label, which is also its tooltip text', () => {
    renderInTheme(
      <TopBarIcon label="Tools (7)" onClick={() => {}}>
        <ToolsIcon />
      </TopBarIcon>
    );
    const button = screen.getByRole('button', { name: 'Tools (7)' });
    expect(button.getAttribute('data-tip')).toBe('Tools (7)');
    expect(button.getAttribute('type')).toBe('button');
  });

  it('calls onClick when pressed, and not when it is disabled', async () => {
    const onClick = vi.fn();
    renderInTheme(
      <>
        <TopBarIcon label="Open" onClick={onClick}>
          <HistoryIcon />
        </TopBarIcon>
        <TopBarIcon label="Off" disabled onClick={onClick}>
          <NewChatIcon />
        </TopBarIcon>
      </>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onClick).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Off' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'Off' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says whether it is open with aria-expanded, for a button that opens something, and says nothing for any other', () => {
    renderInTheme(
      <>
        <TopBarIcon label="Closed" expanded={false} onClick={() => {}}>
          <ToolsIcon />
        </TopBarIcon>
        <TopBarIcon label="Opened" expanded onClick={() => {}}>
          <ToolsIcon />
        </TopBarIcon>
        <TopBarIcon label="Plain" onClick={() => {}}>
          <ToolsIcon />
        </TopBarIcon>
      </>
    );
    expect(screen.getByRole('button', { name: 'Closed' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Opened' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Plain' }).hasAttribute('aria-expanded')).toBe(false);
  });

  it('shows the words of its emphasis after the icon, and keeps its label as the accessible name', () => {
    renderInTheme(
      <TopBarIcon label="New chat" emphasis="New chat" onClick={() => {}}>
        <NewChatIcon />
      </TopBarIcon>
    );
    const button = screen.getByRole('button', { name: 'New chat' });
    expect(button.textContent).toBe('New chat');
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('has the emphasised button in the primary colour, with white words, in both themes, and the plain one on the neutral fill', () => {
    for (const [dark, theme] of [[false, lightTheme], [true, darkTheme]] as const) {
      const { unmount } = renderInTheme(
        <>
          <TopBarIcon label="Emphasised" emphasis="New chat" onClick={() => {}}>
            <NewChatIcon />
          </TopBarIcon>
          <TopBarIcon label="Plain" onClick={() => {}}>
            <NewChatIcon />
          </TopBarIcon>
        </>,
        { dark }
      );
      expect(declarationsOf(screen.getByRole('button', { name: 'Emphasised' })), String(dark)).toMatchObject({
        background: theme.colors.primary600,
        'border-color': theme.colors.primary600,
        color: theme.colors.neutral0,
      });
      expect(declarationsOf(screen.getByRole('button', { name: 'Plain' })).background, String(dark)).toBe(theme.colors.neutral0);
      unmount();
    }
  });

  it('shows no words without an emphasis: the icon alone', () => {
    renderInTheme(
      <TopBarIcon label="New chat" onClick={() => {}}>
        <NewChatIcon />
      </TopBarIcon>
    );
    expect(screen.getByRole('button', { name: 'New chat' }).textContent).toBe('');
  });

  it('draws in the dark theme too', () => {
    renderInTheme(
      <TopBarIcon label="Open" active onClick={() => {}}>
        <HistoryIcon />
      </TopBarIcon>,
      { dark: true }
    );
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('has five icons, each an SVG that screen readers skip: the button already has its name', () => {
    renderInTheme(
      <>
        <HistoryIcon />
        <ToolsIcon />
        <NewChatIcon />
        <ExpandIcon />
        <CollapseIcon />
      </>
    );
    const icons = document.querySelectorAll('svg');
    expect(icons).toHaveLength(5);
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  // The drawer's last button, Close, is at the edge of the screen. A label centred under it would be cut off by the edge.
  describe('the tooltip', () => {
    it('is centred under the button, as the reference plugin draws it', () => {
      renderInTheme(
        <TopBarIcon label="History" onClick={() => {}}>
          <HistoryIcon />
        </TopBarIcon>
      );
      const css = cssOf(screen.getByRole('button', { name: 'History' }));
      expect(css).toMatch(/::after\{[^}]*left:50%;/);
      expect(css).toMatch(/::after\{[^}]*transform:translateX\(-50%\);/);
    });

    it('ends at the right edge of the button when asked, so a button at the edge of the screen keeps its label on the screen', () => {
      renderInTheme(
        <TopBarIcon label="Close the assistant" tipAlign="end" onClick={() => {}}>
          <HistoryIcon />
        </TopBarIcon>
      );
      const css = cssOf(screen.getByRole('button', { name: 'Close the assistant' }));
      expect(css).toMatch(/::after\{[^}]*right:0;/);
      expect(css).not.toMatch(/::after\{[^}]*left:50%;/);
      expect(css).not.toMatch(/::after\{[^}]*translateX/);
    });
  });
});
