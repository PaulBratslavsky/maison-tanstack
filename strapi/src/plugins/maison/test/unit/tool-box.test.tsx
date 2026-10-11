// @vitest-environment jsdom
import { darkTheme, lightTheme } from '@strapi/design-system';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { toolBoxOf, type PartLike, type ToolBoxModel } from '../../admin/src/assistant';
import { ToolBox } from '../../admin/src/components/assistant/ToolBox';
import { renderInTheme } from './render';

const call = (name: string, fields: Partial<PartLike> = {}): PartLike => ({ type: 'tool-call', id: 'call-1', name, arguments: '{}', state: 'complete', ...fields });
const boxOf = (part: PartLike, result?: PartLike): ToolBoxModel => toolBoxOf(part, result) as ToolBoxModel;

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

const DONE = boxOf(
  call('list_inquiries', {
    output: { inquiries: [{ documentId: 'k1', customer: 'line:U4af…88', message: '<customer_message>The clasp broke.</customer_message>' }, { documentId: 'k2' }, { documentId: 'k3' }], capped: false },
  })
);
const RUNNING = boxOf(call('list_requests', { state: 'input-complete' }));
const FAILED = boxOf(call('list_requests', { output: { error: { code: 'not_found', message: 'No request APT-4812.', hint: 'Check the reference.' } } }));

const frameOf = (container: HTMLElement) => container.querySelector('[data-message-part="tool"]') as HTMLElement;

describe('ToolBox', () => {
  it('is closed at first, with a header that names the tool and says how many results it gave', () => {
    renderInTheme(<ToolBox box={DONE} />);
    const header = screen.getByRole('button', { name: /Tool: list_inquiries/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.textContent).toContain('Tool: list_inquiries');
    expect(header.textContent).toContain('3 results');
    expect(document.querySelector('pre')).toBeNull();
  });

  it('opens to the result as indented JSON with the customer-text tags taken out, and closes again', async () => {
    renderInTheme(<ToolBox box={DONE} />);
    const header = screen.getByRole('button', { name: /Tool: list_inquiries/ });

    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    const body = document.querySelector('pre') as HTMLElement;
    expect(body.textContent).toContain('"message": "The clasp broke."');
    expect(body.textContent).toContain('"customer": "line:U4af…88"');
    expect(body.textContent).not.toContain('customer_message');
    expect(body.textContent?.startsWith('{\n  "inquiries": [')).toBe(true);

    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('pre')).toBeNull();
  });

  it('turns the arrow with the box, and hides it from screen readers', async () => {
    renderInTheme(<ToolBox box={DONE} />);
    const arrow = () => document.querySelector('button span[aria-hidden="true"]') as HTMLElement;
    expect(arrow().textContent).toBe('▶');
    await userEvent.click(screen.getByRole('button', { name: /Tool: list_inquiries/ }));
    expect(arrow().textContent).toBe('▼');
  });

  it('shows a spinner while the call runs, with no count, and the wait when it is opened', async () => {
    renderInTheme(<ToolBox box={RUNNING} />);
    expect(screen.getByRole('progressbar', { name: 'running' })).toBeTruthy();
    const header = screen.getByRole('button', { name: /Tool: list_requests/ });
    expect(header.textContent).not.toMatch(/result|done|failed/);
    await userEvent.click(header);
    expect(document.querySelector('pre')?.textContent).toBe('Waiting for result...');
  });

  it('says "done" for a call that gave nothing to count', () => {
    renderInTheme(<ToolBox box={boxOf(call('inquiry_counts', { output: { needsAnswer: 4 } }))} />);
    expect(screen.getByRole('button', { name: /Tool: inquiry_counts/ }).textContent).toContain('done');
  });

  describe('a failed call', () => {
    it('says "failed" in the header and shows the tool\'s own message when it is opened', async () => {
      renderInTheme(<ToolBox box={FAILED} />);
      const header = screen.getByRole('button', { name: /Tool: list_requests/ });
      expect(header.textContent).toContain('failed');
      await userEvent.click(header);
      expect(document.querySelector('pre')?.textContent).toBe('No request APT-4812.');
    });

    it('is marked: a danger border and the word "failed" in the danger colour, where a finished box has neither', () => {
      const failed = renderInTheme(<ToolBox box={FAILED} />);
      const failedFrame = frameOf(failed.container);
      expect(failedFrame.getAttribute('data-state')).toBe('failed');
      expect(cssOf(failedFrame)).toContain(`border:1px solid ${lightTheme.colors.danger200}`);
      expect(cssOf(screen.getByText('failed'))).toContain(`color:${lightTheme.colors.danger600}`);
      failed.unmount();

      const done = renderInTheme(<ToolBox box={DONE} />);
      const doneFrame = frameOf(done.container);
      expect(doneFrame.getAttribute('data-state')).toBe('done');
      expect(cssOf(doneFrame)).toContain(`border:1px solid ${lightTheme.colors.neutral200}`);
      expect(cssOf(doneFrame)).not.toContain(lightTheme.colors.danger200);
      expect(cssOf(screen.getByText('3 results'))).not.toContain(lightTheme.colors.danger600);
    });

    it('is marked in the dark theme with the dark theme\'s colours', () => {
      const { container } = renderInTheme(<ToolBox box={FAILED} />, { dark: true });
      expect(cssOf(frameOf(container))).toContain(`border:1px solid ${darkTheme.colors.danger200}`);
      expect(cssOf(screen.getByText('failed'))).toContain(`color:${darkTheme.colors.danger600}`);
    });
  });

  it('is marked by its state, for a check to read: running, done or failed', () => {
    for (const [box, state] of [[RUNNING, 'running'], [DONE, 'done'], [FAILED, 'failed']] as const) {
      const { container, unmount } = renderInTheme(<ToolBox box={box} />);
      expect(frameOf(container).getAttribute('data-state')).toBe(state);
      unmount();
    }
  });
});
