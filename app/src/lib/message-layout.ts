/**
 * The order of an assistant message's blocks on screen (AssistantParts in components/chat-parts.tsx), whatever each block
 * is. Words come as they came. A run of tool lines stays together, with the cards they made (a booking card, a visit
 * picker, a hand-off note) right under the run. The photo grids a search found go at the end of the message, under its
 * words, but never below a visit picker: they go in just before its line, so the pieces sit under the words that
 * suggested them and above the form (the demo's first suggestion), and later above the visit's card. Grids found after
 * the last picker stay at the end. `run` wraps a run of lines in one block; `key` is the run's place among the blocks.
 */
export const messageLayout = <T>(run: (lines: T[], key: number) => T) => {
  const blocks: T[] = [];
  let lines: T[] = [];
  let cards: T[] = [];
  let found: T[] = [];
  const endRun = () => {
    if (lines.length > 0) blocks.push(run(lines, blocks.length));
    blocks.push(...cards);
    lines = [];
    cards = [];
  };
  return {
    /** Words, which end the run of lines before them. */
    words: (block: T) => {
      endRun();
      blocks.push(block);
    },
    /** A tool's line, in the current run. */
    line: (line: T) => {
      lines.push(line);
    },
    /** A card, under the current run. */
    card: (card: T) => {
      cards.push(card);
    },
    /** The photos a search found. */
    grid: (grid: T) => {
      found.push(grid);
    },
    /** A visit picker's line comes next: the grids found so far go in, after the run of lines before it, if any wait. */
    picker: () => {
      if (found.length === 0) return;
      endRun();
      blocks.push(...found);
      found = [];
    },
    /** Every block, in order. */
    blocks: (): T[] => {
      endRun();
      return [...blocks, ...found];
    },
  };
};
