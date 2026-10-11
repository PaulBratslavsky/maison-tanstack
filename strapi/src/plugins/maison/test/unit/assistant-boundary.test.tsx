// @vitest-environment jsdom
import { lightTheme } from '@strapi/design-system';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantBoundary, ASSISTANT_FAILED_TEXT } from '../../admin/src/components/assistant/AssistantBoundary';
import { renderInTheme } from './render';

/*
 * A failure inside the assistant's host: the chat throws while drawing, or its chunk fails to load. The launcher has to stay, staff read one
 * fixed text, and the error goes to `console.error`. The chat's module is replaced here, so a test chooses how it fails.
 */
const failure = vi.hoisted(() => ({ mode: 'none' as 'none' | 'import' | 'render' }));
vi.mock('../../admin/src/components/assistant/GlobalAssistant', () => {
  if (failure.mode === 'import') throw new Error('Loading chunk 42 failed.');
  return {
    GlobalAssistant: () => {
      if (failure.mode === 'render') throw new Error('The chat could not be drawn.');
      return <p>The chat</p>;
    },
  };
});

/** The text staff read. The design system's provider has live regions with the role alert of their own, so the text is looked for, not the role. */
const SHOWN = 'The assistant could not load. Reload the page to try again.';
const OPEN = { name: 'Open the Maison assistant' };
let logged: ReturnType<typeof vi.spyOn>;
/** jsdom prints a thrown error as "Uncaught" with its stack unless a listener cancels the error event. The errors here are expected. */
const keepQuiet = (event: Event) => event.preventDefault();

beforeEach(() => {
  vi.resetModules();
  // React also writes a thrown error to the console. The tests read what was written, so it is kept quiet and recorded.
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  window.addEventListener('error', keepQuiet);
});
afterEach(async () => {
  cleanup();
  window.removeEventListener('error', keepQuiet);
  const { destroyHost } = await import('../../admin/src/components/assistant/assistantHost');
  destroyHost();
  failure.mode = 'none';
  vi.restoreAllMocks();
});

const hostWith = async (mode: typeof failure.mode) => {
  failure.mode = mode;
  const host = await import('../../admin/src/components/assistant/assistantHost');
  host.attachHost();
  act(() => host.updateHost({ allowed: true, theme: lightTheme, locale: 'en' }));
};
const ours = () => logged.mock.calls.filter(([first]) => String(first).startsWith('The Maison assistant failed'));

describe('when the assistant fails inside the host', () => {
  it.each([
    ['its chunk fails to load', 'import' as const, 'Loading chunk 42 failed.'],
    ['the chat throws while drawing', 'render' as const, 'The chat could not be drawn.'],
  ])('keeps the launcher, shows the fixed text, and logs the error, when %s', async (_name, mode, message) => {
    await hostWith(mode);

    const launcher = await screen.findByRole('button', OPEN);
    expect(screen.queryByText('The chat')).toBeNull();
    expect(screen.queryByText(SHOWN)).toBeNull();

    await userEvent.click(launcher);
    expect(screen.getByText(SHOWN).closest('[role="alert"]')).not.toBeNull();
    expect(ours()).toHaveLength(1);
    // Vitest wraps an error thrown by a mock factory and keeps the first one as `cause`.
    const error = ours()[0][1] as Error & { cause?: Error };
    expect(`${error.message} ${error.cause?.message ?? ''}`).toContain(message);
  });

  it('hides the text when the launcher is pressed again', async () => {
    await hostWith('render');
    const launcher = await screen.findByRole('button', OPEN);
    await userEvent.click(launcher);
    await userEvent.click(launcher);
    expect(screen.queryByText(SHOWN)).toBeNull();
  });

  it('does nothing while the chat works: the chat is drawn and no text is shown', async () => {
    await hostWith('none');
    expect(await screen.findByText('The chat')).toBeTruthy();
    expect(screen.queryByText(SHOWN)).toBeNull();
    expect(ours()).toHaveLength(0);
  });
});

describe('the boundary', () => {
  it('has one text for every failure, in plain English', () => {
    expect(ASSISTANT_FAILED_TEXT).toBe('The assistant could not load. Reload the page to try again.');
    expect(ASSISTANT_FAILED_TEXT).not.toMatch(/[\u2013\u2014]/);
  });

  it('draws what it is given when nothing throws', () => {
    renderInTheme(
      <AssistantBoundary>
        <p>Fine</p>
      </AssistantBoundary>
    );
    expect(screen.getByText('Fine')).toBeTruthy();
    expect(screen.queryByRole('button', OPEN)).toBeNull();
  });
});
