import { Box, Flex, Typography } from '@strapi/design-system';
import { EmotionHappy, EmotionUnhappy, PriceTag, Question } from '@strapi/icons';

import { COUNTS, type InquiriesSummary } from '../inquiries';

/** The colour of a card is the tone of its icon tile: what the queue asks of staff. */
const TILES = {
  needsAnswer: { tone: 'warning', Icon: Question },
  complaint: { tone: 'danger', Icon: EmotionUnhappy },
  praise: { tone: 'success', Icon: EmotionHappy },
  notLabelled: { tone: 'neutral', Icon: PriceTag },
} as const;

/**
 * The open inquiries in each queue, as four cards, on the Homepage widget and on the Inquiries tab. The cards follow the
 * width of what holds them, not the browser's: four across when there is room, and wrapping when there isn't, as when
 * the widget is made narrow.
 */
export const InquiryCounts = ({ counts }: { counts: InquiriesSummary }) => (
  // role="list" keeps the list for Safari's VoiceOver, which drops it from a list whose bullets are hidden.
  <Flex tag="ul" role="list" aria-label="Inquiry counts" wrap="wrap" gap={3} alignItems="stretch">
    {COUNTS.map(({ key, label }) => {
      const { tone, Icon } = TILES[key];
      return (
        // The number comes before its label, so a screen reader says "3, Needs an answer", one list item to a card.
        <Box key={key} tag="li" grow={1} basis="12rem" minWidth="0" padding={4} background="neutral0" borderColor="neutral150" hasRadius>
          <Flex gap={3} alignItems="center">
            <Flex width="3.2rem" height="3.2rem" shrink={0} justifyContent="center" background={`${tone}100`} hasRadius>
              <Icon fill={`${tone}600`} aria-hidden />
            </Flex>
            <Flex direction="column" alignItems="flex-start" minWidth="0">
              <Typography variant="alpha" textColor="neutral800">
                {counts[key]}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                {label}
              </Typography>
            </Flex>
          </Flex>
        </Box>
      );
    })}
  </Flex>
);
