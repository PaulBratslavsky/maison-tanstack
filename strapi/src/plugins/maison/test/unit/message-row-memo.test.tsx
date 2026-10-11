// @vitest-environment jsdom
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from '../../admin/src/components/assistant/MessageList';
import { renderInTheme } from './render';

/*
 * `MarkdownBody` is replaced by a plain component that is not memoized and records each call with its text. A call is then a draw of the message
 * row that holds it, so the count tells whether the row's own memo stopped the row from being drawn again. The memo of `MarkdownBody` is held by
 * message-list-memo.test.tsx.
 */
const drawn = vi.hoisted(() => [] as string[]);
vi.mock('../../admin/src/components/assistant/MarkdownBody', () => ({
  MarkdownBody: (props: { text: string }) => {
    drawn.push(props.text);
    return createElement('div', null, props.text);
  },
}));

const staff = (id: string, content: string) => ({ id, role: 'user', parts: [{ type: 'text', content }] }) as never;
const assistant = (id: string, content: string) => ({ id, role: 'assistant', parts: [{ type: 'text', content }] }) as never;
beforeEach(() => {
  drawn.length = 0;
});

const timesDrawn = (content: string) => drawn.filter((text) => text === content).length;

describe('the message row', () => {
  it('is not drawn again when another message changes: the message object is the same', () => {
    const question = staff('u1', 'Which visits are waiting?');
    const earlier = assistant('a1', 'Two visits wait.');
    const { rerender } = renderInTheme(<MessageList messages={[question, earlier, assistant('a2', 'Three')]} busy />);
    expect(timesDrawn('Two visits wait.')).toBe(1);

    rerender(<MessageList messages={[question, earlier, assistant('a2', 'Three complaints')]} busy />);

    expect(timesDrawn('Three complaints')).toBe(1);
    expect(timesDrawn('Two visits wait.')).toBe(1);
  });
});
