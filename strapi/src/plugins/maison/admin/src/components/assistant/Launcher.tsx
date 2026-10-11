import { forwardRef } from 'react';

import { Sparkle } from '@strapi/icons';
import styled from 'styled-components';

import { assistantLayer } from './layer';

/**
 * The round button at the bottom right of every admin page that opens the assistant's drawer: 56px across, 24px from the edges of the window,
 * in the primary colour with the Sparkle icon, which is also the assistant's avatar in the chat. The colours and the shadow are the theme's.
 */
const Button = styled.button`
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: ${assistantLayer};
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.primary600};
  box-shadow: ${({ theme }) => theme.shadows.popupShadow};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.buttonPrimary500};
  }

  svg {
    width: 24px;
    height: 24px;
    fill: ${({ theme }) => theme.colors.neutral0};
  }
`;

interface LauncherProps {
  /** Whether the drawer is open. The launcher is not on the screen then: the drawer has its own Close. */
  open: boolean;
  onOpen: () => void;
}

/** The ref is the button, so the drawer can give it the focus back when it closes. */
export const Launcher = forwardRef<HTMLButtonElement, LauncherProps>(({ open, onOpen }, ref) => {
  if (open) return null;
  // `aria-expanded` is false whenever the button is on the screen, since it goes when the drawer opens. It still tells a screen reader that the
  // button opens something that is closed.
  return (
    <Button ref={ref} type="button" aria-label="Open the Maison assistant" aria-expanded={false} onClick={onOpen}>
      <Sparkle aria-hidden="true" />
    </Button>
  );
});
Launcher.displayName = 'Launcher';
