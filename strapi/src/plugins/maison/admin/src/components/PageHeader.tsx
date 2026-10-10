import { Box, Flex, Typography } from '@strapi/design-system';

/**
 * The Maison page's header, in place of `Layouts.Header`. That one is made for a page with nothing else to say: a large title, the subtitle
 * under it, and 32px above and below. Here the title and the subtitle share one row, so the tabs and their lists start higher.
 *
 * - The title is the page's h1, in the `beta` text. The subtitle is beside it, in the `omega` text and the secondary grey, and wraps under the
 *   title when the screen is narrow.
 * - The row is about 56px high, with its content in the middle, and has 24px above it.
 * - The side padding is the page's own, set by the box that holds the header and the tabs.
 */
export const PageHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <Box paddingTop={6} data-maison-header="">
    <Flex alignItems="center" minHeight="5.6rem">
      <Flex alignItems="baseline" wrap="wrap" gap={3}>
        <Typography variant="beta" tag="h1">
          {title}
        </Typography>
        <Typography variant="omega" textColor="neutral600">
          {subtitle}
        </Typography>
      </Flex>
    </Flex>
  </Box>
);
