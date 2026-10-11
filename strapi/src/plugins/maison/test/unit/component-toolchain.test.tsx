// @vitest-environment jsdom
import { Button } from '@strapi/design-system';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme } from 'styled-components';
import { describe, expect, it, vi } from 'vitest';
import { renderInTheme } from './render';

/**
 * These hold the toolchain the component tests stand on, so a broken install or config fails here, with a clear name, and not in
 * the middle of a component's own test: the design system inside its provider, user events, and react-markdown with remark-gfm.
 */

const Scheme = () => <span data-testid="scheme">{useTheme().colorScheme}</span>;

describe('the component tests', () => {
  it('render a design system component inside the provider, and a click reaches it', async () => {
    const onClick = vi.fn();
    renderInTheme(<Button onClick={onClick}>Send</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('render in the light theme, and in the dark theme when asked', () => {
    renderInTheme(<Scheme />);
    expect(screen.getByTestId('scheme').textContent).toBe('light');
    renderInTheme(<Scheme />, { dark: true });
    expect(screen.getAllByTestId('scheme').at(-1)?.textContent).toBe('dark');
  });

  it('clean up after each test: the first test left nothing in the document', () => {
    expect(document.body.textContent).toBe('');
  });

  it('draw a Markdown table with react-markdown and remark-gfm', () => {
    renderInTheme(<Markdown remarkPlugins={[remarkGfm]}>{'| Reference | Status |\n| --- | --- |\n| APT-4821 | requested |'}</Markdown>);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'APT-4821' })).toBeTruthy();
  });
});
