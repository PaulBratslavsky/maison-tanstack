// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ModelBadge } from '../../admin/src/components/assistant/ModelBadge';
import { renderInTheme } from './render';

describe('ModelBadge', () => {
  it('names the model by its ID, as the status gave it', () => {
    renderInTheme(<ModelBadge model="claude-sonnet-5-5" />);
    expect(screen.getByText('claude-sonnet-5-5')).toBeTruthy();
  });

  it('draws the ID in capitals: the badge is the design system\'s, whose text is uppercase', () => {
    renderInTheme(<ModelBadge model="claude-sonnet-5-5" />);
    const badge = screen.getByText('claude-sonnet-5-5');
    const css = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');
    const classes = Array.from(badge.classList);
    expect(classes.some((name) => new RegExp(`\\.${name}[^{}]*\\{[^}]*text-transform:uppercase`).test(css))).toBe(true);
  });

  it('says "Model" in a tooltip when the pointer rests on it', async () => {
    renderInTheme(<ModelBadge model="claude-sonnet-5-5" />);
    await userEvent.hover(screen.getByText('claude-sonnet-5-5'));
    expect((await screen.findAllByText('Model', {}, { timeout: 3000 })).length).toBeGreaterThan(0);
  });
});
