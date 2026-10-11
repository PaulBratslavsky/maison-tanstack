// @vitest-environment jsdom
import { darkTheme, lightTheme } from '@strapi/design-system';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Launcher } from '../../admin/src/components/assistant/Launcher';
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

const button = () => screen.getByRole('button', { name: 'Open the Maison assistant' });

describe('Launcher', () => {
  it('is a button named "Open the Maison assistant", which says it opens something that is closed', () => {
    renderInTheme(<Launcher open={false} onOpen={() => {}} />);
    expect(button().getAttribute('type')).toBe('button');
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the drawer when it is pressed, by mouse and by keyboard', async () => {
    const onOpen = vi.fn();
    renderInTheme(<Launcher open={false} onOpen={onOpen} />);
    await userEvent.click(button());
    expect(onOpen).toHaveBeenCalledTimes(1);
    button().focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('is not on the screen while the drawer is open', () => {
    renderInTheme(<Launcher open onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Open the Maison assistant' })).toBeNull();
    expect(document.querySelector('button')).toBeNull();
  });

  it('is a round button 56px across, fixed 24px from the bottom and right edges of the window', () => {
    renderInTheme(<Launcher open={false} onOpen={() => {}} />);
    const css = cssOf(button());
    expect(css).toMatch(/[{;]position:fixed;/);
    expect(css).toMatch(/[{;]right:24px;/);
    expect(css).toMatch(/[{;]bottom:24px;/);
    expect(css).toMatch(/[{;]width:56px;/);
    expect(css).toMatch(/[{;]height:56px;/);
    expect(css).toMatch(/[{;]border-radius:50%;/);
  });

  it('is the primary colour, with the Sparkle icon in the colour the primary button writes its text in, and a shadow from the theme', () => {
    renderInTheme(<Launcher open={false} onOpen={() => {}} />);
    const css = cssOf(button());
    expect(css).toContain(`background:${lightTheme.colors.primary600};`);
    expect(css).toMatch(new RegExp(`svg\\{[^}]*fill:${lightTheme.colors.neutral0};`));
    expect(css).toContain(`box-shadow:${lightTheme.shadows.popupShadow};`);
    expect(button().querySelector('svg')).not.toBeNull();
  });

  it('takes its colours and its shadow from the dark theme in the dark theme', () => {
    renderInTheme(<Launcher open={false} onOpen={() => {}} />, { dark: true });
    const css = cssOf(button());
    expect(css).toContain(`background:${darkTheme.colors.primary600};`);
    expect(css).toMatch(new RegExp(`svg\\{[^}]*fill:${darkTheme.colors.neutral0};`));
    expect(css).toContain(`box-shadow:${darkTheme.shadows.popupShadow};`);
  });

  it('sits on the assistant layer: above the left menu and below the dialogs, so Reply on LINE opens above it', () => {
    renderInTheme(<Launcher open={false} onOpen={() => {}} />);
    expect(cssOf(button())).toMatch(/[{;]z-index:299;/);
  });

  it('sets its button on the ref, so the drawer can give it the focus back when it closes', () => {
    const ref = createRef<HTMLButtonElement>();
    renderInTheme(<Launcher ref={ref} open={false} onOpen={() => {}} />);
    expect(ref.current).toBe(button());
  });
});
