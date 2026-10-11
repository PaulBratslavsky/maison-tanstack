// @vitest-environment jsdom
import { Button } from '@strapi/design-system';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { STARTERS } from '../../admin/src/assistant';
import { QuickQuestions } from '../../admin/src/components/assistant/QuickQuestions';
import { declarationsOf, mediaDeclarationsOf } from './css';
import { renderInTheme } from './render';

/**
 * The five quick questions: a row of small chips above the text box that stays for the whole chat (Paul, 7 October: "so they don't disappear after
 * the first request, which makes the demo easier"). The component only draws them and says which one was pressed. What a press does is the drawer's:
 * ChatDrawer sends it as a starter, which leaves the draft alone, and the tests of the drawer hold that.
 */
const group = () => screen.getByRole('group', { name: 'Quick questions' });
const chips = () => within(group()).getAllByRole('button') as HTMLButtonElement[];

describe('QuickQuestions', () => {
  it('is a group named "Quick questions" with one button for each of the five questions, in order, named with the question as it is written', () => {
    renderInTheme(<QuickQuestions onAsk={() => {}} canAsk={() => true} />);
    expect(chips().map((chip) => chip.textContent)).toEqual([
      'Which visits are waiting for staff?',
      'Any complaints this week?',
      'Which customer questions still need an answer?',
      'How many inquiries are open in each queue?',
      'What are customers asking about today?',
    ]);
    expect(chips().map((chip) => chip.textContent)).toEqual([...STARTERS]);
    for (const question of STARTERS) expect(screen.getByRole('button', { name: question })).toBeTruthy();
  });

  it("sends a chip's own text when it is pressed, once, and nothing for the others", async () => {
    const onAsk = vi.fn();
    renderInTheme(<QuickQuestions onAsk={onAsk} canAsk={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'How many inquiries are open in each queue?' }));
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('How many inquiries are open in each queue?');
  });

  it('can be pressed again and again: a chip stays after it has been pressed', async () => {
    const onAsk = vi.fn();
    renderInTheme(<QuickQuestions onAsk={onAsk} canAsk={() => true} />);
    const chip = screen.getByRole('button', { name: 'Any complaints this week?' });
    await userEvent.click(chip);
    await userEvent.click(chip);
    expect(onAsk).toHaveBeenCalledTimes(2);
    expect(chips()).toHaveLength(5);
  });

  it('switches off each chip whose send would not work, and sends nothing for it', async () => {
    const onAsk = vi.fn();
    renderInTheme(<QuickQuestions onAsk={onAsk} canAsk={(text) => text !== 'Any complaints this week?'} />);
    const off = screen.getByRole('button', { name: 'Any complaints this week?' }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Which visits are waiting for staff?' }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(off);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('switches off every chip while an answer comes, which the drawer says by answering no for each', () => {
    renderInTheme(<QuickQuestions onAsk={() => {}} canAsk={() => false} />);
    expect(chips().every((chip) => chip.disabled)).toBe(true);
    expect(chips()).toHaveLength(5);
  });

  it('asks canAsk about each question text, as the questions are written', () => {
    const canAsk = vi.fn((_text: string) => true);
    renderInTheme(<QuickQuestions onAsk={() => {}} canAsk={canAsk} />);
    expect(canAsk.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining([...STARTERS]));
  });

  it('is buttons that never submit a form: the text box is in a form, and a chip must not send what is typed there', () => {
    renderInTheme(<QuickQuestions onAsk={() => {}} canAsk={() => true} />);
    for (const chip of chips()) expect(chip.getAttribute('type'), chip.textContent ?? '').toBe('button');
  });

  describe('how it looks', () => {
    // A chip is the design system's small button in a quiet variant, so the message list keeps its room. It is held to the design system's own small
    // button and not to a number, so a change to the design system's sizes does not break this, and a chip of another size does.
    const reference = (size: 'S' | 'M', variant: 'tertiary' | 'secondary') => {
      renderInTheme(
        <Button size={size} variant={variant}>
          {`reference ${size} ${variant}`}
        </Button>
      );
      return screen.getByRole('button', { name: `reference ${size} ${variant}` });
    };

    it('is the design system\'s small button, as high as a small button is and not as high as a medium one', () => {
      renderInTheme(<QuickQuestions onAsk={() => {}} canAsk={() => true} />);
      const chip = chips()[0];
      const small = reference('S', 'tertiary');
      const medium = reference('M', 'tertiary');
      expect(declarationsOf(chip).height).toBeTruthy();
      expect(declarationsOf(chip).height).toBe(declarationsOf(small).height);
      expect(mediaDeclarationsOf(chip, '(min-width: 768px)').height).toBe(mediaDeclarationsOf(small, '(min-width: 768px)').height);
      expect(mediaDeclarationsOf(chip, '(min-width: 768px)').height).not.toBe(mediaDeclarationsOf(medium, '(min-width: 768px)').height);
    });

    it('is a tertiary or a secondary button, not the filled primary button that Send is', () => {
      renderInTheme(<QuickQuestions onAsk={() => {}} canAsk={() => true} />);
      const chip = chips()[0];
      const colours = (element: Element) => {
        const { background, border, color } = declarationsOf(element);
        return JSON.stringify({ background, border, color });
      };
      const quiet = [reference('S', 'tertiary'), reference('S', 'secondary')].map(colours);
      expect(quiet).toContain(colours(chip));
    });

    it('wraps onto more lines when the drawer is narrow, with a gap between the chips, and never scrolls sideways', () => {
      renderInTheme(<QuickQuestions onAsk={() => {}} canAsk={() => true} />);
      expect(declarationsOf(group())).toMatchObject({ display: 'flex', 'flex-wrap': 'wrap', gap: '8px' });
      expect(declarationsOf(group())['overflow-x']).toBeUndefined();
      expect(declarationsOf(group())['white-space']).toBeUndefined();
    });

    // The chat column is a column of the top bar, the list, these and the text box. When the window is short, the list has less height and these do not.
    it('does not shrink: when the window is short the message list has less height, and the buttons keep theirs', () => {
      renderInTheme(<QuickQuestions onAsk={() => {}} canAsk={() => true} />);
      expect(declarationsOf(group()).flex).toBe('0 0 auto');
    });

    it('lines up with the text box under it: the same 16px at each side', () => {
      renderInTheme(<QuickQuestions onAsk={() => {}} canAsk={() => true} />);
      const { padding } = declarationsOf(group());
      expect(padding).toMatch(/^\d+px 16px/);
    });
  });

  it('draws in the dark theme too', () => {
    renderInTheme(<QuickQuestions onAsk={() => {}} canAsk={() => true} />, { dark: true });
    expect(chips()).toHaveLength(5);
  });
});
