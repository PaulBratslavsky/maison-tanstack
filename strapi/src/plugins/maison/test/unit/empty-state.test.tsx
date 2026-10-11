// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STARTERS } from '../../admin/src/assistant';
import { EmptyState } from '../../admin/src/components/assistant/EmptyState';
import { renderInTheme } from './render';

describe('EmptyState', () => {
  it('has the title and the one sentence', () => {
    renderInTheme(<EmptyState />);
    expect(screen.getByText('Ask Maison')).toBeTruthy();
    expect(screen.getByText('Ask about visit requests, customer questions and inquiries. The assistant looks things up and never sends, confirms or changes anything.')).toBeTruthy();
  });

  // The starters were here until 7 October. Paul wanted them to stay for the whole chat, so they are the quick questions above the text box now
  // (QuickQuestions.tsx), and the empty state does not repeat them.
  it('does not show the questions: they are the quick questions above the text box, which stay for the whole chat', () => {
    renderInTheme(<EmptyState />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('group')).toBeNull();
    for (const question of STARTERS) expect(screen.queryByText(question), question).toBeNull();
  });

  it('draws in the dark theme too', () => {
    renderInTheme(<EmptyState />, { dark: true });
    expect(screen.getByText('Ask Maison')).toBeTruthy();
  });
});
