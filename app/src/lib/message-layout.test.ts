import { describe, expect, it } from 'vitest';

import { messageLayout } from './message-layout';
import { CHOOSE_VISIT } from './visit-picker';

/**
 * A message's part as AssistantParts hands it over: words, or a tool call with its lines (its name, unless given), a card
 * under it, and photos.
 */
type Part = { words: string } | { tool: string; lines?: string[]; card?: string; grid?: string };

/** The blocks a message's parts make, in order, as AssistantParts lays them out: a run of lines reads `[a | b]`. */
const layOut = (parts: Part[]) => {
  const layout = messageLayout<string>((lines) => `[${lines.join(' | ')}]`);
  for (const part of parts) {
    if ('words' in part) {
      layout.words(part.words);
      continue;
    }
    if (part.tool === CHOOSE_VISIT) layout.picker();
    for (const line of part.lines ?? [part.tool]) layout.line(line);
    if (part.card) layout.card(part.card);
    if (part.grid) layout.grid(part.grid);
  }
  return layout.blocks();
};

const search: Part = { tool: 'search_products', grid: 'photos' };
const resolveDate: Part = { tool: 'resolve_date' };
const suggested: Part = { words: 'Here are three pieces for him. I have prepared Ginza on Saturday at 14:00.' };

describe('messageLayout', () => {
  it("keeps a run of lines together, with its cards under it, and the words where they came", () => {
    expect(layOut([{ tool: 'find_boutiques' }, { tool: 'my_appointments', card: 'card' }, { words: 'Here they are.' }])).toEqual([
      '[find_boutiques | my_appointments]',
      'card',
      'Here they are.',
    ]);
  });

  it("puts a search's photos at the end of the message, under its words, when no visit picker comes after them", () => {
    expect(layOut([search, { words: 'Three pieces for him.' }])).toEqual(['[search_products]', 'Three pieces for him.', 'photos']);
  });

  // The demo's first suggestion: the concierge searches, works out the day, suggests the pieces and calls choose_visit.
  it('puts the photos found before a visit picker above it: under the words that suggested them, and above the form', () => {
    expect(layOut([search, resolveDate, suggested, { tool: CHOOSE_VISIT, card: 'form' }])).toEqual([
      '[search_products | resolve_date]',
      suggested.words,
      'photos',
      '[choose_visit]',
      'form',
    ]);
  });

  it("keeps them there once the visit is requested: above the picker's lines, its card and the concierge's sentence after it", () => {
    const requested: Part = { tool: CHOOSE_VISIT, lines: ['choose_visit ✓ requested', 'request_appointment ✓'], card: 'booking card' };
    expect(layOut([search, resolveDate, suggested, requested, { words: 'Your visit is requested.' }])).toEqual([
      '[search_products | resolve_date]',
      suggested.words,
      'photos',
      '[choose_visit ✓ requested | request_appointment ✓]',
      'booking card',
      'Your visit is requested.',
    ]);
  });

  it("ends the run of lines before a picker's line, with no words between them: the photos go between the two", () => {
    expect(layOut([search, { tool: CHOOSE_VISIT, card: 'form' }])).toEqual(['[search_products]', 'photos', '[choose_visit]', 'form']);
  });

  it("keeps the picker's line in the run before it when no photos wait", () => {
    expect(layOut([resolveDate, { tool: CHOOSE_VISIT, card: 'form' }])).toEqual(['[resolve_date | choose_visit]', 'form']);
  });

  it('leaves the photos found after the last picker at the end of the message', () => {
    const later: Part = { tool: 'search_products', grid: 'more photos' };
    expect(layOut([search, { tool: CHOOSE_VISIT, card: 'closed' }, { words: 'Happy to help.' }, later, { words: 'Two more.' }])).toEqual([
      '[search_products]',
      'photos',
      '[choose_visit]',
      'closed',
      'Happy to help.',
      '[search_products]',
      'Two more.',
      'more photos',
    ]);
  });
});
