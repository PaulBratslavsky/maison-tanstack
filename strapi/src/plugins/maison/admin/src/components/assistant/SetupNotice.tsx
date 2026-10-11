import type { ReactNode } from 'react';

import { Box, Button, Typography } from '@strapi/design-system';

/**
 * What the drawer shows instead of the chat when the assistant is not set up, or its status could not be read, copied from
 * strapi-plugin-tanstack-ai 1.6.0 (`SetupNotice` in `HomePage.tsx`): a white box with a title and a sentence. Maison's has Check again, which
 * asks the server once more, since staff set the key and restart Strapi without leaving the page. There is no text box in either case.
 */
export const SetupNotice = ({ title, tone = 'neutral', children, onCheckAgain }: { title?: string; tone?: 'neutral' | 'danger'; children: ReactNode; onCheckAgain: () => void }) => (
  <Box background="neutral0" hasRadius shadow="tableShadow" padding={8}>
    {title && (
      <Typography variant="delta" tag="h2">
        {title}
      </Typography>
    )}
    <Box paddingTop={title ? 3 : 0}>
      <Typography textColor={tone === 'danger' ? 'danger600' : 'neutral600'}>{children}</Typography>
    </Box>
    <Box paddingTop={4}>
      <Button size="S" variant="secondary" onClick={onCheckAgain}>
        Check again
      </Button>
    </Box>
  </Box>
);
