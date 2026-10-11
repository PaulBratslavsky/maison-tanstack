import type { ReactNode } from 'react';

import { Typography } from '@strapi/design-system';
import styled from 'styled-components';

import { assistantLayer } from './layer';

/** The line shown above the launcher when the assistant could not load: in the launcher's corner, in the theme's colours, read out as an alert. */
const Box = styled.div`
  position: fixed;
  right: 24px;
  bottom: 92px;
  z-index: ${assistantLayer};
  max-width: min(320px, 90vw);
  padding: 12px 16px;
  border: 1px solid ${({ theme }) => theme.colors.danger200};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.danger100};
  box-shadow: ${({ theme }) => theme.shadows.popupShadow};
`;

export const Notice = ({ children }: { children: ReactNode }) => (
  <Box role="alert">
    <Typography textColor="danger600">{children}</Typography>
  </Box>
);
