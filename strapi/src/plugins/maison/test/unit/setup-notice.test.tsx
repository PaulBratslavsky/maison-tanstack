// @vitest-environment jsdom
import { lightTheme } from '@strapi/design-system';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBox, NoteBox } from '../../admin/src/components/assistant/ErrorBox';
import { SetupNotice } from '../../admin/src/components/assistant/SetupNotice';
import { renderInTheme } from './render';

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

describe('SetupNotice', () => {
  it('has a title, the reason and Check again', () => {
    renderInTheme(
      <SetupNotice title="The assistant isn't set up" onCheckAgain={() => {}}>
        The assistant works with Anthropic only. AI_PROVIDER is set to openai.
      </SetupNotice>
    );
    expect(screen.getByRole('heading', { level: 2, name: "The assistant isn't set up" })).toBeTruthy();
    expect(screen.getByText('The assistant works with Anthropic only. AI_PROVIDER is set to openai.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('asks again when Check again is pressed', async () => {
    const onCheckAgain = vi.fn();
    renderInTheme(<SetupNotice onCheckAgain={onCheckAgain}>No key.</SetupNotice>);
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheckAgain).toHaveBeenCalledOnce();
  });

  it('has no title when it is given none, and no empty heading', () => {
    renderInTheme(<SetupNotice onCheckAgain={() => {}}>Couldn't check the assistant.</SetupNotice>);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText("Couldn't check the assistant.")).toBeTruthy();
  });

  it('draws a failed check in the danger colour, and the other notice in grey', () => {
    const danger = renderInTheme(
      <SetupNotice tone="danger" onCheckAgain={() => {}}>
        Failed.
      </SetupNotice>
    );
    expect(cssOf(screen.getByText('Failed.'))).toContain(`color:${lightTheme.colors.danger600}`);
    danger.unmount();
    renderInTheme(<SetupNotice onCheckAgain={() => {}}>No key.</SetupNotice>);
    expect(cssOf(screen.getByText('No key.'))).toContain(`color:${lightTheme.colors.neutral600}`);
  });
});

describe('ErrorBox and NoteBox', () => {
  it('is a red alert: the danger fill and the danger text', () => {
    renderInTheme(<ErrorBox>Anthropic is busy. Try again in a minute.</ErrorBox>);
    const text = screen.getByText('Anthropic is busy. Try again in a minute.');
    const alert = text.closest('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(cssOf(alert)).toContain(`background:${lightTheme.colors.danger100}`);
    expect(cssOf(text)).toContain(`color:${lightTheme.colors.danger600}`);
    expect(text.textContent).not.toMatch(/^Error: /);
  });

  it('puts a line about how the turn ended in the same place, in grey, as a status', () => {
    renderInTheme(<NoteBox>The assistant stopped after 6 steps. Ask a narrower question.</NoteBox>);
    const text = screen.getByText('The assistant stopped after 6 steps. Ask a narrower question.');
    const status = text.closest('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(cssOf(status)).toContain(`background:${lightTheme.colors.neutral100}`);
  });
});
