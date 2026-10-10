import { describe, expect, it } from 'vitest';
import { parseChatText } from './chat-text';

const plain = (text: string) => ({ text, bold: false });
const bold = (text: string) => ({ text, bold: true });

describe('parseChatText', () => {
  it('keeps plain text as a paragraph, trimmed', () => {
    expect(parseChatText('  The Weekender 50 is in stock.  ')).toEqual([{ kind: 'paragraph', lines: [[plain('The Weekender 50 is in stock.')]] }]);
  });

  it('returns nothing for empty or blank text', () => {
    expect(parseChatText('')).toEqual([]);
    expect(parseChatText('  \n \n\t')).toEqual([]);
  });

  it('marks **bold** and leaves the text around it', () => {
    expect(parseChatText('Try the **Weekender 50** - ¥385,000')).toEqual([
      { kind: 'paragraph', lines: [[plain('Try the '), bold('Weekender 50'), plain(' - ¥385,000')]] },
    ]);
    expect(parseChatText('**Garment Carrier** and **Watch Roll Trois**')).toEqual([
      { kind: 'paragraph', lines: [[bold('Garment Carrier'), plain(' and '), bold('Watch Roll Trois')]] },
    ]);
    expect(parseChatText('**Note:**')).toEqual([{ kind: 'paragraph', lines: [[bold('Note:')]] }]);
  });

  it("leaves ** alone when it doesn't close, or has a space inside it", () => {
    for (const text of ['**unclosed', 'a ** b ** c', '2 ** 3', '****', 'a** b**']) {
      expect(parseChatText(text), text).toEqual([{ kind: 'paragraph', lines: [[plain(text)]] }]);
    }
  });

  it('keeps single line breaks inside a paragraph, and starts a new paragraph at a blank line', () => {
    expect(parseChatText('Two seats left.\nShall I request it?\n\nThe boutique will confirm on LINE.')).toEqual([
      { kind: 'paragraph', lines: [[plain('Two seats left.')], [plain('Shall I request it?')]] },
      { kind: 'paragraph', lines: [[plain('The boutique will confirm on LINE.')]] },
    ]);
    expect(parseChatText('one\r\ntwo\r\n\r\nthree')).toEqual([
      { kind: 'paragraph', lines: [[plain('one')], [plain('two')]] },
      { kind: 'paragraph', lines: [[plain('three')]] },
    ]);
  });

  it('reads numbered lines as an ordered list that starts at its first number', () => {
    expect(parseChatText('1. First\n2. Second\n3) Third')).toEqual([
      { kind: 'ordered', start: 1, items: [[[plain('First')]], [[plain('Second')]], [[plain('Third')]]] },
    ]);
    expect(parseChatText('3. Third\n4. Fourth')).toEqual([{ kind: 'ordered', start: 3, items: [[[plain('Third')]], [[plain('Fourth')]]] }]);
  });

  it('reads -, * and • lines as a bulleted list', () => {
    expect(parseChatText('- One\n* Two\n•  Three')).toEqual([{ kind: 'bullets', items: [[[plain('One')]], [[plain('Two')]], [[plain('Three')]]] }]);
  });

  it("doesn't take a line that starts with **bold**, or a number that isn't a list marker, for a list", () => {
    expect(parseChatText('**Note:** keep it dry')).toEqual([{ kind: 'paragraph', lines: [[bold('Note:'), plain(' keep it dry')]] }]);
    for (const text of ['1.5 million yen', '2026-10-03 is a Saturday', '-5 degrees', '1.', '- ']) {
      expect(parseChatText(text)[0]?.kind, text).toBe('paragraph');
    }
  });

  it('keeps bold inside a list item', () => {
    expect(parseChatText('1. **Weekender 50** - ¥385,000')).toEqual([
      { kind: 'ordered', start: 1, items: [[[bold('Weekender 50'), plain(' - ¥385,000')]]] },
    ]);
  });

  it('finds a list between paragraphs, as the model writes one', () => {
    const reply = [
      'Here are three travel-themed gift options under ¥400,000 available in Ginza:',
      '1. **Weekender 50** - ¥385,000',
      '2. **Garment Carrier** - ¥248,000',
      '3. **Watch Roll Trois** - ¥98,000',
      '',
      'Would you like to request a visit?',
    ].join('\n');
    expect(parseChatText(reply)).toEqual([
      { kind: 'paragraph', lines: [[plain('Here are three travel-themed gift options under ¥400,000 available in Ginza:')]] },
      {
        kind: 'ordered',
        start: 1,
        items: [
          [[bold('Weekender 50'), plain(' - ¥385,000')]],
          [[bold('Garment Carrier'), plain(' - ¥248,000')]],
          [[bold('Watch Roll Trois'), plain(' - ¥98,000')]],
        ],
      },
      { kind: 'paragraph', lines: [[plain('Would you like to request a visit?')]] },
    ]);
  });

  it('joins an indented line to the item above it', () => {
    expect(parseChatText('1. **Weekender 50**\n   A roomy weekend bag.\n2. **Cabin Case**')).toEqual([
      { kind: 'ordered', start: 1, items: [[[bold('Weekender 50')], [plain('A roomy weekend bag.')]], [[bold('Cabin Case')]]] },
    ]);
  });

  it('ends a list at an unindented line, and starts another when the kind changes', () => {
    expect(parseChatText('- a\nBack to text')).toEqual([
      { kind: 'bullets', items: [[[plain('a')]]] },
      { kind: 'paragraph', lines: [[plain('Back to text')]] },
    ]);
    expect(parseChatText('1. a\n- b')).toEqual([
      { kind: 'ordered', start: 1, items: [[[plain('a')]]] },
      { kind: 'bullets', items: [[[plain('b')]]] },
    ]);
    // A blank line between numbered items starts a new list that carries on from its own number.
    expect(parseChatText('1. a\n\n2. b')).toEqual([
      { kind: 'ordered', start: 1, items: [[[plain('a')]]] },
      { kind: 'ordered', start: 2, items: [[[plain('b')]]] },
    ]);
  });

  it('interprets nothing else: markup, links, headings, code and italics stay as the text they are', () => {
    for (const text of ['<script>alert(1)</script>', '<b>x</b>', '[a link](javascript:alert(1))', '# A heading', '`code`', '*italic* and _italic_', '![image](http://x/y.png)']) {
      expect(parseChatText(text), text).toEqual([{ kind: 'paragraph', lines: [[plain(text)]] }]);
    }
  });
});
