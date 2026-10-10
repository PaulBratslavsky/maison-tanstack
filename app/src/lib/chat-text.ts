/** A run of text in the assistant's reply: plain, or **bold**. */
export interface Span {
  text: string;
  bold: boolean;
}

/** One line of a paragraph, or of a list item. */
export type Line = Span[];

export type Block =
  | { kind: 'paragraph'; lines: Line[] }
  /** `start` is the first item's own number, so a list that was split by a blank line carries on from where it was. */
  | { kind: 'ordered'; start: number; items: Line[][] }
  | { kind: 'bullets'; items: Line[][] };

// **bold**, with a character that isn't a space just inside each pair, so "a ** b ** c" is left as it is.
const BOLD = /\*\*(\S(?:.*?\S)?)\*\*/g;
// "1. ", "2) ", "- ", "* " or "• " at the start of a line. "**bold**" at the start of a line is not a bullet.
const LIST_ITEM = /^\s*(?:(\d{1,3})[.)]|[-*•])\s+(.+)$/;
const INDENTED = /^(?:\s{2,}|\t)/;

const spansOf = (line: string): Line => {
  const spans: Span[] = [];
  let end = 0;
  for (const match of line.matchAll(BOLD)) {
    if (match.index > end) spans.push({ text: line.slice(end, match.index), bold: false });
    spans.push({ text: match[1], bold: true });
    end = match.index + match[0].length;
  }
  if (end < line.length) spans.push({ text: line.slice(end), bold: false });
  return spans;
};

/**
 * The small part of Markdown the concierge's replies use: **bold**, line breaks, and numbered and bulleted lines, which
 * models write whatever they are told. Nothing else is read: markup, links, headings, code and italics stay as the text
 * they are. The result is data, drawn as React elements (never HTML), so the text can't add markup to the page.
 *
 * A blank line ends a paragraph or a list. A line indented under a list item belongs to that item. Any other line that
 * isn't a list item ends the list and starts a paragraph.
 */
export const parseChatText = (text: string): Block[] => {
  const blocks: Block[] = [];
  let open: Block | null = null; // the block the next line can still join
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (raw.trim() === '') {
      open = null;
      continue;
    }
    const item = LIST_ITEM.exec(raw);
    if (item) {
      const line = spansOf(item[2].trim());
      if (item[1] === undefined) {
        if (open?.kind === 'bullets') open.items.push([line]);
        else blocks.push((open = { kind: 'bullets', items: [[line]] }));
      } else if (open?.kind === 'ordered') {
        open.items.push([line]);
      } else {
        blocks.push((open = { kind: 'ordered', start: Number(item[1]), items: [[line]] }));
      }
      continue;
    }
    const line = spansOf(raw.trim());
    if (open?.kind === 'paragraph') open.lines.push(line);
    else if (open && INDENTED.test(raw)) open.items[open.items.length - 1].push(line);
    else blocks.push((open = { kind: 'paragraph', lines: [line] }));
  }
  return blocks;
};
