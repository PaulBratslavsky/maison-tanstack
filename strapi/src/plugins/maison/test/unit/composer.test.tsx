// @vitest-environment jsdom
import { createRef } from 'react';

import { lightTheme } from '@strapi/design-system';
import { Cross, Sparkle } from '@strapi/icons';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '../../admin/src/components/assistant/Composer';
import { declarationsOf } from './css';
import { renderInTheme } from './render';

const composer = (props: Partial<Parameters<typeof Composer>[0]> = {}) => (
  <Composer draft="Which visits are waiting?" onDraft={() => {}} busy={false} ready onSend={() => {}} onStop={() => {}} textareaRef={createRef<HTMLTextAreaElement>()} {...props} />
);
const box = () => screen.getByRole('textbox', { name: 'Chat message' }) as HTMLTextAreaElement;
const send = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
const stop = () => screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
/** The markup of an icon, to tell which icon a button holds. */
const markupOf = (icon: ReturnType<typeof Sparkle>) => {
  const { container, unmount } = renderInTheme(icon);
  const markup = container.querySelector('svg')?.innerHTML;
  unmount();
  return markup;
};

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

describe('the text box', () => {
  it('is a multi-line box named "Chat message", with the placeholder "Type your message...", one row tall at first', () => {
    renderInTheme(composer({ draft: '' }));
    expect(box().tagName).toBe('TEXTAREA');
    expect(box().getAttribute('placeholder')).toBe('Type your message...');
    expect(box().getAttribute('rows')).toBe('1');
  });

  it('shows the draft, and tells the page what staff type', async () => {
    const onDraft = vi.fn();
    renderInTheme(composer({ draft: '', onDraft }));
    await userEvent.type(box(), 'Hi');
    expect(onDraft).toHaveBeenCalledTimes(2);
    expect(onDraft.mock.calls.map(([value]) => value)).toEqual(['H', 'i']);
    expect(box().value).toBe('');
  });

  it('is the element the page is given, so it can put the focus back after a send', () => {
    const textareaRef = createRef<HTMLTextAreaElement>();
    renderInTheme(composer({ textareaRef }));
    expect(textareaRef.current).toBe(box());
  });

  it('stays usable while an answer comes: only Send waits', () => {
    renderInTheme(composer({ busy: true }));
    expect(box().disabled).toBe(false);
  });

  // A textarea scrolls by itself once its content is taller than its box, so the cap is the whole rule: one line at least, six at most.
  it('is one line tall at least and six lines tall at most, and stays that size: the staff cannot drag it', () => {
    renderInTheme(composer({ draft: '' }));
    const css = cssOf(box());
    expect(css).toContain('min-height:4rem');
    expect(css).toContain('max-height:13.6rem');
    expect(css).toContain('resize:none');
  });

  it('grows with what is typed: its height follows its content', () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => 88 });
    try {
      const view = renderInTheme(composer({ draft: '' }));
      expect(box().style.height).toBe('88px');
      view.rerender(composer({ draft: 'one\ntwo\nthree\nfour' }));
      expect(box().style.height).toBe('88px');
    } finally {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  // A text box does not measure itself again when its width changes (Expand, Collapse, a window resize), and the same text takes more or fewer lines.
  it('measures its height again when its width changes, with the same text', () => {
    let height = 88;
    let widthChanged: (width: number) => void = () => {};
    class FakeResizeObserver {
      constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
        widthChanged = (width) => callback([{ contentRect: { width } }]);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => height });
    try {
      renderInTheme(composer({ draft: 'one two three four five six seven' }));
      act(() => widthChanged(500));
      expect(box().style.height).toBe('88px');

      height = 44;
      act(() => widthChanged(860));
      expect(box().style.height).toBe('44px');

      height = 66;
      act(() => widthChanged(560));
      expect(box().style.height).toBe('66px');
    } finally {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
      vi.unstubAllGlobals();
    }
  });

  it('leaves its height alone when the observer reports the same width again, which is what its own height change causes', () => {
    let height = 88;
    let widthChanged: (width: number) => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
          widthChanged = (width) => callback([{ contentRect: { width } }]);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => height });
    try {
      renderInTheme(composer({ draft: 'one two three' }));
      act(() => widthChanged(500));
      height = 44;
      act(() => widthChanged(500));
      expect(box().style.height).toBe('88px');
    } finally {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
      vi.unstubAllGlobals();
    }
  });
});

describe('Enter', () => {
  it('sends the draft', () => {
    const onSend = vi.fn();
    renderInTheme(composer({ onSend }));
    expect(fireEvent.keyDown(box(), { key: 'Enter', keyCode: 13 })).toBe(false);
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Which visits are waiting?');
  });

  it('adds a line break and sends nothing with Shift', () => {
    const onSend = vi.fn();
    renderInTheme(composer({ onSend }));
    expect(fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });

  // Staff typing Japanese press Enter to confirm a conversion. That Enter belongs to the input method.
  it('sends nothing while an input method composes: the Enter that confirms a conversion is not a send', () => {
    const onSend = vi.fn();
    renderInTheme(composer({ onSend }));
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends nothing for keyCode 229, which Safari reports for the Enter that ends a composition after it has stopped composing', () => {
    const onSend = vi.fn();
    renderInTheme(composer({ onSend }));
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: false, keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends nothing for any other key', () => {
    const onSend = vi.fn();
    renderInTheme(composer({ onSend }));
    for (const key of ['a', ' ', 'Tab', 'Escape', 'ArrowUp']) fireEvent.keyDown(box(), { key });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('adds no line break when there is nothing to send: an empty box, a box with only spaces, or an answer on its way', () => {
    const onSend = vi.fn();
    for (const props of [{ draft: '' }, { draft: '  \n ' }, { busy: true }, { ready: false }]) {
      const { unmount } = renderInTheme(composer({ onSend, ...props }));
      expect(fireEvent.keyDown(box(), { key: 'Enter' }), JSON.stringify(props)).toBe(false);
      unmount();
    }
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('Send', () => {
  it('is a button that sends the draft', async () => {
    const onSend = vi.fn();
    renderInTheme(composer({ onSend }));
    await userEvent.click(send());
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Which visits are waiting?');
  });

  it.each([
    ['the box is empty', { draft: '' }],
    ['the box has only spaces', { draft: '   ' }],
    ['an answer is on its way', { busy: true }],
    ['the assistant is not ready', { ready: false }],
  ])('is switched off, and sends nothing, when %s', async (_why, props) => {
    const onSend = vi.fn();
    renderInTheme(composer({ onSend, ...props }));
    expect(send().disabled).toBe(true);
    await userEvent.click(send());
    expect(onSend).not.toHaveBeenCalled();
  });

  it('has no Stop while nothing is answering', () => {
    renderInTheme(composer());
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

describe('Stop', () => {
  it('shows beside Send while an answer comes, and stops it', async () => {
    const onStop = vi.fn();
    const onSend = vi.fn();
    renderInTheme(composer({ busy: true, onStop, onSend }));
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    expect(Boolean(send().compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    await userEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
    // Inside the form a submit button would send the draft instead of stopping the answer.
    expect(stop.getAttribute('type')).toBe('button');
    expect(onSend).not.toHaveBeenCalled();
  });

  // A double click on Send: the second click must land on a button that does nothing, never on Stop.
  it('is not where Send was: a second click on Send, as in a double click, stops nothing', async () => {
    const onStop = vi.fn();
    const onSend = vi.fn();
    const view = renderInTheme(composer({ onStop, onSend }));
    await userEvent.click(send());
    view.rerender(composer({ busy: true, onStop, onSend }));
    await userEvent.click(send());
    expect(onSend).toHaveBeenCalledOnce();
    expect(onStop).not.toHaveBeenCalled();
  });
});

// How the buttons and the row look, held by what the component asked of the design system: the size, the look, the icon and the line on top.
describe('the look of the composer', () => {
  it('has Send at size L, in the primary colour, with the Sparkle icon and one icon only', () => {
    renderInTheme(composer({ busy: true }));
    // Size L is 4.8rem tall. Size S, the next one down, is 4rem.
    expect(declarationsOf(send()).height).toBe('4.8rem');
    expect(declarationsOf(send()).background).toBe(lightTheme.colors.primary600);
    expect(send().querySelectorAll('svg')).toHaveLength(1);
    expect(send().querySelector('svg')?.innerHTML).toBe(markupOf(<Sparkle />));
  });

  it('has Stop at size L, in the danger-light look, with the Cross icon and one icon only', () => {
    renderInTheme(composer({ busy: true }));
    expect(declarationsOf(stop()).height).toBe('4.8rem');
    expect(declarationsOf(stop())).toMatchObject({
      background: lightTheme.colors.danger100,
      border: `1px solid ${lightTheme.colors.danger200}`,
      color: lightTheme.colors.danger700,
    });
    expect(stop().querySelectorAll('svg')).toHaveLength(1);
    expect(stop().querySelector('svg')?.innerHTML).toBe(markupOf(<Cross />));
    expect(markupOf(<Cross />)).not.toBe(markupOf(<Sparkle />));
  });

  it('has a line on top of the row, in the theme colour, that holds the text box and the buttons', () => {
    renderInTheme(composer({ busy: true }));
    const row = box().closest('form')?.firstElementChild as HTMLElement;
    expect(row.contains(send())).toBe(true);
    expect(declarationsOf(row)['border-top']).toBe(`1px solid ${lightTheme.colors.neutral200}`);
    expect(declarationsOf(row).padding).toBe('16px');
  });
});
