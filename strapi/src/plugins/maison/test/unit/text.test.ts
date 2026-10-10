import { describe, expect, it } from 'vitest';
import { blocksToPlainText, fitLines, fitUnits, teaser } from '../../server/src/domain/text';

const blocks = [
  { type: 'heading', level: 2, children: [{ type: 'text', text: '旅のために' }] },
  { type: 'paragraph', children: [{ type: 'text', text: 'Hand-stitched ' }, { type: 'text', text: 'in Paris.', bold: true }] },
  { type: 'list', format: 'unordered', children: [
    { type: 'list-item', children: [{ type: 'text', text: 'Canvas' }] },
    { type: 'list-item', children: [{ type: 'text', text: 'Brass' }] },
  ] },
];

describe('blocksToPlainText', () => {
  it('joins blocks with blank lines and list items with newlines', () => {
    expect(blocksToPlainText(blocks)).toBe('旅のために\n\nHand-stitched in Paris.\n\nCanvas\nBrass');
  });

  it('returns an empty string for anything that is not a blocks array', () => {
    expect(blocksToPlainText(null)).toBe('');
    expect(blocksToPlainText('text')).toBe('');
  });
});

describe('teaser', () => {
  it('returns short text unchanged, with whitespace collapsed', () => {
    expect(teaser('  A   short\nstory ')).toBe('A short story');
  });

  it('cuts long text to max characters including the ellipsis', () => {
    const result = teaser('あ'.repeat(200), 160);
    expect(Array.from(result)).toHaveLength(160);
    expect(result.endsWith('…')).toBe(true);
  });
});

// Strapi's string maxLength counts UTF-16 units (JavaScript's .length), so a field that holds 100 characters
// takes 50 emoji, not 100.
describe('fitUnits', () => {
  it('returns text that fits collapsed and trimmed, uncut, counting its length after the collapse', () => {
    expect(fitUnits('  A   short\nstory ', 200)).toBe('A short story');
    expect(fitUnits('a'.repeat(200), 200)).toBe('a'.repeat(200));
    expect(fitUnits(`a${' '.repeat(300)}b`, 10)).toBe('a b');
  });

  it('cuts 201 letters to 199 and an ellipsis, which makes 200 UTF-16 units', () => {
    const result = fitUnits('a'.repeat(201), 200);
    expect(result).toBe(`${'a'.repeat(199)}…`);
    expect(result).toHaveLength(200);
  });

  it('cuts 201 Japanese characters to 199 and an ellipsis', () => {
    const result = fitUnits('あ'.repeat(201), 200);
    expect(result).toBe(`${'あ'.repeat(199)}…`);
    expect(result).toHaveLength(200);
  });

  it('cuts 100 emoji to 49 and an ellipsis, 99 units, never splitting one in half', () => {
    const result = fitUnits('😀'.repeat(100), 100);
    expect(result).toBe(`${'😀'.repeat(49)}…`);
    expect(result).toHaveLength(99);
    expect(result.length).toBeLessThanOrEqual(100);
  });
});

// A cut for text people read with its line breaks, such as what a customer wrote and what the concierge answered.
describe('fitLines', () => {
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('returns text that fits trimmed, uncut, with its line breaks and the spaces inside its lines kept', () => {
    expect(fitLines('  Care:\n\n  - wipe with a soft cloth\n- avoid   water \n', 200)).toBe('Care:\n\n  - wipe with a soft cloth\n- avoid   water');
  });

  it('does not collapse what fitUnits collapses', () => {
    const text = 'One\n\n   Two  words';
    expect(fitLines(text, 100)).toBe(text);
    expect(fitUnits(text, 100)).toBe('One Two words');
  });

  it('counts a line break as one unit, and counts the length after the trim', () => {
    // 'a\nb\nc\nd\ne' is 9 units.
    expect(fitLines('  a\nb\nc\nd\ne \n', 9)).toBe('a\nb\nc\nd\ne');
    expect(fitLines('a\nb\nc\nd\ne', 8)).toBe('a\nb\nc\nd…');
  });

  it('cuts 201 letters to 199 and an ellipsis, which makes 200 UTF-16 units', () => {
    const result = fitLines('a'.repeat(201), 200);
    expect(result).toBe(`${'a'.repeat(199)}…`);
    expect(result).toHaveLength(200);
  });

  it('cuts lines the same way: 200 units stay whole, and 201 become 199 and an ellipsis', () => {
    const text = (second: number) => `${'a'.repeat(99)}\n${'b'.repeat(second)}`;
    expect(fitLines(text(100), 200)).toBe(text(100));
    const cut = fitLines(text(101), 200);
    expect(cut).toBe(`${'a'.repeat(99)}\n${'b'.repeat(99)}…`);
    expect(cut).toHaveLength(200);
  });

  it('cuts 100 emoji to 49 and an ellipsis, 99 units, never splitting one in half', () => {
    const result = fitLines('😀'.repeat(100), 100);
    expect(result).toBe(`${'😀'.repeat(49)}…`);
    expect(result).toHaveLength(99);
  });

  it('never leaves half an emoji, wherever the cut lands among text and line breaks', () => {
    for (let max = 1; max <= 14; max += 1) {
      const result = fitLines(`a\n${'😀'.repeat(8)}\nb`, max);
      expect(result.length, `max ${max}`).toBeLessThanOrEqual(max);
      expect(result, `max ${max}`).not.toMatch(LONE_SURROGATE);
    }
  });

  it('answers the same as fitUnits for a line with nothing to keep or to collapse', () => {
    for (const text of ['Can the coffret hold a watch?', 'x'.repeat(300), '腕時計は入りますか？'.repeat(30)]) {
      expect(fitLines(text, 100)).toBe(fitUnits(text, 100));
    }
  });

  it.each([['nothing', ''], ['spaces and line breaks', ' \n\t \n ']])('is empty for %s', (_label, text) => {
    expect(fitLines(text, 10)).toBe('');
  });
});
