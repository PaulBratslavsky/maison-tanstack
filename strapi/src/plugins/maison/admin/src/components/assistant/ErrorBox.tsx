import type { ReactNode } from 'react';

import { Box, Typography } from '@strapi/design-system';

/**
 * The red box between the messages and the composer, copied from strapi-plugin-tanstack-ai 1.6.0 (`ChatPanel.tsx`): 12px padding, the
 * `danger100` fill, 16px side margins and `danger600` text. It is an alert, so a screen reader reads it when it appears. Its text is
 * Maison's own (`errorNotice`), without the reference's "Error: " in front.
 */
export const ErrorBox = ({ children }: { children: ReactNode }) => (
  <Box role="alert" padding={3} background="danger100" marginLeft={4} marginRight={4}>
    <Typography textColor="danger600">{children}</Typography>
  </Box>
);

/** The same place and shape in grey, for a line about how the last turn ended (the assistant stopped after 6 steps, or declined). It is a status, not an alert. */
export const NoteBox = ({ children }: { children: ReactNode }) => (
  <Box role="status" padding={3} background="neutral100" marginLeft={4} marginRight={4}>
    <Typography textColor="neutral600">{children}</Typography>
  </Box>
);
