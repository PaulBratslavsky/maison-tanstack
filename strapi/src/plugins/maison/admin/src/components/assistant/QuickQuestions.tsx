import { Button } from '@strapi/design-system';
import styled from 'styled-components';

import { STARTERS } from '../../assistant';

/**
 * The five quick questions: a row of small buttons between the messages and the text box. They are there for the whole chat, from the empty chat on,
 * so a demo can use them at any point (Paul, 7 October: "so they don't disappear after the first request"). They replace the three starters, which
 * were in the empty chat only.
 *
 * - They are outside the message list, so they never scroll with it. They take the room of the rows they need and no more, and never shrink
 *   (`flex: 0 0 auto`): the list has less height, and the buttons keep theirs.
 * - They wrap onto a second line, and a third, when the drawer is narrow. The row never scrolls sideways.
 * - Each is the design system's small button in its quiet look (tertiary: a white fill and a grey border), so Send stays the one filled button
 *   and the list keeps its room. The side padding is the text box's own, 16px.
 * - This only draws them. What a press does is the drawer's: it sends the question as a starter, which leaves the text staff have typed in the
 *   box, and puts the focus in the box.
 */
const Row = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
`;

interface QuickQuestionsProps {
  /** A question was pressed: its text is sent as it is. */
  onAsk: (text: string) => void;
  /** Whether a send of this text would work now. While an answer comes it would not, and every question is switched off. */
  canAsk: (text: string) => boolean;
}

export const QuickQuestions = ({ onAsk, canAsk }: QuickQuestionsProps) => (
  <Row role="group" aria-label="Quick questions">
    {STARTERS.map((question) => (
      <Button key={question} type="button" size="S" variant="tertiary" disabled={!canAsk(question)} onClick={() => onAsk(question)}>
        {question}
      </Button>
    ))}
  </Row>
);
