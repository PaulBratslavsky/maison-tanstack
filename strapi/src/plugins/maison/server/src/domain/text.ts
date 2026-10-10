interface BlockNode {
  type?: string;
  text?: string;
  children?: BlockNode[];
}

const textOf = (node: BlockNode): string => {
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.children)) return node.children.map(textOf).join('');
  return '';
};

/** Strapi blocks → plain text: blocks separated by blank lines, list items by newlines. */
export function blocksToPlainText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return (blocks as BlockNode[])
    .map((block) =>
      block.type === 'list' && Array.isArray(block.children) ? block.children.map(textOf).join('\n') : textOf(block)
    )
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/** Collapses whitespace and cuts to `max` characters (code points), ending with "…" when cut. */
export function teaser(text: string, max = 160): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** Cuts to at most `max` UTF-16 units: whole characters, ending with "…", one unit, when it cut. */
const cutToUnits = (text: string, max: number): string => {
  if (text.length <= max) return text;
  let kept = '';
  for (const char of text) {
    if (kept.length + char.length > max - 1) break;
    kept += char;
  }
  return `${kept}…`;
};

/**
 * Collapses whitespace and cuts to at most `max` UTF-16 units, which is what Strapi's string `maxLength` counts: an
 * emoji is two, so a field of 100 takes 50 of them. Keeps whole characters (code points), never half an emoji, and
 * ends with "…", one unit, when it cut.
 */
export function fitUnits(text: string, max: number): string {
  return cutToUnits(text.replace(/\s+/g, ' ').trim(), max);
}

/**
 * Trims and cuts to at most `max` UTF-16 units like `fitUnits`, but keeps the line breaks and the spaces inside the
 * lines, for text people read as it was written. A line break is one unit.
 */
export function fitLines(text: string, max: number): string {
  return cutToUnits(text.trim(), max);
}

/** `text` as a sentence: trimmed, ending in a full stop unless it ends in one already, or another mark. */
export const asSentence = (text: string): string => (/[.!?。]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);
