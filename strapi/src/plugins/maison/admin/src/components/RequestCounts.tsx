import { Box, Flex, Typography } from '@strapi/design-system';
import { CheckCircle, Clock, PaperPlane } from '@strapi/icons';

import type { RequestsSummary } from '../useRequestsSummary';

/** The board's one pipeline of visits still ahead, as three cards. The colour of a card is the tone of its icon tile. */
const COUNTS = [
  { key: 'waitingForStaff', label: 'Waiting for staff', tone: 'warning', Icon: Clock },
  { key: 'confirmedUpcoming', label: 'Confirmed, upcoming', tone: 'success', Icon: CheckCircle },
  { key: 'confirmationsSent', label: 'LINE sent', tone: 'primary', Icon: PaperPlane },
] as const;

/**
 * The request counts on the Homepage widget and on the Maison page. The cards follow the width of what holds them, not
 * the browser's: three across when there is room, and wrapping when there isn't, as when the widget is made narrow.
 */
export const RequestCounts = ({ counts }: { counts: RequestsSummary['counts'] }) => (
  // role="list" keeps the list for Safari's VoiceOver, which drops it from a list whose bullets are hidden.
  <Flex tag="ul" role="list" aria-label="Request counts" wrap="wrap" gap={3} alignItems="stretch">
    {COUNTS.map(({ key, label, tone, Icon }) => (
      // The number comes before its label, so a screen reader says "3, Waiting for staff", one list item to a card.
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
    ))}
  </Flex>
);
