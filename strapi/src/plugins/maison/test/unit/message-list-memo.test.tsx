// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from '../../admin/src/components/assistant/MessageList';
import { renderInTheme } from './render';

/*
 * react-markdown is wrapped so each call is recorded with the text it was given. The wrapper still draws what react-markdown draws. The test
 * counts the draws of one answer's text, which does not depend on how many other things the list draws.
 */
const drawn = vi.hoisted(() => [] as string[]);
vi.mock('react-markdown', async (importOriginal) => {
  const original = (await importOriginal()) as { default: Parameters<typeof createElement>[0] };
  return {
    ...original,
    default: (props: { children?: string }) => {
      drawn.push(String(props.children));
      return createElement(original.default, props);
    },
  };
});

const staff = (id: string, content: string) => ({ id, role: 'user', parts: [{ type: 'text', content }] }) as never;
const assistant = (id: string, content: string) => ({ id, role: 'assistant', parts: [{ type: 'text', content }] }) as never;
beforeEach(() => {
  drawn.length = 0;
});

const timesDrawn = (content: string) => drawn.filter((text) => text === content).length;

describe('the message list while an answer streams in', () => {
  it('does not draw an answer again when another message changes: only the message that changed is drawn again', () => {
    const question = staff('u1', 'Which visits are waiting?');
    const earlier = assistant('a1', 'Two visits wait.');
    const { rerender } = renderInTheme(<MessageList messages={[question, earlier, assistant('a2', 'Three')]} busy />);
    expect(timesDrawn('Two visits wait.')).toBe(1);
    expect(timesDrawn('Three')).toBe(1);

    // The chat library keeps the messages that did not change and replaces the one that did.
    rerender(<MessageList messages={[question, earlier, assistant('a2', 'Three complaints')]} busy />);

    expect(screen.getByText('Three complaints')).toBeTruthy();
    expect(timesDrawn('Three complaints')).toBe(1);
    expect(timesDrawn('Two visits wait.')).toBe(1);
  });

  // The row's memo cannot help here, because the message objects are new. Only the memo of `MarkdownBody`, which compares the text, stops the parse.
  it('does not parse an answer again when its message is replaced by an equal one: the text did not change', () => {
    const { rerender } = renderInTheme(<MessageList messages={[staff('u1', 'Which visits are waiting?'), assistant('a1', 'Two visits wait.')]} busy />);
    expect(timesDrawn('Two visits wait.')).toBe(1);

    rerender(<MessageList messages={[staff('u1', 'Which visits are waiting?'), assistant('a1', 'Two visits wait.')]} busy />);

    expect(screen.getByText('Two visits wait.')).toBeTruthy();
    expect(timesDrawn('Two visits wait.')).toBe(1);
  });

  it('draws an answer again when its own message changes', () => {
    const { rerender } = renderInTheme(<MessageList messages={[assistant('a1', 'Two')]} busy />);
    rerender(<MessageList messages={[assistant('a1', 'Two visits')]} busy />);
    expect(timesDrawn('Two')).toBe(1);
    expect(timesDrawn('Two visits')).toBe(1);
    expect(screen.getByText('Two visits')).toBeTruthy();
  });
});
